from datetime import datetime, time, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from api import returns_logic
from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.inventory.models import Application, Lot, Product
from apps.patients.models import Patient
from apps.scheduling.models import Appointment

pytestmark = pytest.mark.django_db(transaction=True)


# ---- helpers ----
def make_product(user, kind="toxina", interval=None, **over):
    return Product.objects.create(
        owner=user, brand="Marca", name=f"Produto {kind}", kind=kind, unit="U" if kind == "toxina" else "ml",
        return_interval_days=interval, **over,
    )


def apply(patient_id, product, days_ago):
    """Aplicação feita há `days_ago` dias (applied_at é auto_now_add, então volta no tempo com update)."""
    lot, _ = Lot.objects.get_or_create(
        product=product, number="L1", defaults={"expires_on": timezone.localdate() + timedelta(days=300), "initial_quantity": 100, "balance": 100}
    )
    owner = product.owner
    a = Application.objects.create(
        patient_id=patient_id, lot=lot, applied_by=owner, amount=Decimal("10"), unit=product.unit, region="testa",
        treatment="botox" if product.kind == "toxina" else "preenchimento",
    )
    Application.objects.filter(pk=a.pk).update(applied_at=timezone.now() - timedelta(days=days_ago))
    return a


def appointment(user, patient_id, days_ahead, status="agendado", hour=10):
    day = timezone.localdate() + timedelta(days=days_ahead)
    start = timezone.make_aware(datetime.combine(day, time(hour, 0)))
    return Appointment.objects.create(
        owner=user, patient_id=patient_id, starts_at=start, ends_at=start + timedelta(hours=1), status=status
    )


def get_returns(client, auth, **params):
    r = client.get("/api/returns", params=params, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def user(auth):
    return User.objects.get(email="ana@clinica.com")


@pytest.fixture
def other_user(other_auth):
    return User.objects.get(email="bruno@clinica.com")


# ---- regra de vencimento ----
def test_toxin_130_days_ago_is_overdue(client, auth, user, patient):
    apply(patient["id"], make_product(user), 130)
    body = get_returns(client, auth)
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert (item["patient_id"], item["patient_name"], item["kind"]) == (patient["id"], "Maria Paciente", "toxina")
    assert (item["status"], item["days_overdue"], item["interval_days"], item["interval_source"]) == ("vencido", 10, 120, "padrao")
    assert item["due_on"] == (timezone.localdate() - timedelta(days=10)).isoformat()
    assert item["last_applied_at"]
    assert item["message"].startswith("Olá, Maria!") and "toxina" in item["message"]
    assert body["defaults"] == {"toxina": 120, "bioestimulador": 180, "preenchedor": 365, "skinbooster": 90}


def test_toxin_100_days_ago_is_upcoming(client, auth, user, patient):
    apply(patient["id"], make_product(user), 100)
    (item,) = get_returns(client, auth)["items"]
    assert (item["status"], item["days_overdue"]) == ("proximo", -20)
    assert item["due_on"] == (timezone.localdate() + timedelta(days=20)).isoformat()


def test_toxin_10_days_ago_is_not_listed(client, auth, user, patient):
    apply(patient["id"], make_product(user), 10)
    assert get_returns(client, auth)["items"] == []


def test_within_days_window_changes_what_is_upcoming(client, auth, user, patient):
    apply(patient["id"], make_product(user), 100)  # vence em 20 dias
    assert get_returns(client, auth, within_days=10)["items"] == []
    assert [i["status"] for i in get_returns(client, auth, within_days=20)["items"]] == ["proximo"]
    for bad in (-1, 366, "abc"):
        assert client.get("/api/returns", params={"within_days": bad}, headers=auth).status_code == 422


def test_due_today_is_upcoming_not_overdue(client, auth, user, patient):
    apply(patient["id"], make_product(user), 120)
    (item,) = get_returns(client, auth)["items"]
    assert (item["status"], item["days_overdue"]) == ("proximo", 0)


def test_default_intervals_by_kind(client, auth, user):
    cases = {"bioestimulador": 180, "preenchedor": 365, "skinbooster": 90}
    for kind, interval in cases.items():
        p = Patient.objects.create(owner=user, full_name=f"Paciente {kind}")
        apply(p.id, make_product(user, kind), interval + 5)
    items = {i["kind"]: i for i in get_returns(client, auth)["items"]}
    assert {k: (v["status"], v["interval_days"], v["interval_source"]) for k, v in items.items()} == {
        k: ("vencido", v, "padrao") for k, v in cases.items()
    }


def test_product_interval_beats_default(client, auth, user, patient):
    apply(patient["id"], make_product(user, interval=60), 70)  # pelo padrão (120) estaria em dia
    (item,) = get_returns(client, auth)["items"]
    assert (item["status"], item["days_overdue"], item["interval_days"], item["interval_source"]) == ("vencido", 10, 60, "produto")


def test_other_kind_has_no_reminder_unless_product_interval_is_set(client, auth, user, patient):
    apply(patient["id"], make_product(user, "outro"), 2000)
    assert get_returns(client, auth)["items"] == []
    other = Patient.objects.create(owner=user, full_name="Com intervalo")
    apply(other.id, make_product(user, "outro", interval=30), 40)
    (item,) = get_returns(client, auth)["items"]
    assert (item["patient_id"], item["kind"], item["interval_source"], item["status"]) == (other.id, "outro", "produto", "vencido")


def test_latest_application_per_kind_is_used_and_each_kind_is_a_row(client, auth, user, patient):
    toxin = make_product(user)
    apply(patient["id"], toxin, 400)
    apply(patient["id"], toxin, 130)  # a mais recente manda
    apply(patient["id"], make_product(user, "preenchedor"), 380)
    items = {i["kind"]: i for i in get_returns(client, auth)["items"]}
    assert set(items) == {"toxina", "preenchedor"}
    assert items["toxina"]["days_overdue"] == 10
    assert items["preenchedor"]["days_overdue"] == 15


def test_interval_comes_from_product_of_latest_application(client, auth, user, patient):
    apply(patient["id"], make_product(user, interval=30), 200)
    apply(patient["id"], make_product(user), 130)  # produto mais novo, sem intervalo: usa o padrão (120)
    (item,) = get_returns(client, auth)["items"]
    assert (item["interval_days"], item["interval_source"], item["days_overdue"]) == (120, "padrao", 10)


def test_ordering_overdue_first_most_overdue_on_top(client, auth, user):
    rows = {"a": 100, "b": 200, "c": 125, "d": 110}
    ids = {}
    for name, ago in rows.items():
        ids[name] = Patient.objects.create(owner=user, full_name=name).id
        apply(ids[name], make_product(user), ago)
    order = [i["patient_id"] for i in get_returns(client, auth)["items"]]
    assert order == [ids["b"], ids["c"], ids["d"], ids["a"]]  # vencidos (80, 5 dias) depois próximos (10 e 20 dias)


# ---- fila ----
def test_future_appointment_removes_patient_from_queue(client, auth, user, patient):
    apply(patient["id"], make_product(user), 130)
    appointment(user, patient["id"], 3, status="agendado")
    assert get_returns(client, auth)["items"] == []


def test_confirmed_future_appointment_also_removes(client, auth, user, patient):
    apply(patient["id"], make_product(user), 130)
    appointment(user, patient["id"], 1, status="confirmado")
    assert get_returns(client, auth)["items"] == []


def test_canceled_or_past_appointment_keeps_patient_in_queue(client, auth, user, patient):
    apply(patient["id"], make_product(user), 130)
    appointment(user, patient["id"], 3, status="cancelado")
    appointment(user, patient["id"], -3, status="realizado")
    assert len(get_returns(client, auth)["items"]) == 1


def test_appointment_later_today_removes_but_yesterday_does_not(client, auth, user, patient):
    apply(patient["id"], make_product(user), 130)
    appointment(user, patient["id"], -1)
    assert len(get_returns(client, auth)["items"]) == 1
    appointment(user, patient["id"], 0, hour=23)
    assert get_returns(client, auth)["items"] == []


def test_patient_without_phone_returns_empty_phone(client, auth, user):
    p = Patient.objects.create(owner=user, full_name="Sem Telefone", phone="")
    apply(p.id, make_product(user), 130)
    (item,) = get_returns(client, auth)["items"]
    assert item["phone"] == ""
    assert item["patient_name"] == "Sem Telefone"


def test_patient_with_phone_returns_it(client, auth, user):
    p = Patient.objects.create(owner=user, full_name="Com Telefone", phone="(11) 98765-4321")
    apply(p.id, make_product(user), 130)
    assert get_returns(client, auth)["items"][0]["phone"] == "(11) 98765-4321"


def test_patient_without_application_is_not_listed(client, auth, user, patient):
    assert get_returns(client, auth)["items"] == []


def test_archived_patient_is_out(client, auth, user, patient):
    apply(patient["id"], make_product(user), 130)
    assert client.post(f"/api/patients/{patient['id']}/archive", headers=auth).status_code == 200
    assert get_returns(client, auth)["items"] == []
    client.post(f"/api/patients/{patient['id']}/unarchive", headers=auth)
    assert len(get_returns(client, auth)["items"]) == 1


def test_hidden_patient_never_leaks_name_or_phone(client, auth, user):
    p = Patient.objects.create(owner=user, full_name="Segredo da Silva", phone="11999998888", email="s@x.com", notes="obs")
    apply(p.id, make_product(user), 130)
    assert client.post(f"/api/patients/{p.id}/anonymize", headers=auth).status_code == 200
    r = client.get("/api/returns", headers=auth)
    (item,) = r.json()["items"]
    assert (item["patient_name"], item["phone"]) == ("Dados ocultos", "")
    assert "Segredo" not in r.text and "11999998888" not in r.text
    assert "Segredo" not in item["message"] and item["message"].startswith("Olá!")


def test_hidden_patient_with_leftover_personal_data_is_still_masked(client, auth, user):
    # Dado inconsistente (marcado como oculto, mas com nome/telefone ainda no cadastro): a rota não confia no cadastro.
    p = Patient.objects.create(
        owner=user, full_name="Segredo da Silva", phone="11999998888", anonymized_at=timezone.now()
    )
    apply(p.id, make_product(user), 130)
    r = client.get("/api/returns", headers=auth)
    (item,) = r.json()["items"]
    assert (item["patient_name"], item["phone"]) == ("Dados ocultos", "")
    assert "Segredo" not in r.text and "11999998888" not in r.text


def test_user_never_sees_another_users_patients(client, auth, other_auth, user, other_user):
    mine = Patient.objects.create(owner=user, full_name="Da Ana")
    theirs = Patient.objects.create(owner=other_user, full_name="Do Bruno")
    apply(mine.id, make_product(user), 130)
    apply(theirs.id, make_product(other_user), 130)
    assert [i["patient_name"] for i in get_returns(client, auth)["items"]] == ["Da Ana"]
    assert [i["patient_name"] for i in get_returns(client, other_auth)["items"]] == ["Do Bruno"]
    # agendamento futuro de outro dono para o mesmo paciente não conta
    appointment(other_user, mine.id, 2)
    assert len(get_returns(client, auth)["items"]) == 1


def test_requires_login(client):
    assert client.get("/api/returns").status_code == 401


def test_listing_writes_audit_log(client, auth, user, patient):
    apply(patient["id"], make_product(user), 130)
    get_returns(client, auth)
    log = AccessLog.objects.filter(user=user, resource="retornos").first()
    assert log is not None and log.action == AccessLog.Action.VIEW


def test_constant_number_of_queries(client, auth, user, django_assert_max_num_queries):
    for i in range(6):
        p = Patient.objects.create(owner=user, full_name=f"P{i}", phone="11999990000")
        apply(p.id, make_product(user, "toxina" if i % 2 else "preenchedor"), 400)
        if i == 0:
            appointment(user, p.id, 5)
    with django_assert_max_num_queries(4):
        returns_logic.due_returns(user, timezone.localdate(), 30)


# ---- função reutilizada pelo assistente ----
def test_due_returns_function(user, patient):
    apply(patient["id"], make_product(user), 130)
    today = timezone.localdate()
    (item,) = returns_logic.due_returns(user, today, 30)
    assert item["status"] == "vencido" and item["patient_id"] == patient["id"]
    assert item["due_on"] == (today - timedelta(days=10)).isoformat()  # datas em ISO, prontas para JSON
    # `today` é parâmetro: daqui a 200 dias o mesmo paciente continua vencido; 100 dias atrás ainda estava em dia
    assert returns_logic.due_returns(user, today - timedelta(days=100), 30) == []
    assert returns_logic.due_returns(user, today + timedelta(days=200), 30)[0]["days_overdue"] == 210


# ---- intervalo por produto (PATCH do estoque) ----
def test_product_patch_return_interval(client, auth, other_auth):
    prod = client.post(
        "/api/inventory/products", json={"brand": "A", "name": "B", "kind": "toxina", "unit": "U"}, headers=auth
    ).json()
    assert prod["return_interval_days"] is None
    url = f"/api/inventory/products/{prod['id']}"
    r = client.patch(url, json={"return_interval_days": 90}, headers=auth)
    assert r.status_code == 200 and r.json()["return_interval_days"] == 90
    assert client.get("/api/inventory/products", headers=auth).json()[0]["return_interval_days"] == 90
    # outro campo no PATCH não mexe no intervalo
    assert client.patch(url, json={"brand": "C"}, headers=auth).json()["return_interval_days"] == 90
    # null limpa (volta ao padrão do tipo)
    r = client.patch(url, json={"return_interval_days": None}, headers=auth)
    assert r.status_code == 200 and r.json()["return_interval_days"] is None
    # limites
    assert client.patch(url, json={"return_interval_days": 1}, headers=auth).status_code == 200
    assert client.patch(url, json={"return_interval_days": 1825}, headers=auth).status_code == 200
    for bad in (0, -5, 1826, "abc", 1.5):
        assert client.patch(url, json={"return_interval_days": bad}, headers=auth).status_code == 422, bad
    assert client.get("/api/inventory/products", headers=auth).json()[0]["return_interval_days"] == 1825
    # outro profissional não altera
    assert client.patch(url, json={"return_interval_days": 10}, headers=other_auth).status_code == 404


def test_product_create_does_not_require_interval(client, auth):
    r = client.post("/api/inventory/products", json={"brand": "A", "name": "B"}, headers=auth)
    assert r.status_code == 201 and r.json()["return_interval_days"] is None
