from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.inventory.models import Application, Lot, Product
from apps.patients.models import Patient
from apps.scheduling.models import Appointment

pytestmark = pytest.mark.django_db(transaction=True)


def make_app(user, patient, lot, when, amount="10"):
    a = Application.objects.create(
        patient=patient, lot=lot, applied_by=user, amount=Decimal(amount), unit="U", region="testa", treatment="botox"
    )
    Application.objects.filter(pk=a.pk).update(applied_at=when)
    return a


@pytest.fixture
def setup(client, auth):
    user = User.objects.get(email="ana@clinica.com")
    product = Product.objects.create(owner=user, brand="Allergan", name="Botox", kind="toxina", unit="U")
    lot = Lot.objects.create(
        product=product, number="L1", expires_on=timezone.localdate() + timedelta(days=90), initial_quantity=100, balance=80
    )
    return user, lot


def mid_month():
    now = timezone.localtime()
    return now.replace(day=15, hour=12, minute=0, second=0, microsecond=0)


def test_monthly_report(client, auth, setup):
    user, lot = setup
    when = mid_month()
    month = when.strftime("%Y-%m")
    maria = Patient.objects.create(owner=user, full_name="Maria")
    anon = Patient.objects.create(owner=user, full_name="Oculta", anonymized_at=timezone.now())
    make_app(user, maria, lot, when, "10")
    make_app(user, maria, lot, when + timedelta(hours=1), "5")
    make_app(user, anon, lot, when, "7")
    make_app(user, maria, lot, when - timedelta(days=40), "99")  # outro mês
    r = client.get(f"/api/reports/monthly?month={month}", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["month"] == month
    assert [(p["full_name"], p["applications"]) for p in body["patients"]] == [("Maria", 2)]
    assert body["patients_count"] == 1
    assert body["new_patients_count"] == 1  # a anonimizada não conta
    assert [(x["lot_number"], Decimal(x["total"]), x["applications"], Decimal(x["balance"])) for x in body["by_lot"]] == [
        ("L1", Decimal("22"), 3, Decimal("80"))
    ]
    assert body["by_lot"][0]["expires_on"]
    assert Decimal(body["by_product"][0]["total"]) == Decimal("22")
    assert client.get("/api/reports/monthly", headers=auth).status_code == 200  # padrão: mês atual


def test_monthly_isolation_and_invalid(client, auth, other_auth, setup):
    user, lot = setup
    maria = Patient.objects.create(owner=user, full_name="Maria")
    when = mid_month()
    make_app(user, maria, lot, when)
    month = when.strftime("%Y-%m")
    other = client.get(f"/api/reports/monthly?month={month}", headers=other_auth).json()
    assert other["patients"] == [] and other["by_lot"] == [] and other["new_patients_count"] == 0
    for bad in ("2026-13", "202611", "abc", "2026-1"):
        assert client.get(f"/api/reports/monthly?month={bad}", headers=auth).status_code == 422
    assert client.get("/api/reports/monthly").status_code == 401


# ---- agenda ----
def slot(hour, days=1):
    base = timezone.localtime().replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(days=days)
    return base.isoformat(), (base + timedelta(hours=1)).isoformat()


def book(client, headers, hour=10, **extra):
    s, e = slot(hour)
    return client.post("/api/appointments", json={"starts_at": s, "ends_at": e, **extra}, headers=headers)


def rng():
    d = timezone.localdate()
    return f"from={d}&to={d + timedelta(days=3)}"


def test_create_list_and_audit(client, auth, patient):
    r = book(client, auth, patient_id=patient["id"], kind="Botox")
    assert r.status_code == 201, r.text
    assert r.json()["patient_name"] == "Maria Paciente" and r.json()["status"] == "agendado"
    lead = book(client, auth, hour=14, lead_name="Joana", lead_phone="11999")
    assert lead.status_code == 201
    rows = client.get(f"/api/appointments?{rng()}", headers=auth).json()
    assert [x["lead_name"] or x["patient_name"] for x in rows] == ["Maria Paciente", "Joana"]
    assert client.get("/api/appointments?from=2020-01-01&to=2020-01-02", headers=auth).json() == []
    assert book(client, auth, hour=16).status_code == 422  # sem paciente nem nome
    s, e = slot(9)
    assert client.post("/api/appointments", json={"lead_name": "X", "starts_at": e, "ends_at": s}, headers=auth).status_code == 422
    from apps.audit.models import AccessLog

    assert AccessLog.objects.filter(resource="agendamento", action="criar").count() == 2


def test_conflict_and_cancel_frees_slot(client, auth):
    first = book(client, auth, lead_name="A")
    assert first.status_code == 201
    clash = book(client, auth, lead_name="B")
    assert clash.status_code == 409 and "conflito" in clash.json()["detail"]
    ok = client.post(f"/api/appointments/{first.json()['id']}/status", json={"status": "cancelado"}, headers=auth)
    assert ok.status_code == 200 and ok.json()["status"] == "cancelado"
    assert book(client, auth, lead_name="B").status_code == 201
    # reativar o cancelado agora conflita
    back = client.post(f"/api/appointments/{first.json()['id']}/status", json={"status": "agendado"}, headers=auth)
    assert back.status_code == 409
    assert client.post(f"/api/appointments/{first.json()['id']}/status", json={"status": "xx"}, headers=auth).status_code == 422
    assert Appointment.objects.count() == 2  # nada é apagado


def test_edit_conflict_excludes_self(client, auth):
    a = book(client, auth, lead_name="A").json()
    book(client, auth, hour=12, lead_name="B")
    s, e = slot(10)
    same = client.patch(f"/api/appointments/{a['id']}", json={"notes": "x", "starts_at": s, "ends_at": e}, headers=auth)
    assert same.status_code == 200 and same.json()["notes"] == "x"
    s, e = slot(12)
    assert client.patch(f"/api/appointments/{a['id']}", json={"starts_at": s, "ends_at": e}, headers=auth).status_code == 409


def test_agenda_isolation(client, auth, other_auth, patient):
    a = book(client, auth, patient_id=patient["id"]).json()
    assert client.get(f"/api/appointments?{rng()}", headers=other_auth).json() == []
    assert client.patch(f"/api/appointments/{a['id']}", json={"notes": "x"}, headers=other_auth).status_code == 404
    assert client.post(f"/api/appointments/{a['id']}/status", json={"status": "cancelado"}, headers=other_auth).status_code == 404
    # mesmo horário para outro profissional não conflita; paciente alheio é rejeitado
    assert book(client, other_auth, lead_name="Z").status_code == 201
    assert book(client, other_auth, hour=15, patient_id=patient["id"]).status_code == 404


def test_convert_lead(client, auth):
    a = book(client, auth, lead_name="Joana Lima", lead_phone="11999").json()
    r = client.post(f"/api/appointments/{a['id']}/convert", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["patient_id"] and body["patient_name"] == "Joana Lima" and body["lead_name"] == ""
    assert Patient.objects.get(pk=body["patient_id"]).phone == "11999"
    assert client.post(f"/api/appointments/{a['id']}/convert", headers=auth).status_code == 409


def test_slot_check_runs_under_owner_lock(client, auth, monkeypatch):
    """Criar, editar e mudar status travam o profissional dentro da transação, antes de checar o conflito."""
    from django.db import connection

    from api.routers import appointments

    calls = []
    real = appointments._lock_owner

    def spy(user):
        calls.append(connection.in_atomic_block)
        real(user)

    monkeypatch.setattr(appointments, "_lock_owner", spy)
    a = book(client, auth, lead_name="A").json()
    s, e = slot(11)
    assert client.patch(f"/api/appointments/{a['id']}", json={"starts_at": s, "ends_at": e}, headers=auth).status_code == 200
    assert client.post(f"/api/appointments/{a['id']}/status", json={"status": "confirmado"}, headers=auth).status_code == 200
    assert calls == [True, True, True]
