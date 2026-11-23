import pytest
from django.db.models import ProtectedError

from apps.clinical.models import ANAMNESIS_DECLARATION, AnamnesisSignature
from tests.test_inventory_consent import signature_data

pytestmark = pytest.mark.django_db(transaction=True)


def save(client, auth, patient, questions, detail="Dipirona"):
    alergia, fumante = questions
    body = {
        "answers": [
            {"question_id": alergia.id, "answer": True, "detail": detail},
            {"question_id": fumante.id, "answer": False},
        ],
        "notes": "",
    }
    r = client.put(f"/api/patients/{patient['id']}/anamnesis", json=body, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def sign(client, auth, patient, name="Maria Paciente"):
    return client.post(
        f"/api/patients/{patient['id']}/anamnesis/signature", json={"signer_name": name, "signature": signature_data()}, headers=auth
    )


def test_signature_needs_a_saved_anamnesis(client, auth, patient):
    r = sign(client, auth, patient)
    assert r.status_code == 409 and "Salve a anamnese" in r.json()["detail"]


def test_patient_signs_the_current_version_once(client, auth, other_auth, patient, questions):
    saved = save(client, auth, patient, questions)
    assert saved["signature"] is None and saved["declaration"] == ANAMNESIS_DECLARATION

    r = sign(client, auth, patient)
    assert r.status_code == 201, r.text
    signature = r.json()["signature"]
    assert signature["version"] == 1 and signature["signer_name"] == "Maria Paciente" and len(signature["document_hash"]) == 64

    again = sign(client, auth, patient)
    assert again.status_code == 409 and "já está assinada" in again.json()["detail"]
    assert sign(client, other_auth, patient).status_code == 404

    image = client.get(f"/api/anamnesis-signatures/{signature['id']}/image", headers=auth)
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    assert client.get(f"/api/anamnesis-signatures/{signature['id']}/image", headers=other_auth).status_code == 404
    assert ("criar", "assinatura_anamnese") in [(l["action"], l["resource"]) for l in client.get("/api/audit", headers=auth).json()]


def test_changing_the_anamnesis_asks_for_a_new_signature(client, auth, patient, questions):
    save(client, auth, patient, questions)
    first = sign(client, auth, patient).json()["signature"]

    # Salvar sem mudar nada não cria versão: a assinatura continua valendo.
    assert save(client, auth, patient, questions)["signature"]["id"] == first["id"]

    changed = save(client, auth, patient, questions, detail="Dipirona e látex")
    assert changed["version"] == 2 and changed["signature"] is None

    second = sign(client, auth, patient).json()["signature"]
    assert second["version"] == 2 and second["document_hash"] != first["document_hash"]

    versions = {v["number"]: v for v in client.get(f"/api/patients/{patient['id']}/anamnesis/versions", headers=auth).json()}
    assert versions[1]["signature"]["id"] == first["id"] and versions[2]["signature"]["id"] == second["id"]


def test_signature_validation_and_never_deleted(client, auth, patient, questions):
    save(client, auth, patient, questions)
    bad = client.post(
        f"/api/patients/{patient['id']}/anamnesis/signature",
        json={"signer_name": "Maria", "signature": "data:image/png;base64,bm90IGEgcG5n"},
        headers=auth,
    )
    assert bad.status_code == 422
    sig_id = sign(client, auth, patient).json()["signature"]["id"]
    with pytest.raises(ProtectedError):
        AnamnesisSignature.objects.get(pk=sig_id).delete()
