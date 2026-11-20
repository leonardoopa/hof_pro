"""Ações do assistente: serviços internos tipados, sem LLM e sem UI.

Regras de todas as ações:
- o dono é o `user` da sessão; parâmetro `owner`/`user_id` não existe nos modelos e é descartado na validação;
- paciente com dados ocultos (`anonymized_at`) aparece só como "Dados ocultos", sem telefone;
- datas vêm em ISO 8601 (sem naive: assume o fuso da clínica, como a agenda); data relativa é problema de quem chama;
- erro de negócio sai como HTTPException (404/409/422), que o router repassa.

A agenda reaproveita as regras de `api/routers/appointments.py` (bloqueio por profissional e checagem de horário).
"""
from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from fastapi import HTTPException, status
from pydantic import BaseModel, Field, model_validator

from api.deps import get_patient_or_404
from api.routers.appointments import _aware, _check_slot, _lock_owner, _own
from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.clinical.models import Anamnesis, FacialPlan
from apps.inventory.models import Application
from apps.patients.models import Patient
from apps.safety.models import AdverseEvent
from apps.scheduling.models import Appointment

from . import registry
from .registry import Action

HIDDEN = "Dados ocultos"
MAX_RETURNS = 50
OPEN_STATUSES = (Appointment.Status.SCHEDULED, Appointment.Status.CONFIRMED)


# ---- apoio ----
def _name(patient: Patient) -> str:
    return HIDDEN if patient.anonymized_at is not None else patient.full_name


def _phone(patient: Patient) -> str:
    return "" if patient.anonymized_at is not None else patient.phone


def _who(a: Appointment) -> str:
    if a.patient_id:
        return _name(a.patient)
    return a.lead_name or "novo paciente"


def _when(dt: datetime) -> str:
    return timezone.localtime(dt).strftime("%d/%m/%Y às %H:%M")


def _iso(dt: datetime) -> str:
    return timezone.localtime(dt).isoformat()


def _appointment_out(a: Appointment) -> dict:
    """Só ids, horários e status: sem nome, para o resultado guardado não vazar dado que depois seja ocultado."""
    return {
        "id": a.id, "patient_id": a.patient_id, "starts_at": _iso(a.starts_at), "ends_at": _iso(a.ends_at),
        "kind": a.kind, "status": a.status,
    }


# ---- parâmetros ----
class SearchPatientsParams(BaseModel):
    query: str = Field(min_length=2, max_length=100, description="Parte do nome ou do telefone.")
    limit: int = Field(default=10, ge=1, le=20)


class ListFreeSlotsParams(BaseModel):
    date_from: date
    date_to: date
    start_time: time = Field(default=time(8, 0), description="Início do expediente (horário local).")
    end_time: time = Field(default=time(18, 0), description="Fim do expediente (horário local).")
    duration_minutes: int = Field(default=60, ge=5, le=480)
    step_minutes: int = Field(default=30, ge=5, le=240, description="De quanto em quanto tempo um horário pode começar.")
    limit: int = Field(default=20, ge=1, le=50)

    @model_validator(mode="after")
    def _range(self):
        if self.date_to < self.date_from or (self.date_to - self.date_from).days > 14:
            raise ValueError("Intervalo inválido (máximo de 15 dias).")
        if self.end_time <= self.start_time:
            raise ValueError("O fim do expediente deve ser depois do início.")
        return self


class CreateAppointmentParams(BaseModel):
    patient_id: int | None = None
    lead_name: str = Field(default="", max_length=150, description="Só quando ainda não é paciente.")
    lead_phone: str = Field(default="", max_length=30)
    starts_at: datetime
    ends_at: datetime
    kind: str = Field(default="", max_length=80)
    notes: str = ""

    @model_validator(mode="after")
    def _valid(self):
        if self.patient_id is None and not self.lead_name.strip():
            raise ValueError("Informe um paciente ou o nome do novo paciente.")
        if _aware(self.ends_at) <= _aware(self.starts_at):
            raise ValueError("O fim deve ser depois do início.")
        return self


class RescheduleAppointmentParams(BaseModel):
    appointment_id: int
    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def _order(self):
        if _aware(self.ends_at) <= _aware(self.starts_at):
            raise ValueError("O fim deve ser depois do início.")
        return self


class CancelAppointmentParams(BaseModel):
    appointment_id: int


class PatientSummaryParams(BaseModel):
    patient_id: int


class ListReturnsDueParams(BaseModel):
    within_days: int = Field(default=30, ge=0, le=365, description="Retornos vencidos ou que vencem em até N dias.")


# ---- leitura ----
def _search_patients(user: User, p: SearchPatientsParams) -> dict:
    q = p.query.strip()
    qs = (
        Patient.objects.filter(owner=user, archived_at__isnull=True)
        .filter(Q(full_name__icontains=q) | Q(phone__icontains=q))
        .order_by("full_name", "id")[: p.limit]
    )
    return {"patients": [{"id": x.id, "full_name": _name(x), "phone": _phone(x), "hidden": x.anonymized_at is not None} for x in qs]}


def _list_free_slots(user: User, p: ListFreeSlotsParams) -> dict:
    tz = timezone.get_current_timezone()
    now = timezone.now()
    first = timezone.make_aware(datetime.combine(p.date_from, time.min), tz)
    last = timezone.make_aware(datetime.combine(p.date_to + timedelta(days=1), time.min), tz)
    busy = list(
        Appointment.objects.filter(owner=user, starts_at__lt=last, ends_at__gt=first)
        .exclude(status=Appointment.Status.CANCELED)
        .values_list("starts_at", "ends_at")
    )
    duration, step = timedelta(minutes=p.duration_minutes), timedelta(minutes=p.step_minutes)
    slots: list[dict] = []
    day = p.date_from
    while day <= p.date_to and len(slots) <= p.limit:
        cursor = timezone.make_aware(datetime.combine(day, p.start_time), tz)
        day_end = timezone.make_aware(datetime.combine(day, p.end_time), tz)
        while cursor + duration <= day_end and len(slots) <= p.limit:
            end = cursor + duration
            if cursor >= now and not any(s < end and e > cursor for s, e in busy):
                slots.append({"starts_at": _iso(cursor), "ends_at": _iso(end)})
            cursor += step
        day += timedelta(days=1)
    return {"slots": slots[: p.limit], "truncated": len(slots) > p.limit}


def _get_patient_summary(user: User, p: PatientSummaryParams) -> dict:
    patient = get_patient_or_404(user, p.patient_id)
    plans = FacialPlan.objects.filter(patient=patient).aggregate(
        total=Count("id"), applied=Count("id", filter=Q(applied_at__isnull=False))
    )
    last = Application.objects.filter(patient=patient).order_by("-applied_at", "-id").first()
    upcoming = (
        Appointment.objects.filter(owner=user, patient=patient, starts_at__gte=timezone.now())
        .exclude(status=Appointment.Status.CANCELED)
        .order_by("starts_at", "id")
        .first()
    )
    return {
        "patient": {"id": patient.id, "full_name": _name(patient), "phone": _phone(patient), "hidden": patient.anonymized_at is not None},
        "plans": plans,
        "last_application": (
            {"applied_at": _iso(last.applied_at), "treatment": last.treatment, "region": last.region} if last else None
        ),
        "next_appointment": (
            {"id": upcoming.id, "starts_at": _iso(upcoming.starts_at), "ends_at": _iso(upcoming.ends_at), "kind": upcoming.kind,
             "status": upcoming.status}
            if upcoming else None
        ),
        "open_adverse_events": AdverseEvent.objects.filter(patient=patient, outcome=AdverseEvent.Outcome.FOLLOW_UP).count(),
        "anamnesis_saved": Anamnesis.objects.filter(patient=patient).exists(),
    }


def make_list_returns_due(due_returns) -> Action:
    """Monta `list_returns_due` sobre `returns_logic.due_returns(user, today, within_days)`. Mascara de novo o paciente
    com dados ocultos, para a regra do assistente não depender de quem escreveu a lista de retornos."""

    def run(user: User, p: ListReturnsDueParams) -> dict:
        rows = list(due_returns(user, timezone.localdate(), p.within_days))
        hidden = set(
            Patient.objects.filter(owner=user, pk__in={r.get("patient_id") for r in rows}, anonymized_at__isnull=False)
            .values_list("pk", flat=True)
        )
        items = []
        for row in rows[:MAX_RETURNS]:
            row = dict(row)
            if row.get("patient_id") in hidden:
                row.update(patient_name=HIDDEN, phone="", message="")
            items.append(row)
        return {"items": items, "total": len(rows)}

    return Action(
        name="list_returns_due",
        description="Lista pacientes com retorno (reaplicação) vencido ou que vence nos próximos dias, com mensagem pronta.",
        writes=False,
        params_model=ListReturnsDueParams,
        run=run,
        summarize=lambda user, p: f"Listar retornos vencidos ou que vencem em até {p.within_days} dias.",
    )


# ---- escrita: agenda ----
def _create_appointment(user: User, p: CreateAppointmentParams) -> dict:
    patient = get_patient_or_404(user, p.patient_id) if p.patient_id else None
    starts, ends = _aware(p.starts_at), _aware(p.ends_at)
    with transaction.atomic():
        _lock_owner(user)
        _check_slot(user, starts, ends)
        a = Appointment.objects.create(
            owner=user, patient=patient, lead_name="" if patient else p.lead_name.strip(),
            lead_phone="" if patient else p.lead_phone.strip(), starts_at=starts, ends_at=ends,
            kind=p.kind.strip(), notes=p.notes,
        )
    return {"appointment": _appointment_out(a)}


def _summarize_create(user: User, p: CreateAppointmentParams) -> str:
    patient = get_patient_or_404(user, p.patient_id) if p.patient_id else None
    who = _name(patient) if patient else p.lead_name.strip()
    text = f"Agendar {who} em {_when(_aware(p.starts_at))}, até {timezone.localtime(_aware(p.ends_at)).strftime('%H:%M')}"
    return f"{text} ({p.kind.strip()})." if p.kind.strip() else f"{text}."


def _reschedule_appointment(user: User, p: RescheduleAppointmentParams) -> dict:
    starts, ends = _aware(p.starts_at), _aware(p.ends_at)
    with transaction.atomic():
        _lock_owner(user)
        a = _own(user, p.appointment_id)  # relido sob o bloqueio: o status pode ter mudado
        if a.status not in OPEN_STATUSES:
            raise HTTPException(status.HTTP_409_CONFLICT, "Só dá para remarcar agendamento agendado ou confirmado.")
        _check_slot(user, starts, ends, exclude_id=a.id)
        a.starts_at, a.ends_at = starts, ends
        a.save()
    return {"appointment": _appointment_out(a)}


def _summarize_reschedule(user: User, p: RescheduleAppointmentParams) -> str:
    a = _own(user, p.appointment_id)
    return f"Remarcar o agendamento de {_who(a)}, de {_when(a.starts_at)} para {_when(_aware(p.starts_at))}."


def _cancel_appointment(user: User, p: CancelAppointmentParams) -> dict:
    with transaction.atomic():
        _lock_owner(user)
        a = _own(user, p.appointment_id)
        if a.status not in OPEN_STATUSES:
            raise HTTPException(status.HTTP_409_CONFLICT, "Só dá para cancelar agendamento agendado ou confirmado.")
        a.status = Appointment.Status.CANCELED
        a.save()
    return {"appointment": _appointment_out(a)}


def _summarize_cancel(user: User, p: CancelAppointmentParams) -> str:
    a = _own(user, p.appointment_id)
    return f"Cancelar o agendamento de {_who(a)} em {_when(a.starts_at)}."


def _audit_appointment(action: str):
    return lambda result: (action, "agendamento", result["appointment"]["id"])


# ---- registro ----
registry.register(Action(
    name="search_patients",
    description="Busca pacientes ativos pelo nome ou telefone. Paciente com dados ocultos aparece sem nome nem telefone.",
    writes=False, params_model=SearchPatientsParams, run=_search_patients,
    summarize=lambda user, p: f"Buscar pacientes por \"{p.query.strip()}\".",
))
registry.register(Action(
    name="list_free_slots",
    description="Lista horários livres da agenda em um intervalo de datas (até 15 dias), dentro do expediente informado.",
    writes=False, params_model=ListFreeSlotsParams, run=_list_free_slots,
    summarize=lambda user, p: f"Listar horários livres de {p.date_from.strftime('%d/%m/%Y')} a {p.date_to.strftime('%d/%m/%Y')}.",
))
registry.register(Action(
    name="get_patient_summary",
    description="Resumo do paciente: planos, última aplicação, próximo agendamento, intercorrências em acompanhamento e anamnese.",
    writes=False, params_model=PatientSummaryParams, run=_get_patient_summary,
    summarize=lambda user, p: "Ver o resumo do paciente.",
))
registry.register(Action(
    name="create_appointment",
    description="Cria um agendamento (paciente existente ou novo paciente por nome). Exige confirmação.",
    writes=True, params_model=CreateAppointmentParams, run=_create_appointment, summarize=_summarize_create,
    audit_ref=_audit_appointment(AccessLog.Action.CREATE.value),
))
registry.register(Action(
    name="reschedule_appointment",
    description="Muda o horário de um agendamento agendado ou confirmado. Exige confirmação.",
    writes=True, params_model=RescheduleAppointmentParams, run=_reschedule_appointment, summarize=_summarize_reschedule,
    audit_ref=_audit_appointment(AccessLog.Action.UPDATE.value),
))
registry.register(Action(
    name="cancel_appointment",
    description="Cancela um agendamento agendado ou confirmado (o registro continua no histórico). Exige confirmação.",
    writes=True, params_model=CancelAppointmentParams, run=_cancel_appointment, summarize=_summarize_cancel,
    audit_ref=_audit_appointment(AccessLog.Action.UPDATE.value),
))

# `list_returns_due` só existe quando a lógica de retornos (Task 2) está no código; o controlador liga na integração.
try:
    from api.returns_logic import due_returns
except ImportError:
    due_returns = None
else:
    registry.register(make_list_returns_due(due_returns))
