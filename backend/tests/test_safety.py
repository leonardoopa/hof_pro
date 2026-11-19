from datetime import timedelta

import pytest
from django.db.models import ProtectedError
from django.utils import timezone

from apps.safety.models import AdverseEvent
from tests.test_inventory_consent import applied_patient, lot, plan_with, product

pytestmark = pytest.mark.django_db(transaction=True)


def hyaluronidase_lot(client, auth, quantity=1500):
    prod = product(client, auth, brand="Genérico", name="Hialuronidase 2000U", kind="outro", unit="U", anvisa_registration="")
    return lot(client, auth, prod["id"], number="HY1", quantity=quantity).json()


def event_body(**over):
    return {"kind": "oclusao_vascular", "severity": "grave", "onset_at": timezone.now().isoformat(), "signs": ["palidez", "livedo"]} | over


def test_event_linked_to_application_copies_point_and_lot(client, auth, other_auth, patient):
    lot_data, _ = applied_patient(client, auth, patient)
    application = client.get(f"/api/patients/{patient['id']}/traceability", headers=auth).json()["rows"][0]

    r = client.post(
        f"/api/patients/{patient['id']}/adverse-events", json=event_body(application_id=application["id"], description="Branqueamento"),
        headers=auth,
    )
    assert r.status_code == 201, r.text
    event = r.json()
    assert event["lot_id"] == lot_data["id"] and event["region"] == "testa" and event["kind_label"] == "Suspeita de oclusão vascular"
    assert event["signs"] == ["palidez", "livedo"] and event["outcome"] == "acompanhamento"

    assert client.get(f"/api/patients/{patient['id']}/adverse-events", headers=auth).json()[0]["id"] == event["id"]
    assert client.get(f"/api/patients/{patient['id']}/adverse-events", headers=other_auth).status_code == 404
    assert client.patch(f"/api/adverse-events/{event['id']}", json={"outcome": "resolvido"}, headers=other_auth).status_code == 404

    text = client.get(f"/api/adverse-events/{event['id']}/notivisa", headers=auth).text
    assert "Notivisa" in text and "Lote: AN1" in text and "palidez" in text and "Registro Anvisa: 123" in text

    actions = [(l["action"], l["resource"]) for l in client.get("/api/audit", headers=auth).json()]
    assert ("criar", "intercorrencia") in actions and ("visualizar", "intercorrencia") in actions


def test_event_rejects_application_from_another_patient(client, auth, patient):
    applied_patient(client, auth, patient)
    application = client.get(f"/api/patients/{patient['id']}/traceability", headers=auth).json()["rows"][0]
    other = client.post("/api/patients", json={"full_name": "Outra"}, headers=auth).json()
    r = client.post(f"/api/patients/{other['id']}/adverse-events", json=event_body(application_id=application["id"]), headers=auth)
    assert r.status_code == 422


def test_hyaluronidase_writes_off_stock_and_never_goes_negative(client, auth, patient):
    hy = hyaluronidase_lot(client, auth, quantity=1500)
    body = event_body(hyaluronidase_lot_id=hy["id"], hyaluronidase_amount=1000)
    assert client.post(f"/api/patients/{patient['id']}/adverse-events", json=body, headers=auth).status_code == 201
    balance = [l for l in client.get("/api/inventory/lots", headers=auth).json() if l["id"] == hy["id"]][0]["balance"]
    assert balance == 500
    movements = client.get(f"/api/inventory/lots/{hy['id']}/movements", headers=auth).json()
    assert any(m["reason"].startswith("Intercorrência #") for m in movements)

    over = client.post(f"/api/patients/{patient['id']}/adverse-events", json=body, headers=auth)
    assert over.status_code == 409
    assert AdverseEvent.objects.count() == 1  # tudo ou nada: sem saldo, o evento não é gravado

    no_amount = event_body(hyaluronidase_lot_id=hy["id"])
    assert client.post(f"/api/patients/{patient['id']}/adverse-events", json=no_amount, headers=auth).status_code == 422


def test_event_update_and_never_deleted(client, auth, patient):
    event = client.post(f"/api/patients/{patient['id']}/adverse-events", json=event_body(kind="nodulo", severity="leve"), headers=auth).json()
    r = client.patch(
        f"/api/adverse-events/{event['id']}",
        json={"outcome": "resolvido", "anvisa_notified_on": timezone.localdate().isoformat(), "anvisa_protocol": "2026.123"},
        headers=auth,
    )
    assert r.status_code == 200 and r.json()["outcome"] == "resolvido" and r.json()["anvisa_protocol"] == "2026.123"
    with pytest.raises(ProtectedError):
        AdverseEvent.objects.get(pk=event["id"]).delete()


def test_lot_recall_lists_who_received_the_lot(client, auth, other_auth, patient):
    lot_data, _ = applied_patient(client, auth, patient)
    r = client.get(f"/api/inventory/lots/{lot_data['id']}/patients", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert data["lot_number"] == "AN1" and [row["patient_name"] for row in data["rows"]] == ["Maria Paciente"]
    assert data["rows"][0]["hidden"] is False and data["rows"][0]["amount"] == 10
    assert client.get(f"/api/inventory/lots/{lot_data['id']}/patients", headers=other_auth).status_code == 404
    assert ("visualizar", "lote_pacientes") in [(l["action"], l["resource"]) for l in client.get("/api/audit", headers=auth).json()]


def test_apply_check_warns_without_blocking(client, auth, patient):
    prod = product(client, auth)
    first = lot(client, auth, prod["id"], number="T1").json()
    filler = product(client, auth, brand="Galderma", name="Restylane", kind="preenchedor", unit="ml")
    filler_lot = lot(client, auth, filler["id"], number="F1").json()

    earlier = plan_with(client, auth, patient, first["id"], amount=20).json()
    assert client.post(f"/api/plans/{earlier['id']}/apply", headers=auth).status_code == 200

    body = {
        "points": [
            {"region": "testa", "treatment": "botox", "x": 0.5, "y": 0.2, "amount": 4, "lot_id": first["id"]},
            {"region": "nariz", "treatment": "preenchimento", "x": 0.5, "y": 0.5, "amount": 0.3, "lot_id": filler_lot["id"]},
            {"region": "mento", "treatment": "preenchimento", "x": 0.5, "y": 0.8, "amount": 0.5},
        ]
    }
    plan = client.post(f"/api/patients/{patient['id']}/plans", json=body, headers=auth).json()
    codes = {i["code"]: i for i in client.get(f"/api/plans/{plan['id']}/apply-check", headers=auth).json()["items"]}

    assert {"anamnese", "termo", "intervalo_toxina", "zona_risco", "sem_lote"} <= set(codes)
    assert "20 U" in codes["intervalo_toxina"]["message"]
    assert "Nariz" in codes["zona_risco"]["message"] and "Mento" not in codes["zona_risco"]["message"]
    assert codes["sem_lote"]["message"].startswith("1 ponto")
    # Aviso não é bloqueio: o plano continua podendo ser marcado como aplicado.
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200


def test_apply_check_toxin_interval_respects_setting(client, auth, patient, settings):
    from apps.inventory.models import Application

    prod = product(client, auth)
    l = lot(client, auth, prod["id"]).json()
    earlier = plan_with(client, auth, patient, l["id"], amount=20).json()
    client.post(f"/api/plans/{earlier['id']}/apply", headers=auth)
    Application.objects.update(applied_at=timezone.now() - timedelta(days=100))

    plan = plan_with(client, auth, patient, l["id"], amount=4).json()
    codes = {i["code"] for i in client.get(f"/api/plans/{plan['id']}/apply-check", headers=auth).json()["items"]}
    assert "intervalo_toxina" not in codes  # 100 dias > 84

    settings.TOXIN_MIN_INTERVAL_DAYS = 120
    codes = {i["code"] for i in client.get(f"/api/plans/{plan['id']}/apply-check", headers=auth).json()["items"]}
    assert "intervalo_toxina" in codes
