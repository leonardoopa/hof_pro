"""Histórico do paciente: uma linha do tempo só leitura, do mais novo para o mais antigo."""

from datetime import datetime, timedelta

import pytest
from django.utils import timezone

from apps.clinical.models import FacialPlan
from apps.consent.models import Signature, Term
from apps.inventory.models import Application
from tests.conftest import png_bytes
from tests.test_inventory_consent import lot, plan_with, product, signature_data

pytestmark = pytest.mark.django_db(transaction=True)


def url(patient, **query):
    extra = "".join(f"&{k}={v}" for k, v in query.items())
    return f"/api/patients/{patient['id']}/timeline?{extra.lstrip('&')}"


def kinds(client, headers, patient, **query):
    return [i["kind"] for i in client.get(url(patient, **query), headers=headers).json()["items"]]


def term_v1(kind, title):
    # No primeiro teste da sessão os termos semeados pela migration ainda estão no banco.
    return Term.objects.update_or_create(kind=kind, version=1, defaults={"title": title, "content": "Texto do termo."})[0]


def full_history(client, auth, patient, questions):
    """Plano aplicado (plano + aplicação), termo, intercorrência, agendamento, foto e anamnese."""
    pid = patient["id"]
    prod = product(client, auth)
    batch = lot(client, auth, prod["id"], "L1", quantity=100).json()
    body = {
        "title": "Plano da Maria",
        "points": [
            {"region": "testa", "treatment": "botox", "x": 0.5, "y": 0.2, "amount": 10, "lot_id": batch["id"]},
            {"region": "glabela", "treatment": "botox", "x": 0.5, "y": 0.3, "amount": 20, "lot_id": batch["id"]},
        ],
    }
    plan = client.post(f"/api/patients/{pid}/plans", json=body, headers=auth).json()
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200

    term = term_v1("botox", "Termo Botox")
    signed = client.post(
        f"/api/patients/{pid}/consents",
        json={"term_id": term.id, "signer_name": "Maria Paciente", "signature": signature_data()},
        headers=auth,
    )
    assert signed.status_code == 201, signed.text

    event = {"kind": "hematoma", "severity": "leve", "onset_at": timezone.now().isoformat(), "description": "Maria chamou"}
    assert client.post(f"/api/patients/{pid}/adverse-events", json=event, headers=auth).status_code == 201

    start = timezone.now() + timedelta(days=7)
    appt = {"patient_id": pid, "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat(), "kind": "Retorno da Maria", "notes": "Maria pediu"}
    assert client.post("/api/appointments", json=appt, headers=auth).status_code == 201

    photo = client.post(f"/api/patients/{pid}/photos", files={"file": ("a.png", png_bytes(), "image/png")}, headers=auth)
    assert photo.status_code == 201, photo.text

    answers = [{"question_id": questions[0].id, "answer": True, "detail": "Dipirona"}, {"question_id": questions[1].id, "answer": False}]
    assert client.put(f"/api/patients/{pid}/anamnesis", json={"notes": "Maria disse", "answers": answers}, headers=auth).status_code == 200
    return plan


def test_timeline_has_every_kind_newest_first_with_refs(client, auth, patient, questions):
    plan = full_history(client, auth, patient, questions)
    items = client.get(url(patient), headers=auth).json()["items"]

    assert sorted(i["kind"] for i in items) == sorted(["plano", "aplicacao", "termo", "intercorrencia", "agendamento", "foto", "anamnese"])
    ats = [datetime.fromisoformat(i["at"]) for i in items]  # texto não ordena: "…39Z" vem sem fração
    assert ats == sorted(ats, reverse=True)
    assert items[0]["kind"] == "agendamento"  # o único marcado para o futuro

    by_kind = {i["kind"]: i for i in items}
    assert by_kind["plano"]["ref"] == {"type": "plan", "id": plan["id"]}
    assert by_kind["aplicacao"]["ref"] == {"type": "plan", "id": plan["id"]}
    assert by_kind["intercorrencia"]["ref"]["type"] == "adverse_event"
    assert by_kind["termo"]["ref"]["type"] == "signature" and by_kind["foto"]["ref"]["type"] == "photo"
    assert by_kind["agendamento"]["ref"]["type"] == "appointment" and by_kind["anamnese"]["ref"]["type"] == "anamnesis"
    for item in items:
        assert item["title"] and set(item) == {"at", "kind", "title", "detail", "ref"}

    # Uma linha por tipo de aplicação do plano (dois pontos de toxina = uma aplicação), com região, dose e lote.
    assert by_kind["aplicacao"]["title"] == "Aplicação de toxina"
    assert by_kind["aplicacao"]["detail"] == "Testa 10 U, Glabela 20 U · lote L1"
    assert by_kind["plano"]["title"] == "Plano da Maria"
    assert by_kind["intercorrencia"]["title"] == "Intercorrência: Hematoma"
    assert by_kind["termo"]["title"] == "Termo assinado: Termo Botox"
    assert by_kind["anamnese"]["title"] == "Anamnese salva (versão 1)"
    assert by_kind["anamnese"]["detail"] == "1 resposta positiva"


def test_order_follows_the_dates_not_the_kind(client, auth, patient, questions):
    plan = full_history(client, auth, patient, questions)
    now = timezone.now()
    FacialPlan.objects.filter(pk=plan["id"]).update(created_at=now - timedelta(days=400))
    Signature.objects.update(signed_at=now - timedelta(days=30))
    Application.objects.update(applied_at=now - timedelta(days=10))
    items = client.get(url(patient), headers=auth).json()["items"]
    order = [i["kind"] for i in items]
    assert order.index("termo") > order.index("aplicacao")
    assert order[-1] == "plano"


def test_revoked_image_term_adds_its_own_line(client, auth, patient):
    term = term_v1("uso_imagem", "Uso de imagem")
    signed = client.post(
        f"/api/patients/{patient['id']}/consents",
        json={"term_id": term.id, "signer_name": "Maria Paciente", "signature": signature_data()},
        headers=auth,
    ).json()
    assert client.post(f"/api/consents/{signed['id']}/revoke", headers=auth).status_code == 200
    items = client.get(url(patient), headers=auth).json()["items"]
    assert [(i["kind"], i["title"]) for i in items] == [
        ("termo", "Termo revogado: Uso de imagem"),
        ("termo", "Termo assinado: Uso de imagem"),
    ]


def test_other_user_gets_404_and_anonymous_401(client, auth, other_auth, patient, questions):
    full_history(client, auth, patient, questions)
    assert client.get(url(patient), headers=other_auth).status_code == 404
    assert client.get(url(patient)).status_code == 401
    assert client.get("/api/patients/99999/timeline", headers=auth).status_code == 404
    assert client.get(url(patient), headers=auth).status_code == 200


def test_one_user_never_sees_the_other_users_items(client, auth, other_auth, patient):
    # Mesmo que um registro de outro dono aponte para o paciente, o histórico só traz o que é do dono do paciente.
    from apps.accounts.models import User
    from apps.scheduling.models import Appointment

    start = timezone.now() + timedelta(days=2)
    stranger = User.objects.get(email="bruno@clinica.com")
    Appointment.objects.create(
        owner=stranger, patient_id=patient["id"], starts_at=start, ends_at=start + timedelta(hours=1), kind="De outro dono"
    )
    assert client.get(url(patient), headers=auth).json()["items"] == []


def test_hidden_patient_never_shows_personal_data(client, auth, patient, questions):
    full_history(client, auth, patient, questions)
    assert client.post(f"/api/patients/{patient['id']}/anonymize", headers=auth).status_code == 200
    r = client.get(url(patient), headers=auth)
    assert r.status_code == 200
    text = r.text
    for leak in ["Maria", "Paciente", "Retorno da", "chamou", "pediu", "disse", "Dipirona"]:
        assert leak not in text, leak
    items = r.json()["items"]
    assert "foto" not in {i["kind"] for i in items}  # a lista de fotos também some com os dados ocultos
    assert {"plano", "aplicacao", "termo", "intercorrencia", "agendamento", "anamnese"} <= {i["kind"] for i in items}
    assert [i["title"] for i in items if i["kind"] == "plano"] == ["Plano facial"]
    assert [i["title"] for i in items if i["kind"] == "agendamento"] == ["Agendamento"]


def test_limit_is_respected_and_validated(client, auth, patient, questions):
    full_history(client, auth, patient, questions)
    everything = client.get(url(patient), headers=auth).json()["items"]
    assert len(everything) == 7  # o padrão (100) traz tudo
    two = client.get(url(patient, limit=2), headers=auth).json()["items"]
    assert two == everything[:2]  # os mais novos
    assert len(client.get(url(patient, limit=1), headers=auth).json()["items"]) == 1
    assert len(client.get(url(patient, limit=300), headers=auth).json()["items"]) == 7
    for bad in (0, -1, 301, "abc"):
        assert client.get(url(patient, limit=bad), headers=auth).status_code == 422, bad


def test_empty_history_and_access_is_logged(client, auth, patient):
    assert client.get(url(patient), headers=auth).json() == {"items": []}
    logs = [(l["action"], l["resource"], l["resource_id"]) for l in client.get("/api/audit", headers=auth).json()]
    assert ("visualizar", "historico", patient["id"]) in logs


def test_application_without_plan_still_appears(client, auth, patient):
    prod = product(client, auth)
    batch = lot(client, auth, prod["id"], "L9", quantity=100).json()
    plan = plan_with(client, auth, patient, batch["id"], amount=5).json()
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200
    Application.objects.all().update(plan=None, point=None)
    items = client.get(url(patient), headers=auth).json()["items"]
    assert [(i["kind"], i["detail"], i["ref"]["type"]) for i in items if i["kind"] == "aplicacao"] == [
        ("aplicacao", "Testa 5 U · lote L9", "application")
    ]


def test_budget_and_payment_show_up_without_free_text(client, auth, patient):
    from apps.finance.models import Budget, BudgetItem, Payment
    from apps.accounts.models import User
    from apps.patients.models import Patient

    user = User.objects.get(email="ana@clinica.com")
    pat = Patient.objects.get(pk=patient["id"])
    budget = Budget.objects.create(owner=user, patient=pat, status="aprovado", approved_at=timezone.now(), notes="segredo")
    BudgetItem.objects.create(budget=budget, description="Botox — Testa", quantity=1, unit_price_cents=50000)
    Payment.objects.create(budget=budget, amount_cents=20000, method="pix", paid_at=timezone.now(), notes="obs livre", created_by=user)
    items = client.get(url(patient), headers=auth).json()["items"]
    by_kind = {i["kind"]: i for i in items}
    assert by_kind["orcamento"]["ref"] == {"type": "budget", "id": budget.id}
    assert "R$ 500,00" in by_kind["orcamento"]["detail"] and "Aprovado" in by_kind["orcamento"]["detail"]
    assert by_kind["pagamento"]["title"] == "Pagamento recebido" and "R$ 200,00" in by_kind["pagamento"]["detail"]
    assert "segredo" not in str(items) and "obs livre" not in str(items)
