from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from api.compliance_logic import pending_items
from apps.accounts.models import User
from apps.clinical.models import Anamnesis, FacialPlan
from apps.consent.models import Term
from tests.test_inventory_consent import applied_patient, lot, plan_with, product, signature_data

pytestmark = pytest.mark.django_db(transaction=True)


def items(client, auth, code=None):
    r = client.get("/api/compliance", headers=auth)
    assert r.status_code == 200, r.text
    rows = r.json()["items"]
    return [i for i in rows if code is None or i["code"] == code]


def sign(client, auth, patient, kind="botox"):
    term = Term.objects.filter(kind=kind).first() or Term.objects.create(kind=kind, version=1, title=f"Termo {kind}", content="Texto.")
    r = client.post(
        f"/api/patients/{patient['id']}/consents",
        json={"term_id": term.id, "signer_name": "Maria Paciente", "signature": signature_data()},
        headers=auth,
    )
    assert r.status_code == 201, r.text
    return r.json()


def new_patient(client, auth, name="Outra Paciente", **extra):
    r = client.post("/api/patients", json={"full_name": name, **extra}, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def event(client, auth, patient, **over):
    body = {"kind": "hematoma", "severity": "leve", "onset_at": timezone.now().isoformat()} | over
    r = client.post(f"/api/patients/{patient['id']}/adverse-events", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def test_requires_auth_and_empty_state(client, auth, patient):
    assert client.get("/api/compliance").status_code == 401
    assert client.get("/api/compliance", headers=auth).json() == {"items": [], "counts": {"alta": 0, "media": 0, "baixa": 0}}


def test_sem_anamnese_only_with_plan_and_clears_when_saved(client, auth, patient):
    assert items(client, auth) == []  # sem plano, anamnese ainda não é cobrada
    plan_with(client, auth, patient, None, amount=3)
    [item] = items(client, auth, "sem_anamnese")
    assert item == {
        "patient_id": patient["id"], "patient_name": "Maria Paciente", "code": "sem_anamnese", "severity": "media",
        "message": "Paciente com plano e sem anamnese salva.", "ref": {"type": "patient", "id": patient["id"]},
    }
    Anamnesis.objects.create(patient_id=patient["id"])
    assert items(client, auth, "sem_anamnese") == []


def test_sem_anamnese_is_high_when_a_plan_was_already_applied(client, auth, patient):
    applied_patient(client, auth, patient)
    [item] = items(client, auth, "sem_anamnese")
    assert item["severity"] == "alta"


def test_sem_termo_for_applied_plan_until_a_valid_signature_exists(client, auth, patient):
    _, plan = applied_patient(client, auth, patient)
    [item] = items(client, auth, "sem_termo")
    assert (item["severity"], item["ref"]) == ("alta", {"type": "plan", "id": plan["id"]})
    assert "Toxina botulínica" in item["message"] and "Maria" not in item["message"]

    sig = sign(client, auth, patient, "botox")
    assert items(client, auth, "sem_termo") == []

    # Termo revogado deixa de valer; termo de outro procedimento ou de uso de imagem não cobre o botox.
    from apps.consent.models import Signature

    Signature.objects.filter(pk=sig["id"]).update(revoked_at=timezone.now())
    assert len(items(client, auth, "sem_termo")) == 1
    Signature.objects.filter(pk=sig["id"]).update(revoked_at=None, term=Term.objects.create(kind="uso_imagem", version=1, title="Imagem", content="x"))
    assert len(items(client, auth, "sem_termo")) == 1


def test_sem_termo_is_one_item_per_patient_even_with_several_applied_plans(client, auth, patient):
    applied_patient(client, auth, patient, number="A1")
    prod = product(client, auth, name="Botox 50U")
    l2 = lot(client, auth, prod["id"], "A2").json()
    second = plan_with(client, auth, patient, l2["id"], amount=5).json()
    assert client.post(f"/api/plans/{second['id']}/apply", headers=auth).status_code == 200
    [item] = items(client, auth, "sem_termo")
    assert item["ref"] == {"type": "plan", "id": second["id"]}  # o aplicado mais recente
    sign(client, auth, patient, "botox")
    assert items(client, auth, "sem_termo") == []


def test_sem_termo_not_raised_for_draft_plan(client, auth, patient):
    plan_with(client, auth, patient, None, amount=4)
    assert items(client, auth, "sem_termo") == []


def test_sem_lote_for_applied_point_without_lot(client, auth, patient):
    plan = plan_with(client, auth, patient, None, amount=4).json()
    assert items(client, auth, "sem_lote") == []  # rascunho ainda pode receber lote
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200
    [item] = items(client, auth, "sem_lote")
    assert (item["severity"], item["ref"]) == ("media", {"type": "plan", "id": plan["id"]})
    assert item["message"].startswith("1 ponto aplicado sem lote")


def test_sem_lote_not_raised_when_every_point_has_an_application(client, auth, patient):
    applied_patient(client, auth, patient)
    assert items(client, auth, "sem_lote") == []


def test_intercorrencia_aberta_only_while_following_up(client, auth, patient):
    grave = event(client, auth, patient, kind="oclusao_vascular", severity="grave")
    moderate = event(client, auth, patient, kind="edema", severity="moderada")
    mild = event(client, auth, patient, kind="hematoma", severity="leve")
    done = event(client, auth, patient, kind="nodulo", severity="grave")
    assert client.patch(f"/api/adverse-events/{done['id']}", json={"outcome": "resolvido"}, headers=auth).status_code == 200

    rows = {i["ref"]["id"]: i for i in items(client, auth, "intercorrencia_aberta")}
    assert set(rows) == {grave["id"], moderate["id"], mild["id"]}
    assert rows[grave["id"]]["severity"] == "alta" and rows[grave["id"]]["ref"]["type"] == "adverse_event"
    assert rows[moderate["id"]]["severity"] == "media" and rows[mild["id"]]["severity"] == "baixa"
    assert "suspeita de oclusão vascular (grave)" in rows[grave["id"]]["message"]


def test_plano_sem_aplicacao_after_thirty_days(client, auth, patient):
    old = plan_with(client, auth, patient, None, amount=3).json()
    recent = plan_with(client, auth, patient, None, amount=3).json()
    applied = plan_with(client, auth, patient, None, amount=3).json()
    assert client.post(f"/api/plans/{applied['id']}/apply", headers=auth).status_code == 200
    FacialPlan.objects.filter(pk=old["id"]).update(created_at=timezone.now() - timedelta(days=45))
    FacialPlan.objects.filter(pk=recent["id"]).update(created_at=timezone.now() - timedelta(days=10))
    FacialPlan.objects.filter(pk=applied["id"]).update(created_at=timezone.now() - timedelta(days=90))  # aplicado não é rascunho

    [item] = items(client, auth, "plano_sem_aplicacao")
    assert (item["severity"], item["ref"]) == ("baixa", {"type": "plan", "id": old["id"]})
    assert "45 dias" in item["message"]


def test_archived_patient_is_left_out(client, auth, patient):
    applied_patient(client, auth, patient)
    event(client, auth, patient)
    assert len(items(client, auth)) >= 3
    assert client.post(f"/api/patients/{patient['id']}/archive", headers=auth).status_code == 200
    assert items(client, auth) == []
    assert client.post(f"/api/patients/{patient['id']}/unarchive", headers=auth).status_code == 200
    assert len(items(client, auth)) >= 3


def test_hidden_patient_never_leaks_name_or_phone(client, auth):
    p = new_patient(client, auth, "Joana Segredo", phone="11 98888-7777", notes="alergia a látex")
    applied_patient(client, auth, p)
    event(client, auth, p)
    assert client.post(f"/api/patients/{p['id']}/anonymize", headers=auth).status_code == 200

    r = client.get("/api/compliance", headers=auth)
    rows = r.json()["items"]
    assert {i["code"] for i in rows} >= {"sem_termo", "intercorrencia_aberta", "sem_anamnese"}
    assert {i["patient_name"] for i in rows} == {"Dados ocultos"}
    assert all(i["patient_id"] == p["id"] for i in rows)
    for secret in ("Joana", "Segredo", "98888", "látex"):
        assert secret not in r.text
    assert f"#{p['id']}" not in r.text  # nem o rótulo mascarado do cadastro


def test_users_only_see_their_own_pending_items(client, auth, other_auth, patient):
    applied_patient(client, auth, patient)
    event(client, auth, patient, severity="grave")
    assert items(client, auth)
    assert client.get("/api/compliance", headers=other_auth).json() == {"items": [], "counts": {"alta": 0, "media": 0, "baixa": 0}}

    theirs = new_patient(client, other_auth, "Paciente do Bruno")
    plan_with(client, other_auth, theirs, None, amount=3)
    mine = {i["patient_id"] for i in items(client, auth)}
    other = {i["patient_id"] for i in items(client, other_auth)}
    assert mine == {patient["id"]} and other == {theirs["id"]}


def test_counts_and_order_by_severity(client, auth, patient):
    applied_patient(client, auth, patient)  # sem_termo (alta) + sem_anamnese (alta)
    event(client, auth, patient, severity="moderada", kind="edema")  # media
    stale = plan_with(client, auth, patient, None, amount=3).json()
    FacialPlan.objects.filter(pk=stale["id"]).update(created_at=timezone.now() - timedelta(days=40))  # baixa

    body = client.get("/api/compliance", headers=auth).json()
    severities = [i["severity"] for i in body["items"]]
    assert severities == sorted(severities, key={"alta": 0, "media": 1, "baixa": 2}.get)
    assert body["counts"] == {"alta": severities.count("alta"), "media": severities.count("media"), "baixa": severities.count("baixa")}
    assert body["counts"] == {"alta": 2, "media": 1, "baixa": 1}
    assert sum(body["counts"].values()) == len(body["items"])


def test_view_is_audited(client, auth, patient):
    client.get("/api/compliance", headers=auth)
    assert ("visualizar", "pendencias") in [(l["action"], l["resource"]) for l in client.get("/api/audit", headers=auth).json()]


def test_query_count_does_not_grow_with_patients(client, auth, patient):
    user = User.objects.get(email="ana@clinica.com")

    def build(n):
        for i in range(n):
            p = new_patient(client, auth, f"Paciente {n}-{i}")
            applied_patient(client, auth, p, number=f"Q{n}{i}")
            event(client, auth, p)
            plan_with(client, auth, p, None, amount=2)

    def count():
        with CaptureQueriesContext(connection) as ctx:
            result = pending_items(user)
        return len(ctx.captured_queries), result

    build(1)
    few, rows_few = count()
    build(4)
    many, rows_many = count()
    assert len(rows_many) > len(rows_few) >= 3
    assert many == few
    assert isinstance(rows_many, list) and isinstance(rows_many[0], dict)
