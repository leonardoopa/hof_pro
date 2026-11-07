from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.patients.models import Patient
from apps.scheduling.models import Appointment

from ..audit import log_access
from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..schemas_appointments import STATUSES, AppointmentIn, AppointmentOut, AppointmentPatch, StatusIn

router = APIRouter(tags=["agenda"])


def _out(a: Appointment) -> AppointmentOut:
    out = AppointmentOut.model_validate(a)
    out.patient_name = a.patient.full_name if a.patient_id else None
    return out


def _own(user: User, appointment_id: int) -> Appointment:
    a = Appointment.objects.filter(pk=appointment_id, owner=user).select_related("patient").first()
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agendamento não encontrado.")
    return a


def _aware(dt: datetime) -> datetime:
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def _lock_owner(user: User) -> None:
    """Serializa as gravações de agenda do profissional. Deve ser chamado dentro de `transaction.atomic()`,
    antes de `_check_slot`: sem isso, dois pedidos simultâneos passam pela checagem e duplicam o horário
    (SELECT + INSERT em READ COMMITTED). O SQLite ignora o bloqueio, mas ele já serializa as escritas."""
    User.objects.select_for_update().only("pk").get(pk=user.pk)


def _check_slot(user: User, starts_at, ends_at, exclude_id: int | None = None) -> None:
    if ends_at <= starts_at:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "O fim deve ser depois do início.")
    clash = Appointment.objects.filter(owner=user, starts_at__lt=ends_at, ends_at__gt=starts_at).exclude(
        status=Appointment.Status.CANCELED
    )
    if exclude_id:
        clash = clash.exclude(pk=exclude_id)
    other = clash.first()
    if other is not None:
        hora = timezone.localtime(other.starts_at).strftime("%d/%m %H:%M")
        raise HTTPException(status.HTTP_409_CONFLICT, f"Horário em conflito com outro agendamento ({hora}).")


@router.get("/appointments", response_model=list[AppointmentOut])
@orm
def list_appointments(
    date_from: date = Query(..., alias="from"), date_to: date = Query(..., alias="to"), user: User = Depends(current_user)
):
    """Agendamentos do dono com início entre as datas locais (inclusivas). Máximo de 62 dias."""
    if date_from > date_to or (date_to - date_from).days > 62:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Intervalo inválido (máximo de 62 dias).")
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(date_from, time.min), tz)
    end = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time.min), tz)
    qs = Appointment.objects.filter(owner=user, starts_at__gte=start, starts_at__lt=end).select_related("patient")
    return [_out(a) for a in qs]


@router.post("/appointments", response_model=AppointmentOut, status_code=status.HTTP_201_CREATED)
@orm
def create_appointment(data: AppointmentIn, request: Request, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, data.patient_id) if data.patient_id else None
    starts, ends = _aware(data.starts_at), _aware(data.ends_at)
    with transaction.atomic():
        _lock_owner(user)
        _check_slot(user, starts, ends)
        a = Appointment.objects.create(
            owner=user, patient=patient, lead_name="" if patient else data.lead_name.strip(),
            lead_phone="" if patient else data.lead_phone.strip(), starts_at=starts, ends_at=ends,
            kind=data.kind.strip(), notes=data.notes,
        )
        log_access(user, AccessLog.Action.CREATE, "agendamento", a.id, request)
    return _out(a)


@router.patch("/appointments/{appointment_id}", response_model=AppointmentOut)
@orm
def update_appointment(appointment_id: int, data: AppointmentPatch, request: Request, user: User = Depends(current_user)):
    a = _own(user, appointment_id)
    fields = data.model_dump(exclude_unset=True)
    if fields.get("patient_id") is not None:
        a.patient = get_patient_or_404(user, fields["patient_id"])
        a.lead_name = a.lead_phone = ""
    for key in ("lead_name", "lead_phone", "kind", "notes"):
        if fields.get(key) is not None:
            setattr(a, key, fields[key].strip() if key != "notes" else fields[key])
    if a.patient_id is None and not a.lead_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Informe um paciente ou o nome do novo paciente.")
    if fields.get("starts_at"):
        a.starts_at = _aware(fields["starts_at"])
    if fields.get("ends_at"):
        a.ends_at = _aware(fields["ends_at"])
    with transaction.atomic():
        _lock_owner(user)
        if a.status != Appointment.Status.CANCELED:
            _check_slot(user, a.starts_at, a.ends_at, exclude_id=a.id)
        elif a.ends_at <= a.starts_at:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "O fim deve ser depois do início.")
        a.save()
        log_access(user, AccessLog.Action.UPDATE, "agendamento", a.id, request)
    return _out(a)


@router.post("/appointments/{appointment_id}/status", response_model=AppointmentOut)
@orm
def set_status(appointment_id: int, data: StatusIn, request: Request, user: User = Depends(current_user)):
    if data.status not in STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Status inválido.")
    with transaction.atomic():
        _lock_owner(user)
        a = _own(user, appointment_id)  # relido sob o bloqueio: o status pode ter mudado
        if a.status == Appointment.Status.CANCELED and data.status != Appointment.Status.CANCELED:
            _check_slot(user, a.starts_at, a.ends_at, exclude_id=a.id)  # reativar exige o horário livre
        a.status = data.status
        a.save()
        log_access(user, AccessLog.Action.UPDATE, "agendamento", a.id, request)
    return _out(a)


@router.post("/appointments/{appointment_id}/convert", response_model=AppointmentOut)
@orm
def convert_lead(appointment_id: int, request: Request, user: User = Depends(current_user)):
    """Cria o paciente a partir do nome/telefone do lead e vincula ao agendamento."""
    a = _own(user, appointment_id)
    if a.patient_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este agendamento já tem paciente.")
    with transaction.atomic():
        patient = Patient.objects.create(owner=user, full_name=a.lead_name, phone=a.lead_phone)
        a.patient = patient
        a.lead_name = a.lead_phone = ""
        a.save()
        log_access(user, AccessLog.Action.CREATE, "paciente", patient.id, request)
        log_access(user, AccessLog.Action.UPDATE, "agendamento", a.id, request)
    return _out(a)
