"""Financeiro: tabela de preços, orçamento (manual e a partir do plano), pagamentos, estorno e resumo mensal."""
from collections import Counter
from datetime import datetime, time, timedelta

import pytest
from django.contrib import admin
from django.db.models import ProtectedError
from django.utils import timezone

from apps.audit.models import AccessLog
from apps.finance.models import Budget, BudgetItem, Payment, PriceItem

pytestmark = pytest.mark.django_db(transaction=True)

API = "/api/finance"


def price(client, auth, **over):
    body = {"name": "Botox por unidade", "treatment": "botox", "region": None, "unit_price_cents": 1500} | over
    r = client.post(f"{API}/price-items", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def item(description="Consulta", quantity=1, unit_price_cents=10000, **over):
    return {"description": description, "quantity": quantity, "unit_price_cents": unit_price_cents} | over


def budget(client, auth, patient, items=None, **over):
    body = {"patient_id": patient["id"], "items": items or [item()], "discount_cents": 0, "notes": ""} | over
    r = client.post(f"{API}/budgets", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def set_status(client, auth, budget_id, status):
    return client.post(f"{API}/budgets/{budget_id}/status", json={"status": status}, headers=auth)


def approved(client, auth, patient, total=10000, **over):
    b = budget(client, auth, patient, items=[item(unit_price_cents=total)], **over)
    assert set_status(client, auth, b["id"], "aprovado").status_code == 200
    return b


def pay(client, auth, budget_id, amount, method="pix", **over):
    return client.post(
        f"{API}/budgets/{budget_id}/payments", json={"amount_cents": amount, "method": method} | over, headers=auth
    )


def get_budget(client, auth, budget_id):
    r = client.get(f"{API}/budgets/{budget_id}", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def make_plan(client, auth, patient, points):
    body = {"points": [{"x": 0.5, "y": 0.2} | p for p in points]}
    r = client.post(f"/api/patients/{patient['id']}/plans", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


# ---- tabela de preços ----
def test_price_items_create_list_patch_and_isolation(client, auth, other_auth):
    generic = price(client, auth)
    assert generic["id"] and generic["active"] is True and generic["region"] is None and generic["unit_price_cents"] == 1500
    specific = price(client, auth, name="Botox testa", region="testa", unit_price_cents=2000)

    listed = client.get(f"{API}/price-items", headers=auth).json()
    assert {p["id"] for p in listed} == {generic["id"], specific["id"]}
    assert client.get(f"{API}/price-items", headers=other_auth).json() == []
    assert client.patch(f"{API}/price-items/{generic['id']}", json={"active": False}, headers=other_auth).status_code == 404

    r = client.patch(f"{API}/price-items/{generic['id']}", json={"unit_price_cents": 1700, "name": "Botox U"}, headers=auth)
    assert r.status_code == 200 and (r.json()["unit_price_cents"], r.json()["name"]) == (1700, "Botox U")
    off = client.patch(f"{API}/price-items/{generic['id']}", json={"active": False}, headers=auth)
    assert off.json()["active"] is False
    assert PriceItem.objects.filter(pk=generic["id"]).exists()  # desativa em vez de apagar


def test_price_item_validation_and_duplicates(client, auth):
    first = price(client, auth)
    base = {"name": "Outro", "treatment": "botox", "region": None, "unit_price_cents": 1000}
    assert client.post(f"{API}/price-items", json=base, headers=auth).status_code == 409  # mesmo tratamento e região ativos
    assert price(client, auth, region="testa")  # região diferente é outro preço
    for bad in (
        {"treatment": "xyz"}, {"region": "joelho"}, {"unit_price_cents": -1}, {"unit_price_cents": 10.5}, {"name": "  "}, {"name": ""},
    ):
        assert client.post(f"{API}/price-items", json=base | bad, headers=auth).status_code == 422, bad
    # desativado libera a vaga; reativar com outro ativo na vaga é conflito
    client.patch(f"{API}/price-items/{first['id']}", json={"active": False}, headers=auth)
    second = price(client, auth, name="Novo", unit_price_cents=1800)
    assert client.patch(f"{API}/price-items/{first['id']}", json={"active": True}, headers=auth).status_code == 409
    assert client.patch(f"{API}/price-items/{second['id']}", json={"region": "testa"}, headers=auth).status_code == 409
    assert client.patch(f"{API}/price-items/{second['id']}", json={"unit_price_cents": -5}, headers=auth).status_code == 422


# ---- orçamento manual ----
def test_manual_budget_with_discount(client, auth, patient):
    items = [item("Toxina glabela", 2, 15000), item("Skinbooster", 1.5, 1001)]
    b = budget(client, auth, patient, items=items, discount_cents=2000, notes="Pagamento em 2x")
    assert b["status"] == "rascunho" and b["patient_id"] == patient["id"] and b["plan_id"] is None and b["notes"] == "Pagamento em 2x"
    # 2 x 15000 = 30000; 1,5 x 1001 = 1501,5 arredonda para 1502; subtotal 31502; desconto 2000
    assert [i["total_cents"] for i in b["items"]] == [30000, 1502]
    assert (b["subtotal_cents"], b["discount_cents"], b["total_cents"]) == (31502, 2000, 29502)
    assert (b["paid_cents"], b["balance_cents"], b["payments"], b["warnings"]) == (0, 29502, [], [])
    assert b["items"][1]["quantity"] == 1.5 and b["items"][0]["description"] == "Toxina glabela"


def test_budget_validation(client, auth, other_auth, patient):
    body = {"patient_id": patient["id"], "items": [item()], "discount_cents": 0, "notes": ""}
    assert client.post(f"{API}/budgets", json=body | {"discount_cents": 10001}, headers=auth).status_code == 422
    assert client.post(f"{API}/budgets", json=body | {"discount_cents": -1}, headers=auth).status_code == 422
    assert client.post(f"{API}/budgets", json=body | {"items": []}, headers=auth).status_code == 422
    for bad in (item(quantity=0), item(quantity=-1), item(unit_price_cents=-1), item(unit_price_cents=1.5), item(description=" ")):
        assert client.post(f"{API}/budgets", json=body | {"items": [bad]}, headers=auth).status_code == 422, bad
    assert client.post(f"{API}/budgets", json=body, headers=other_auth).status_code == 404  # paciente de outro profissional
    assert client.post(f"{API}/budgets", json=body | {"patient_id": 99999}, headers=auth).status_code == 404

    other_patient = client.post("/api/patients", json={"full_name": "Outra Paciente"}, headers=auth).json()
    plan = make_plan(client, auth, other_patient, [{"region": "testa", "treatment": "botox", "amount": 5}])
    assert client.post(f"{API}/budgets", json=body | {"plan_id": plan["id"]}, headers=auth).status_code == 422  # plano de outro paciente
    assert client.post(f"{API}/budgets", json=body | {"plan_id": 99999}, headers=auth).status_code == 404
    ok = client.post(f"{API}/budgets", json=body | {"patient_id": other_patient["id"], "plan_id": plan["id"]}, headers=auth)
    assert ok.status_code == 201 and ok.json()["plan_id"] == plan["id"]


def test_get_list_filter_and_isolation(client, auth, other_auth, patient):
    a = budget(client, auth, patient)
    other_patient = client.post("/api/patients", json={"full_name": "Outra Paciente"}, headers=auth).json()
    b = budget(client, auth, other_patient)
    set_status(client, auth, b["id"], "recusado")

    assert {x["id"] for x in client.get(f"{API}/budgets", headers=auth).json()} == {a["id"], b["id"]}
    only = client.get(f"{API}/budgets?patient_id={patient['id']}", headers=auth).json()
    assert [x["id"] for x in only] == [a["id"]]
    assert [x["id"] for x in client.get(f"{API}/budgets?status=recusado", headers=auth).json()] == [b["id"]]
    detail = get_budget(client, auth, a["id"])
    assert set(detail) >= {"id", "patient_id", "status", "total_cents", "paid_cents", "balance_cents", "items", "payments"}

    assert client.get(f"{API}/budgets/{a['id']}", headers=other_auth).status_code == 404
    assert client.get(f"{API}/budgets", headers=other_auth).json() == []
    assert client.get(f"{API}/budgets?patient_id={patient['id']}", headers=other_auth).status_code == 404
    assert client.get(f"{API}/budgets/99999", headers=auth).status_code == 404


# ---- orçamento a partir do plano ----
def test_from_plan_uses_price_table_and_warns_when_missing(client, auth, patient):
    price(client, auth, name="Botox U", unit_price_cents=1500)  # genérico
    price(client, auth, name="Botox testa", region="testa", unit_price_cents=2000)  # a região específica vence
    gone = price(client, auth, name="Botox glabela antigo", region="glabela", unit_price_cents=999)
    client.patch(f"{API}/price-items/{gone['id']}", json={"active": False}, headers=auth)  # inativo não conta
    plan = make_plan(client, auth, patient, [
        {"region": "testa", "treatment": "botox", "amount": 10},
        {"region": "testa", "treatment": "botox", "amount": 5.5, "x": 0.3},
        {"region": "glabela", "treatment": "botox", "amount": 20},
        {"region": "malar", "treatment": "preenchimento", "amount": 1},  # sem preço
        {"region": "mento", "treatment": "preenchimento", "amount": 0},  # sem dose: fica de fora
    ])

    r = client.post(f"{API}/budgets/from-plan/{plan['id']}", headers=auth)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "rascunho" and b["plan_id"] == plan["id"] and b["patient_id"] == patient["id"]
    rows = {i["description"]: i for i in b["items"]}
    assert len(rows) == 3
    testa, glabela, malar = rows["Botox — Testa"], rows["Botox — Glabela"], rows["Preenchimento — Malar"]
    assert (testa["quantity"], testa["unit"], testa["unit_price_cents"], testa["total_cents"]) == (15.5, "U", 2000, 31000)
    assert (glabela["quantity"], glabela["unit_price_cents"], glabela["total_cents"]) == (20, 1500, 30000)
    assert (malar["quantity"], malar["unit"], malar["unit_price_cents"], malar["total_cents"]) == (1, "ml", 0, 0)
    assert b["total_cents"] == 61000
    assert len(b["warnings"]) == 1 and "Preenchimento" in b["warnings"][0] and "Malar" in b["warnings"][0]
    assert get_budget(client, auth, b["id"])["warnings"] == []  # o aviso é só da resposta da criação


def test_from_plan_without_prices_and_edge_cases(client, auth, other_auth, patient):
    plan = make_plan(client, auth, patient, [{"region": "testa", "treatment": "botox", "amount": 4}])
    b = client.post(f"{API}/budgets/from-plan/{plan['id']}", headers=auth).json()
    assert [(i["unit_price_cents"], i["total_cents"]) for i in b["items"]] == [(0, 0)] and len(b["warnings"]) == 1

    assert client.post(f"{API}/budgets/from-plan/{plan['id']}", headers=other_auth).status_code == 404
    assert client.post(f"{API}/budgets/from-plan/99999", headers=auth).status_code == 404
    empty = make_plan(client, auth, patient, [{"region": "testa", "treatment": "botox", "amount": 0}])
    assert client.post(f"{API}/budgets/from-plan/{empty['id']}", headers=auth).status_code == 422
    # o preço de outro profissional não vale para este
    price(client, other_auth, unit_price_cents=9999)
    again = client.post(f"{API}/budgets/from-plan/{plan['id']}", headers=auth).json()
    assert again["items"][0]["unit_price_cents"] == 0


# ---- edição do rascunho e estados ----
def test_items_edit_only_while_draft(client, auth, other_auth, patient):
    b = budget(client, auth, patient, items=[item("A", 1, 1000), item("B", 2, 500)])
    a_id, b_id = [i["id"] for i in b["items"]]
    body = {"items": [item("A2", 3, 1000, id=a_id), item("C", 1, 700)], "discount_cents": 100, "notes": "ajustado"}
    r = client.put(f"{API}/budgets/{b['id']}", json=body, headers=auth)
    assert r.status_code == 200, r.text
    out = r.json()
    assert [(i["description"], i["total_cents"]) for i in out["items"]] == [("A2", 3000), ("C", 700)]
    assert out["items"][0]["id"] == a_id and (out["subtotal_cents"], out["total_cents"], out["notes"]) == (3700, 3600, "ajustado")
    assert BudgetItem.objects.get(pk=b_id).active is False  # o item tirado fica guardado, só sai do orçamento

    assert client.put(f"{API}/budgets/{b['id']}", json=body, headers=other_auth).status_code == 404
    foreign = budget(client, auth, patient)["items"][0]["id"]
    assert client.put(f"{API}/budgets/{b['id']}", json={"items": [item(id=foreign)]}, headers=auth).status_code == 422
    assert client.put(f"{API}/budgets/{b['id']}", json={"items": [item()], "discount_cents": 20000}, headers=auth).status_code == 422

    assert set_status(client, auth, b["id"], "aprovado").status_code == 200
    assert client.put(f"{API}/budgets/{b['id']}", json=body, headers=auth).status_code == 409
    assert get_budget(client, auth, b["id"])["total_cents"] == 3600


def test_status_transitions(client, auth, other_auth, patient):
    b = budget(client, auth, patient)
    assert set_status(client, other_auth, b["id"], "aprovado").status_code == 404
    assert client.post(f"{API}/budgets/{b['id']}/status", json={"status": "rascunho"}, headers=auth).status_code == 422
    assert client.post(f"{API}/budgets/{b['id']}/status", json={"status": "xyz"}, headers=auth).status_code == 422

    r = set_status(client, auth, b["id"], "aprovado")
    assert r.status_code == 200 and r.json()["status"] == "aprovado" and r.json()["approved_at"]
    assert set_status(client, auth, b["id"], "aprovado").status_code == 409  # só rascunho vira aprovado
    assert set_status(client, auth, b["id"], "recusado").status_code == 409

    refused = budget(client, auth, patient)
    assert set_status(client, auth, refused["id"], "recusado").json()["status"] == "recusado"
    assert set_status(client, auth, refused["id"], "aprovado").status_code == 409
    assert set_status(client, auth, refused["id"], "cancelado").status_code == 409

    canceled = budget(client, auth, patient)
    assert set_status(client, auth, canceled["id"], "cancelado").json()["status"] == "cancelado"
    assert set_status(client, auth, canceled["id"], "aprovado").status_code == 409


def test_approved_with_payment_cannot_be_canceled_until_reversed(client, auth, patient):
    b = approved(client, auth, patient, total=10000)
    p = pay(client, auth, b["id"], 4000).json()
    assert set_status(client, auth, b["id"], "cancelado").status_code == 409
    assert client.post(f"{API}/payments/{p['id']}/reverse", json={"reason": "Pix devolvido"}, headers=auth).status_code == 201
    assert set_status(client, auth, b["id"], "cancelado").json()["status"] == "cancelado"
    assert pay(client, auth, b["id"], 100).status_code == 409  # cancelado não recebe


# ---- pagamentos ----
def test_payment_rules(client, auth, other_auth, patient):
    draft = budget(client, auth, patient)
    assert pay(client, auth, draft["id"], 1000).status_code == 409  # rascunho não recebe pagamento
    refused = budget(client, auth, patient)
    set_status(client, auth, refused["id"], "recusado")
    assert pay(client, auth, refused["id"], 1000).status_code == 409

    b = approved(client, auth, patient, total=10000)
    assert pay(client, other_auth, b["id"], 1000).status_code == 404
    assert pay(client, auth, 99999, 1000).status_code == 404
    for bad in ({"amount_cents": 0}, {"amount_cents": -100}, {"amount_cents": 10.5}, {"method": "cheque"}):
        r = client.post(f"{API}/budgets/{b['id']}/payments", json={"amount_cents": 100, "method": "pix"} | bad, headers=auth)
        assert r.status_code == 422, bad
    future = (timezone.now() + timedelta(days=30)).isoformat()
    assert pay(client, auth, b["id"], 100, paid_at=future).status_code == 422

    assert pay(client, auth, b["id"], 10001).status_code == 422  # acima do saldo
    assert get_budget(client, auth, b["id"])["balance_cents"] == 10000
    first = pay(client, auth, b["id"], 4000, notes="Entrada")
    assert first.status_code == 201, first.text
    p = first.json()
    assert (p["amount_cents"], p["method"], p["notes"], p["reverses_id"], p["reversed"]) == (4000, "pix", "Entrada", None, False)
    assert p["paid_at"] and p["id"]
    assert pay(client, auth, b["id"], 6001, method="dinheiro").status_code == 422  # saldo agora é 6000

    second = pay(client, auth, b["id"], 6000, method="dinheiro")
    assert second.status_code == 201
    final = get_budget(client, auth, b["id"])
    assert (final["paid_cents"], final["balance_cents"], len(final["payments"])) == (10000, 0, 2)
    assert pay(client, auth, b["id"], 1).status_code == 422  # saldo nunca fica negativo
    assert Payment.objects.filter(budget_id=b["id"]).count() == 2


def test_two_payments_add_up_and_paid_at_is_kept(client, auth, patient):
    b = approved(client, auth, patient, total=9000)
    when = timezone.now() - timedelta(days=3)
    assert pay(client, auth, b["id"], 2500, paid_at=when.isoformat()).status_code == 201
    assert pay(client, auth, b["id"], 2500, method="credito").status_code == 201
    got = get_budget(client, auth, b["id"])
    assert (got["paid_cents"], got["balance_cents"]) == (5000, 4000)
    assert datetime.fromisoformat(got["payments"][0]["paid_at"]) == when


def test_reverse_payment(client, auth, other_auth, patient):
    b = approved(client, auth, patient, total=10000)
    p = pay(client, auth, b["id"], 6000).json()
    assert client.post(f"{API}/payments/{p['id']}/reverse", json={"reason": "x"}, headers=other_auth).status_code == 404
    assert client.post(f"{API}/payments/{p['id']}/reverse", json={"reason": " "}, headers=auth).status_code == 422
    assert client.post(f"{API}/payments/{p['id']}/reverse", json={}, headers=auth).status_code == 422
    assert client.post(f"{API}/payments/99999/reverse", json={"reason": "x"}, headers=auth).status_code == 404

    r = client.post(f"{API}/payments/{p['id']}/reverse", json={"reason": "Lançado em duplicidade"}, headers=auth)
    assert r.status_code == 201, r.text
    rev = r.json()
    assert (rev["amount_cents"], rev["reverses_id"], rev["notes"], rev["method"]) == (-6000, p["id"], "Lançado em duplicidade", "pix")
    got = get_budget(client, auth, b["id"])
    assert (got["paid_cents"], got["balance_cents"], len(got["payments"])) == (0, 10000, 2)
    assert [(x["id"], x["reversed"]) for x in got["payments"]] == [(p["id"], True), (rev["id"], False)]

    assert client.post(f"{API}/payments/{p['id']}/reverse", json={"reason": "de novo"}, headers=auth).status_code == 409  # estorno duplo
    assert client.post(f"{API}/payments/{rev['id']}/reverse", json={"reason": "estornar estorno"}, headers=auth).status_code == 409
    assert Payment.objects.filter(budget_id=b["id"]).count() == 2
    assert pay(client, auth, b["id"], 10000).status_code == 201  # o saldo recomposto pode ser pago de novo


# ---- resumo ----
def test_monthly_summary(client, auth, other_auth, patient):
    today = timezone.localdate()
    first_this = today.replace(day=1)
    first_last = (first_this - timedelta(days=1)).replace(day=1)
    tz = timezone.get_current_timezone()

    def at(day, hour=12):
        return timezone.make_aware(datetime.combine(day, time(hour, 0)), tz)

    this_month, last_month = today.strftime("%Y-%m"), first_last.strftime("%Y-%m")
    a = approved(client, auth, patient, total=10000)
    b = approved(client, auth, patient, total=5000)
    draft = budget(client, auth, patient, items=[item(unit_price_cents=7000)])  # rascunho não entra em nada
    old = approved(client, auth, patient, total=3000)
    Budget.objects.filter(pk=old["id"]).update(approved_at=at(first_last))

    p1 = pay(client, auth, a["id"], 4000, method="pix", paid_at=at(first_this).isoformat()).json()
    assert pay(client, auth, a["id"], 1000, method="dinheiro").status_code == 201  # agora
    assert pay(client, auth, b["id"], 500, method="pix").status_code == 201  # agora
    p_old = pay(client, auth, old["id"], 3000, method="boleto", paid_at=at(first_last).isoformat()).json()
    assert client.post(f"{API}/payments/{p1['id']}/reverse", json={"reason": "erro"}, headers=auth).status_code == 201  # agora, -4000 pix

    s = client.get(f"{API}/summary?month={this_month}", headers=auth)
    assert s.status_code == 200, s.text
    s = s.json()
    assert s["month"] == this_month
    assert s["billed_cents"] == 15000  # aprovados neste mês
    assert s["received_cents"] == 4000 + 1000 + 500 - 4000  # pagamentos do mês, estorno entra negativo
    assert s["open_cents"] == (10000 - 1000) + (5000 - 500)  # saldo atual dos aprovados (a de março já quitada)
    assert s["by_method"] == {"pix": 500, "dinheiro": 1000, "debito": 0, "credito": 0, "boleto": 0, "outro": 0}
    expected_days = Counter()
    for amount, day in ((4000, first_this), (1000, today), (500, today), (-4000, today)):
        expected_days[day.isoformat()] += amount
    assert s["by_day"] == [{"date": d, "received_cents": v} for d, v in sorted(expected_days.items())]

    last = client.get(f"{API}/summary?month={last_month}", headers=auth).json()
    assert (last["billed_cents"], last["received_cents"], last["by_method"]["boleto"]) == (3000, 3000, 3000)
    assert last["by_day"] == [{"date": first_last.isoformat(), "received_cents": 3000}]

    default = client.get(f"{API}/summary", headers=auth).json()
    assert default["month"] == this_month and default["billed_cents"] == 15000
    for bad in ("2026-13", "abc", "2026-1", "2026/11"):
        assert client.get(f"{API}/summary?month={bad}", headers=auth).status_code == 422, bad
    empty = client.get(f"{API}/summary?month={this_month}", headers=other_auth).json()
    assert (empty["billed_cents"], empty["received_cents"], empty["open_cents"], empty["by_day"]) == (0, 0, 0, [])
    assert p_old["id"] and draft["status"] == "rascunho"


# ---- dados ocultos, isolamento, auditoria e retenção ----
def test_hidden_patient_name_never_appears(client, auth, patient):
    b = approved(client, auth, patient, total=10000)
    pay(client, auth, b["id"], 1000)
    plan = make_plan(client, auth, patient, [{"region": "testa", "treatment": "botox", "amount": 4}])
    assert client.post(f"/api/patients/{patient['id']}/anonymize", headers=auth).status_code == 200

    responses = [
        client.get(f"{API}/budgets", headers=auth),
        client.get(f"{API}/budgets?patient_id={patient['id']}", headers=auth),
        client.get(f"{API}/budgets/{b['id']}", headers=auth),
        client.post(f"{API}/budgets/from-plan/{plan['id']}", headers=auth),
    ]
    for r in responses:
        assert r.status_code in (200, 201), r.text
        assert "Maria Paciente" not in r.text
    listed = responses[0].json()
    assert {x["patient_name"] for x in listed} == {"Dados ocultos"} and all(x["patient_hidden"] for x in listed)

    visible = client.post("/api/patients", json={"full_name": "Joana Visível"}, headers=auth).json()
    shown = budget(client, auth, visible)
    assert shown["patient_name"] == "Joana Visível" and shown["patient_hidden"] is False


def test_user_b_cannot_touch_user_a_anything(client, auth, other_auth, patient):
    p_item = price(client, auth)
    b = approved(client, auth, patient, total=10000)
    p = pay(client, auth, b["id"], 1000).json()
    plan = make_plan(client, auth, patient, [{"region": "testa", "treatment": "botox", "amount": 4}])
    calls = [
        client.get(f"{API}/budgets/{b['id']}", headers=other_auth),
        client.put(f"{API}/budgets/{b['id']}", json={"items": [item()]}, headers=other_auth),
        client.post(f"{API}/budgets/{b['id']}/status", json={"status": "cancelado"}, headers=other_auth),
        client.post(f"{API}/budgets/{b['id']}/payments", json={"amount_cents": 100, "method": "pix"}, headers=other_auth),
        client.post(f"{API}/payments/{p['id']}/reverse", json={"reason": "x"}, headers=other_auth),
        client.post(f"{API}/budgets/from-plan/{plan['id']}", headers=other_auth),
        client.patch(f"{API}/price-items/{p_item['id']}", json={"active": False}, headers=other_auth),
        client.post(f"{API}/budgets", json={"patient_id": patient["id"], "items": [item()]}, headers=other_auth),
    ]
    assert [c.status_code for c in calls] == [404] * len(calls)
    after = get_budget(client, auth, b["id"])
    assert (after["status"], after["paid_cents"], len(after["payments"])) == ("aprovado", 1000, 1)
    assert PriceItem.objects.get(pk=p_item["id"]).active is True


def test_requires_login(client):
    for method, path in (
        ("get", "/price-items"), ("post", "/price-items"), ("get", "/budgets"), ("post", "/budgets"), ("get", "/summary"),
        ("post", "/budgets/from-plan/1"), ("get", "/budgets/1"), ("post", "/budgets/1/payments"), ("post", "/payments/1/reverse"),
    ):
        assert getattr(client, method)(f"{API}{path}").status_code == 401, (method, path)


def test_writes_are_audited(client, auth, patient):
    price(client, auth)
    b = approved(client, auth, patient)
    p = pay(client, auth, b["id"], 1000).json()
    client.post(f"{API}/payments/{p['id']}/reverse", json={"reason": "erro"}, headers=auth)
    get_budget(client, auth, b["id"])
    seen = {(l["action"], l["resource"]) for l in client.get("/api/audit", headers=auth).json()}
    assert {
        ("criar", "preco"), ("criar", "orcamento"), ("editar", "orcamento"), ("criar", "pagamento"), ("visualizar", "orcamento"),
    } <= seen
    assert AccessLog.objects.filter(resource="pagamento", action="criar").count() == 2  # o pagamento e o estorno


def test_finance_records_are_never_deleted(client, auth, patient):
    price(client, auth)
    b = approved(client, auth, patient)
    pay(client, auth, b["id"], 1000)
    for model in (PriceItem, Budget, BudgetItem, Payment):
        with pytest.raises(ProtectedError):
            model.objects.first().delete()
        with pytest.raises(ProtectedError):
            model.objects.all().delete()
        assert model in {m.model for m in admin.site._registry.values()}
    paths = client.app.openapi()["paths"]
    assert f"{API}/budgets" in paths
    assert [p for p, methods in paths.items() if p.startswith(API) and "delete" in methods] == []


def test_hidden_patient_free_text_notes_are_not_returned(client, auth, patient):
    b = approved(client, auth, patient, total=10000, notes="Maria, retorno 15/12")
    pay(client, auth, b["id"], 1000, notes="obs: Maria pagou no balcão")
    assert client.post(f"/api/patients/{patient['id']}/anonymize", headers=auth).status_code == 200
    for r in (client.get(f"{API}/budgets", headers=auth), client.get(f"{API}/budgets/{b['id']}", headers=auth)):
        assert r.status_code == 200, r.text
        assert "Maria" not in r.text and "balcão" not in r.text and "15/12" not in r.text
    assert get_budget(client, auth, b["id"])["notes"] == ""

