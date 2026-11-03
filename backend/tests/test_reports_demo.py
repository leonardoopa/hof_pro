from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.models import User
from apps.inventory.models import Application, Lot, Product
from apps.patients.models import Patient
from tests.conftest import register  # noqa: F401  (fixtures client/auth/other_auth vêm do conftest)

pytestmark = pytest.mark.django_db(transaction=True)


def make_app(user, patient, lot, days_ago, amount="10", treatment="botox", unit="U"):
    app = Application.objects.create(
        patient=patient, lot=lot, applied_by=user, amount=Decimal(amount), unit=unit, region="testa", treatment=treatment
    )
    Application.objects.filter(pk=app.pk).update(applied_at=timezone.now() - timedelta(days=days_ago))
    return app


@pytest.fixture
def setup(client, auth):
    user = User.objects.get(email="ana@clinica.com")
    product = Product.objects.create(owner=user, brand="Allergan", name="Botox", kind="toxina", unit="U")
    lot = Lot.objects.create(
        product=product, number="L1", expires_on=timezone.localdate() + timedelta(days=90),
        initial_quantity=100, balance=100,
    )
    return user, lot


def test_usage_period_and_aggregation(client, auth, setup):
    user, lot = setup
    p = Patient.objects.create(owner=user, full_name="Maria")
    make_app(user, p, lot, 2, "10")
    make_app(user, p, lot, 3, "5")
    make_app(user, p, lot, 60, "99")  # fora do período
    today = timezone.localdate()
    r = client.get(f"/api/reports/usage?from={today - timedelta(days=10)}&to={today}", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [(x["lot_number"], Decimal(x["total"]), x["applications"]) for x in body["by_lot"]] == [("L1", Decimal("15"), 2)]
    assert [(Decimal(x["total"]), x["unit"]) for x in body["by_product"]] == [(Decimal("15"), "U")]
    bad = client.get(f"/api/reports/usage?from={today}&to={today - timedelta(days=1)}", headers=auth)
    assert bad.status_code == 422
    assert client.get("/api/reports/usage").status_code == 401


def test_reports_owner_isolation(client, auth, other_auth, setup):
    user, lot = setup
    p = Patient.objects.create(owner=user, full_name="Maria")
    make_app(user, p, lot, 120)
    assert len(client.get("/api/reports/usage", headers=auth).json()["by_lot"]) == 0  # 120 dias fora do padrão de 30
    assert len(client.get("/api/reports/returns", headers=auth).json()["patients"]) == 1
    other = client.get("/api/reports/returns", headers=other_auth).json()
    assert other["patients"] == []
    today = timezone.localdate()
    u = client.get(f"/api/reports/usage?from={today - timedelta(days=200)}&to={today}", headers=other_auth).json()
    assert u["by_lot"] == [] and u["by_product"] == []


def test_returns_threshold_and_last_application(client, auth, setup):
    user, lot = setup
    old = Patient.objects.create(owner=user, full_name="Antiga", phone="1")
    recent = Patient.objects.create(owner=user, full_name="Recente")
    never = Patient.objects.create(owner=user, full_name="Sem aplicacao")
    make_app(user, old, lot, 200, treatment="botox")
    make_app(user, old, lot, 100, treatment="preenchimento", unit="ml")
    make_app(user, recent, lot, 200)
    make_app(user, recent, lot, 5)  # a última aplicação é recente: não entra
    rows = client.get("/api/reports/returns", headers=auth).json()["patients"]
    assert [r["full_name"] for r in rows] == ["Antiga"]
    assert rows[0]["days_since"] == 100
    assert rows[0]["treatments"] == ["Botox", "Preenchimento"]
    assert never.full_name not in [r["full_name"] for r in rows]
    assert client.get("/api/reports/returns?days=150", headers=auth).json()["patients"] == []


def test_returns_excludes_anonymized(client, auth, setup):
    field = next((n for n in ("anonymized_at", "anonymized") if n in {f.name for f in Patient._meta.get_fields()}), None)
    if field is None:
        pytest.skip("Patient ainda não tem campo de anonimização")
    user, lot = setup
    p = Patient.objects.create(owner=user, full_name="Anon")
    make_app(user, p, lot, 200)
    Patient.objects.filter(pk=p.pk).update(**{field: timezone.now() if field == "anonymized_at" else True})
    assert client.get("/api/reports/returns", headers=auth).json()["patients"] == []


def test_seed_demo_command_idempotent(client, auth):
    user = User.objects.get(email="ana@clinica.com")
    for _ in range(2):
        call_command("seed_demo", email="ana@clinica.com")
    patients = Patient.objects.filter(owner=user)
    assert sorted(p.full_name for p in patients) == ["Ana Exemplo (Demo)", "Bruno Exemplo (Demo)"]
    assert Product.objects.filter(owner=user).count() == 2
    assert Lot.objects.filter(product__owner=user).count() == 2
    assert Application.objects.filter(patient__owner=user).count() == 2
    assert not any(p.photos.exists() for p in patients)
    assert Lot.objects.get(number="DEMO-TOX-001").balance == Decimal("88")
    # a aplicação demo (há 100 dias) aparece no relatório de retorno
    rows = client.get("/api/reports/returns", headers=auth).json()["patients"]
    assert [r["full_name"] for r in rows] == ["Ana Exemplo (Demo)"]


def test_demo_endpoint_only_when_no_patients(client, auth, other_auth, patient):
    assert client.post("/api/demo", headers=auth).json() == {"created": False}  # já tem paciente
    assert Patient.objects.filter(full_name__contains="(Demo)").count() == 0
    assert client.post("/api/demo", headers=other_auth).json() == {"created": True}
    assert client.post("/api/demo", headers=other_auth).json() == {"created": False}
    assert Patient.objects.filter(full_name__contains="(Demo)").count() == 2
    assert client.post("/api/demo").status_code == 401
