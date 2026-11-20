from datetime import date, datetime, time, timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.assistant import actions as assistant_actions
from apps.assistant import registry
from apps.assistant.models import AssistantProposal
from apps.audit.models import AccessLog
from apps.scheduling.models import Appointment
from api.routers import assistant as assistant_router
from tests.test_inventory_consent import applied_patient

pytestmark = pytest.mark.django_db(transaction=True)

INITIAL_ACTIONS = {
    "search_patients", "list_free_slots", "create_appointment", "reschedule_appointment", "cancel_appointment",
    "get_patient_summary",
}
WRITES = {"create_appointment", "reschedule_appointment", "cancel_appointment"}


# ---- helpers ----
@pytest.fixture
def clock(client):
    """Relógio da API controlável: `clock.now` é o instante atual; `clock.advance(minutes=11)` o move."""

    class Clock:
        now = timezone.now()

        def advance(self, **kw):
            self.now = self.now + timedelta(**kw)

    c = Clock()
    client.app.dependency_overrides[assistant_router.clock] = lambda: c.now
    yield c
    client.app.dependency_overrides.pop(assistant_router.clock, None)


def future_day(offset=30) -> date:
    return timezone.localdate() + timedelta(days=offset)


def at(day: date, hour: int, minute: int = 0) -> str:
    return timezone.make_aware(datetime.combine(day, time(hour, minute))).isoformat()


def propose(client, headers, name, params):
    return client.post(f"/api/assistant/actions/{name}/propose", json={"params": params}, headers=headers)


def confirm(client, headers, proposal_id):
    return client.post(f"/api/assistant/proposals/{proposal_id}/confirm", headers=headers)


def create_params(patient_id, day=None, hour=14, **over):
    day = day or future_day()
    return {"patient_id": patient_id, "starts_at": at(day, hour), "ends_at": at(day, hour + 1), **over}


def same(dt, iso: str) -> bool:
    """Compara instantes (o banco devolve UTC, a API local)."""
    return dt == datetime.fromisoformat(iso.replace("Z", "+00:00"))


def make_appointment(client, headers, patient_id, day=None, hour=14):
    day = day or future_day()
    r = client.post(
        "/api/appointments",
        json={"patient_id": patient_id, "starts_at": at(day, hour), "ends_at": at(day, hour + 1)},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def hide(client, headers, patient_id):
    assert client.post(f"/api/patients/{patient_id}/anonymize", headers=headers).status_code == 200


def assistant_logs(user_email="ana@clinica.com"):
    return list(AccessLog.objects.filter(user__email=user_email, resource="assistente").order_by("id"))


# ---- catálogo e registro ----
def test_catalog_lists_actions_with_schema(client, auth):
    assert client.get("/api/assistant/actions").status_code == 401
    r = client.get("/api/assistant/actions", headers=auth)
    assert r.status_code == 200
    catalog = {a["name"]: a for a in r.json()}
    assert INITIAL_ACTIONS <= set(catalog)
    for name, entry in catalog.items():
        assert set(entry) == {"name", "description", "writes", "params_schema"}
        assert entry["description"] and entry["params_schema"]["type"] == "object"
        assert entry["writes"] is (name in WRITES)
    assert "starts_at" in catalog["create_appointment"]["params_schema"]["properties"]


def test_registry_get_and_catalog():
    assert registry.get("search_patients").name == "search_patients"
    assert registry.get("nao_existe") is None
    assert [a["name"] for a in registry.catalog()][:1] == ["search_patients"]


def test_list_returns_due_is_registered_only_when_returns_logic_exists():
    try:
        from api.returns_logic import due_returns  # noqa: F401
    except ImportError:
        assert registry.get("list_returns_due") is None
    else:
        action = registry.get("list_returns_due")
        assert action is not None and action.writes is False


def test_list_returns_due_masks_hidden_patients(client, auth, patient):
    other = client.post("/api/patients", json={"full_name": "Joana Oculta", "phone": "11999990000"}, headers=auth).json()
    hide(client, auth, other["id"])
    user = User.objects.get(email="ana@clinica.com")

    def fake_due(u, today, within_days):
        assert u.pk == user.pk and within_days == 30
        return [
            {"patient_id": patient["id"], "patient_name": "Maria Paciente", "phone": "11911112222", "message": "Olá, Maria!"},
            {"patient_id": other["id"], "patient_name": "Joana Oculta", "phone": "11999990000", "message": "Olá, Joana!"},
        ]

    action = assistant_actions.make_list_returns_due(fake_due)
    assert action.writes is False
    result = action.run(user, action.params_model())
    by_id = {i["patient_id"]: i for i in result["items"]}
    assert by_id[patient["id"]]["patient_name"] == "Maria Paciente"
    hidden = by_id[other["id"]]
    assert hidden["patient_name"] == "Dados ocultos" and hidden["phone"] == "" and hidden["message"] == ""
    assert "Joana" not in str(result) and "11999990000" not in str(result)


# ---- leitura ----
def test_search_patients_executes_and_audits(client, auth, other_auth, patient):
    client.post("/api/patients", json={"full_name": "Mariana Souza", "phone": "11988887777"}, headers=other_auth)
    r = propose(client, auth, "search_patients", {"query": "maria"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["writes"] is False
    assert [p["full_name"] for p in body["result"]["patients"]] == ["Maria Paciente"]
    assert "Mariana" not in r.text

    row = AssistantProposal.objects.get()
    assert row.action == "search_patients" and row.state == "executada" and row.writes is False
    assert [(l.action, l.resource_id) for l in assistant_logs()] == [("visualizar", row.id)]
    # leitura não tem o que confirmar
    assert confirm(client, auth, row.id).status_code == 409


def test_search_patients_never_exposes_hidden_patient_data(client, auth, patient):
    other = client.post("/api/patients", json={"full_name": "Joana Oculta", "phone": "11999990000"}, headers=auth).json()
    hide(client, auth, other["id"])
    for query in ("joana", "11999990000", "ocultos"):
        r = propose(client, auth, "search_patients", {"query": query})
        assert r.status_code == 200
        assert "Joana" not in str(r.json()["result"]) and "11999990000" not in str(r.json()["result"])  # o resumo ecoa só a busca
    found = propose(client, auth, "search_patients", {"query": "ocultos"}).json()["result"]["patients"]
    assert found and found[0]["full_name"] == "Dados ocultos" and found[0]["phone"] == "" and found[0]["hidden"] is True


def test_search_patients_skips_archived_and_validates_query(client, auth, patient):
    assert client.post(f"/api/patients/{patient['id']}/archive", headers=auth).status_code == 200
    assert propose(client, auth, "search_patients", {"query": "maria"}).json()["result"]["patients"] == []
    assert propose(client, auth, "search_patients", {"query": "m"}).status_code == 422
    assert propose(client, auth, "search_patients", {}).status_code == 422


def test_list_free_slots_respects_agenda(client, auth, other_auth, patient):
    day = future_day()
    other_patient = client.post("/api/patients", json={"full_name": "Paciente do Bruno"}, headers=other_auth).json()
    make_appointment(client, auth, patient["id"], day, hour=9)  # 09:00-10:00
    make_appointment(client, other_auth, other_patient["id"], day, hour=11)  # de outro usuário: não bloqueia
    canceled = make_appointment(client, auth, patient["id"], day, hour=15)
    client.post(f"/api/appointments/{canceled['id']}/status", json={"status": "cancelado"}, headers=auth)

    params = {"date_from": day.isoformat(), "date_to": day.isoformat(), "start_time": "08:00", "end_time": "17:00",
              "duration_minutes": 60, "step_minutes": 60, "limit": 50}
    r = propose(client, auth, "list_free_slots", params)
    assert r.status_code == 200, r.text
    starts = [s["starts_at"] for s in r.json()["result"]["slots"]]
    assert at(day, 8) in starts and at(day, 11) in starts and at(day, 15) in starts
    assert at(day, 9) not in starts
    assert r.json()["result"]["truncated"] is False

    # janela de 90 min a cada 30 min: 08:30 invade o compromisso das 09:00
    params |= {"duration_minutes": 90, "step_minutes": 30}
    starts = [s["starts_at"] for s in propose(client, auth, "list_free_slots", params).json()["result"]["slots"]]
    assert at(day, 8) not in starts and at(day, 7, 30) not in starts and at(day, 10) in starts


def test_list_free_slots_limit_and_validation(client, auth):
    day = future_day()
    params = {"date_from": day.isoformat(), "date_to": day.isoformat(), "limit": 3}
    result = propose(client, auth, "list_free_slots", params).json()["result"]
    assert len(result["slots"]) == 3 and result["truncated"] is True
    too_long = params | {"date_to": (day + timedelta(days=40)).isoformat()}
    assert propose(client, auth, "list_free_slots", too_long).status_code == 422
    backwards = params | {"date_to": (day - timedelta(days=1)).isoformat()}
    assert propose(client, auth, "list_free_slots", backwards).status_code == 422
    inverted = params | {"start_time": "18:00", "end_time": "08:00"}
    assert propose(client, auth, "list_free_slots", inverted).status_code == 422


def test_get_patient_summary(client, auth, other_auth, patient):
    applied_patient(client, auth, patient)
    make_appointment(client, auth, patient["id"], future_day(), hour=10)
    r = propose(client, auth, "get_patient_summary", {"patient_id": patient["id"]})
    assert r.status_code == 200, r.text
    s = r.json()["result"]
    assert s["patient"] == {"id": patient["id"], "full_name": "Maria Paciente", "phone": "", "hidden": False}
    assert s["plans"]["total"] == 1 and s["plans"]["applied"] == 1
    assert s["last_application"]["treatment"] == "botox"
    assert s["next_appointment"]["starts_at"] == at(future_day(), 10)
    assert s["open_adverse_events"] == 0 and s["anamnesis_saved"] is False

    assert propose(client, other_auth, "get_patient_summary", {"patient_id": patient["id"]}).status_code == 404


def test_get_patient_summary_hides_personal_data(client, auth, patient):
    client.patch(f"/api/patients/{patient['id']}", json={"phone": "11977776666"}, headers=auth)
    hide(client, auth, patient["id"])
    r = propose(client, auth, "get_patient_summary", {"patient_id": patient["id"]})
    assert r.status_code == 200
    assert "Maria" not in r.text and "11977776666" not in r.text
    assert r.json()["result"]["patient"] == {"id": patient["id"], "full_name": "Dados ocultos", "phone": "", "hidden": True}


# ---- escrita: propor e confirmar ----
def test_create_appointment_proposes_then_confirms(client, auth, patient, clock):
    day = future_day()
    r = propose(client, auth, "create_appointment", create_params(patient["id"], day, kind="Retorno"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["writes"] is True and body["result"] is None
    assert "Maria Paciente" in body["summary"] and day.strftime("%d/%m/%Y") in body["summary"] and "14:00" in body["summary"]
    assert body["params"]["patient_id"] == patient["id"] and body["params"]["kind"] == "Retorno"
    assert datetime.fromisoformat(body["expires_at"]) == clock.now + timedelta(minutes=10)

    # propor NÃO grava o agendamento
    assert Appointment.objects.count() == 0
    row = AssistantProposal.objects.get(pk=body["proposal_id"])
    assert row.state == "pendente" and row.writes is True and row.params["patient_id"] == patient["id"]
    assert row.expires_at == clock.now + timedelta(minutes=10)

    c = confirm(client, auth, body["proposal_id"])
    assert c.status_code == 200, c.text
    appt = c.json()["result"]["appointment"]
    assert Appointment.objects.count() == 1
    saved = Appointment.objects.get()
    assert appt["id"] == saved.id and saved.owner.email == "ana@clinica.com" and saved.patient_id == patient["id"]
    assert saved.kind == "Retorno" and same(saved.starts_at, appt["starts_at"])
    assert AssistantProposal.objects.get().state == "executada"

    # a agenda normal enxerga o agendamento
    listed = client.get(f"/api/appointments?from={day}&to={day}", headers=auth).json()
    assert [a["id"] for a in listed] == [saved.id]


def test_confirm_twice_does_not_duplicate_effect(client, auth, patient, clock):
    pid = propose(client, auth, "create_appointment", create_params(patient["id"])).json()["proposal_id"]
    first = confirm(client, auth, pid)
    clock.advance(minutes=30)  # mesmo vencida, a 2ª chamada devolve o resultado já gravado
    second = confirm(client, auth, pid)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert Appointment.objects.count() == 1


def test_expired_proposal_is_refused_with_410(client, auth, patient, clock):
    on_time = propose(client, auth, "create_appointment", create_params(patient["id"])).json()["proposal_id"]
    late = propose(client, auth, "create_appointment", create_params(patient["id"], hour=10)).json()["proposal_id"]

    clock.advance(minutes=10)  # no limite exato ainda vale
    assert confirm(client, auth, on_time).status_code == 200

    clock.advance(seconds=1)
    r = confirm(client, auth, late)
    assert r.status_code == 410, r.text
    assert Appointment.objects.count() == 1
    assert AssistantProposal.objects.get(pk=late).state == "vencida"
    assert confirm(client, auth, late).status_code == 410  # continua vencida


def test_other_user_cannot_see_or_confirm_proposal(client, auth, other_auth, patient):
    pid = propose(client, auth, "create_appointment", create_params(patient["id"])).json()["proposal_id"]
    assert confirm(client, other_auth, pid).status_code == 404
    assert Appointment.objects.count() == 0
    assert AssistantProposal.objects.get().state == "pendente"
    assert confirm(client, auth, 99999).status_code == 404
    assert client.post(f"/api/assistant/proposals/{pid}/confirm").status_code == 401


def test_other_user_cannot_use_foreign_patient_or_appointment(client, auth, other_auth, patient):
    appt = make_appointment(client, auth, patient["id"])
    assert propose(client, other_auth, "create_appointment", create_params(patient["id"], hour=9)).status_code == 404
    new = {"appointment_id": appt["id"], "starts_at": at(future_day(), 9), "ends_at": at(future_day(), 10)}
    assert propose(client, other_auth, "reschedule_appointment", new).status_code == 404
    assert propose(client, other_auth, "cancel_appointment", {"appointment_id": appt["id"]}).status_code == 404
    assert AssistantProposal.objects.count() == 0


def test_owner_and_user_id_params_are_ignored(client, auth, other_auth, patient):
    other_id = User.objects.get(email="bruno@clinica.com").id
    me = User.objects.get(email="ana@clinica.com")
    params = create_params(patient["id"]) | {"owner": other_id, "owner_id": other_id, "user_id": other_id, "user": other_id}
    r = propose(client, auth, "create_appointment", params)
    assert r.status_code == 200, r.text
    assert not {"owner", "owner_id", "user_id", "user"} & set(r.json()["params"])
    assert not {"owner", "owner_id", "user_id", "user"} & set(AssistantProposal.objects.get().params)
    assert confirm(client, auth, r.json()["proposal_id"]).status_code == 200
    assert Appointment.objects.get().owner_id == me.id

    # em leitura também: o outro usuário não ganha acesso a pacientes alheios por parâmetro
    found = propose(client, other_auth, "search_patients", {"query": "maria", "user_id": me.id, "owner": me.id})
    assert found.json()["result"]["patients"] == []


def test_unknown_action_is_404(client, auth):
    assert propose(client, auth, "apagar_tudo", {}).status_code == 404
    assert client.post("/api/assistant/actions/search_patients/propose", json={"params": {"query": "ma"}}).status_code == 401


def test_invalid_params_are_422_and_leave_no_row(client, auth, patient):
    day = future_day()
    bad_order = {"patient_id": patient["id"], "starts_at": at(day, 15), "ends_at": at(day, 14)}
    assert propose(client, auth, "create_appointment", bad_order).status_code == 422
    assert propose(client, auth, "create_appointment", {"starts_at": at(day, 9), "ends_at": at(day, 10)}).status_code == 422
    assert propose(client, auth, "create_appointment", {"patient_id": patient["id"], "starts_at": "amanhã"}).status_code == 422
    assert AssistantProposal.objects.count() == 0 and Appointment.objects.count() == 0


def test_create_appointment_conflict_becomes_409_on_confirm(client, auth, patient):
    day = future_day()
    pid = propose(client, auth, "create_appointment", create_params(patient["id"], day, hour=14)).json()["proposal_id"]
    make_appointment(client, auth, patient["id"], day, hour=14)  # alguém ocupa o horário entre propor e confirmar

    r = confirm(client, auth, pid)
    assert r.status_code == 409, r.text
    assert "conflito" in r.json()["detail"].lower()
    assert Appointment.objects.count() == 1
    row = AssistantProposal.objects.get(pk=pid)
    assert row.state == "falhou" and row.error_status == 409

    again = confirm(client, auth, pid)  # nova tentativa devolve a mesma falha, sem rodar de novo
    assert again.status_code == 409 and again.json() == r.json()
    assert Appointment.objects.count() == 1


def test_reschedule_appointment(client, auth, patient):
    day = future_day()
    appt = make_appointment(client, auth, patient["id"], day, hour=9)
    other = make_appointment(client, auth, patient["id"], day, hour=13)
    params = {"appointment_id": appt["id"], "starts_at": at(day, 16), "ends_at": at(day, 17)}

    r = propose(client, auth, "reschedule_appointment", params)
    assert r.status_code == 200 and "Maria Paciente" in r.json()["summary"] and "16:00" in r.json()["summary"]
    assert same(Appointment.objects.get(pk=appt["id"]).starts_at, appt["starts_at"])  # propor não move

    c = confirm(client, auth, r.json()["proposal_id"])
    assert c.status_code == 200, c.text
    assert same(Appointment.objects.get(pk=appt["id"]).starts_at, at(day, 16))
    assert c.json()["result"]["appointment"]["id"] == appt["id"]

    # conflito com outro agendamento do mesmo profissional
    clash = propose(client, auth, "reschedule_appointment", params | {"starts_at": at(day, 13), "ends_at": at(day, 14)})
    assert confirm(client, auth, clash.json()["proposal_id"]).status_code == 409
    assert same(Appointment.objects.get(pk=other["id"]).starts_at, at(day, 13))
    assert AssistantProposal.objects.get(pk=clash.json()["proposal_id"]).state == "falhou"


def test_reschedule_into_its_own_slot_is_not_a_conflict(client, auth, patient):
    day = future_day()
    appt = make_appointment(client, auth, patient["id"], day, hour=9)
    params = {"appointment_id": appt["id"], "starts_at": at(day, 9), "ends_at": at(day, 11)}
    pid = propose(client, auth, "reschedule_appointment", params).json()["proposal_id"]
    assert confirm(client, auth, pid).status_code == 200


def test_cancel_appointment_frees_the_slot(client, auth, patient):
    day = future_day()
    appt = make_appointment(client, auth, patient["id"], day, hour=9)
    r = propose(client, auth, "cancel_appointment", {"appointment_id": appt["id"]})
    assert r.status_code == 200 and "Maria Paciente" in r.json()["summary"]
    assert Appointment.objects.get().status == "agendado"  # propor não cancela

    c = confirm(client, auth, r.json()["proposal_id"])
    assert c.status_code == 200 and c.json()["result"]["appointment"]["status"] == "cancelado"
    assert Appointment.objects.get().status == "cancelado"

    # cancelar de novo (nova proposta) é recusado; remarcar cancelado também
    again = propose(client, auth, "cancel_appointment", {"appointment_id": appt["id"]})
    assert confirm(client, auth, again.json()["proposal_id"]).status_code == 409
    move = {"appointment_id": appt["id"], "starts_at": at(day, 10), "ends_at": at(day, 11)}
    assert confirm(client, auth, propose(client, auth, "reschedule_appointment", move).json()["proposal_id"]).status_code == 409


def test_write_results_and_summaries_never_expose_hidden_patient(client, auth, patient):
    client.patch(f"/api/patients/{patient['id']}", json={"phone": "11977776666"}, headers=auth)
    hide(client, auth, patient["id"])
    day = future_day()
    r = propose(client, auth, "create_appointment", create_params(patient["id"], day))
    assert r.status_code == 200, r.text
    assert "Maria" not in r.text and "11977776666" not in r.text and "Dados ocultos" in r.json()["summary"]
    c = confirm(client, auth, r.json()["proposal_id"])
    assert c.status_code == 200 and "Maria" not in c.text and "11977776666" not in c.text
    row = AssistantProposal.objects.get()
    assert "Maria" not in row.summary and "Maria" not in str(row.result)

    appt = Appointment.objects.get()
    for name, params in (
        ("cancel_appointment", {"appointment_id": appt.id}),
        ("reschedule_appointment", {"appointment_id": appt.id, "starts_at": at(day, 16), "ends_at": at(day, 17)}),
    ):
        p = propose(client, auth, name, params)
        assert "Maria" not in p.text, name


def test_access_log_on_propose_and_confirm(client, auth, patient):
    pid = propose(client, auth, "create_appointment", create_params(patient["id"])).json()["proposal_id"]
    assert [(l.action, l.resource_id) for l in assistant_logs()] == [("criar", pid)]

    assert confirm(client, auth, pid).status_code == 200
    appt = Appointment.objects.get()
    logs = [(l.action, l.resource, l.resource_id) for l in AccessLog.objects.filter(user__email="ana@clinica.com").order_by("id")]
    assert ("editar", "assistente", pid) in logs
    assert ("criar", "agendamento", appt.id) in logs  # a trilha do agendamento também mostra a mudança

    confirm(client, auth, pid)  # idempotente: não grava de novo
    assert len(AccessLog.objects.filter(user__email="ana@clinica.com", resource="assistente")) == 2
    assert len(AccessLog.objects.filter(resource="agendamento", action="criar")) == 1


def test_failed_and_expired_confirms_are_audited(client, auth, patient, clock):
    day = future_day()
    pid = propose(client, auth, "create_appointment", create_params(patient["id"], day)).json()["proposal_id"]
    make_appointment(client, auth, patient["id"], day, hour=14)
    confirm(client, auth, pid)
    late = propose(client, auth, "create_appointment", create_params(patient["id"], day, hour=9)).json()["proposal_id"]
    clock.advance(minutes=11)
    confirm(client, auth, late)
    actions = [(l.action, l.resource_id) for l in assistant_logs()]
    assert ("editar", pid) in actions and ("editar", late) in actions


@pytest.mark.skipif(registry.get("list_returns_due") is None, reason="returns_logic ainda não existe")
def test_list_returns_due_through_the_api(client, auth, other_auth, patient):
    from apps.inventory.models import Application

    applied_patient(client, auth, patient)
    Application.objects.update(applied_at=timezone.now() - timedelta(days=130))  # toxina: padrão de 120 dias
    r = propose(client, auth, "list_returns_due", {"within_days": 30})
    assert r.status_code == 200, r.text
    assert [i["patient_id"] for i in r.json()["result"]["items"]] == [patient["id"]]
    assert propose(client, other_auth, "list_returns_due", {}).json()["result"]["items"] == []

    hide(client, auth, patient["id"])
    hidden = propose(client, auth, "list_returns_due", {}).json()["result"]["items"][0]
    assert hidden["patient_name"] == "Dados ocultos" and hidden["phone"] == ""
    assert "Maria" not in str(hidden)


def test_stored_proposals_never_keep_patient_names_that_are_hidden_later(client, auth, patient):
    day = future_day()
    w = propose(client, auth, "create_appointment", create_params(patient["id"], day))
    assert "Maria" in w.json()["summary"]  # quem confirma precisa ver o nome na hora
    r = propose(client, auth, "search_patients", {"query": "Maria"})
    assert r.status_code == 200
    hide(client, auth, patient["id"])
    for row in AssistantProposal.objects.all():
        assert "Maria" not in row.summary, row.action
        assert "Maria" not in str(row.params), row.action
