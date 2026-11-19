"""Segurança clínica: intercorrências, recall por lote e checagem antes de marcar o plano como aplicado."""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse

from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.clinical.models import Depth, Region, Technique
from apps.clinical.point_labels import point_label
from apps.consent.models import Signature
from apps.inventory.models import Application, Lot, LotMovement
from apps.safety.models import AdverseEvent

from ..audit import log_access
from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..schemas_safety import (
    AdverseEventIn,
    AdverseEventOut,
    AdverseEventPatch,
    ApplyCheckOut,
    CheckItem,
    RecallOut,
    RecallRow,
)
from .consent import planned_kinds
from .inventory import _own_lot
from .plans import _own_plan

router = APIRouter(tags=["segurança"])

# Zonas de maior risco de oclusão vascular com preenchedor (força-tarefa da ASDS): o aviso lembra o protocolo e o kit.
HIGH_RISK_FILLER_REGIONS = {"nariz", "glabela", "testa", "nasolabial", "malar"}
FILLER_TREATMENTS = {"preenchimento", "bioestimulador"}


def _label(choices, value: str) -> str:
    try:
        return choices(value).label
    except ValueError:
        return value or "-"


def _qty(value) -> str:
    return f"{value.normalize():f}".replace(".", ",")  # 20 e não 2E+1


def _lot_label(lot: Lot | None) -> str:
    if lot is None:
        return ""
    return f"{lot.product.brand} {lot.product.name} · lote {lot.number} · val. {lot.expires_on.strftime('%d/%m/%Y')}"


def _out(e: AdverseEvent) -> AdverseEventOut:
    return AdverseEventOut(
        id=e.id, patient_id=e.patient_id, application_id=e.application_id, lot_id=e.lot_id, lot_label=_lot_label(e.lot),
        region=e.region, point_key=e.point_key, kind=e.kind, kind_label=_label(AdverseEvent.Kind, e.kind), severity=e.severity,
        onset_at=e.onset_at, signs=list(e.signs or []), description=e.description, conduct=e.conduct,
        hyaluronidase_lot_id=e.hyaluronidase_lot_id, hyaluronidase_label=_lot_label(e.hyaluronidase_lot),
        hyaluronidase_amount=e.hyaluronidase_amount, protocol_started_at=e.protocol_started_at, outcome=e.outcome,
        anvisa_notified_on=e.anvisa_notified_on, anvisa_protocol=e.anvisa_protocol, created_at=e.created_at, updated_at=e.updated_at,
    )


def _own_event(user: User, event_id: int) -> AdverseEvent:
    event = (
        AdverseEvent.objects.filter(pk=event_id, patient__owner=user)
        .select_related("lot__product", "hyaluronidase_lot__product", "application", "patient")
        .first()
    )
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intercorrência não encontrada.")
    return event


# ---- intercorrências ----
@router.get("/patients/{patient_id}/adverse-events", response_model=list[AdverseEventOut])
@orm
def list_events(patient_id: int, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    return [_out(e) for e in patient.adverse_events.select_related("lot__product", "hyaluronidase_lot__product")]


@router.post("/patients/{patient_id}/adverse-events", response_model=AdverseEventOut, status_code=status.HTTP_201_CREATED)
@orm
def create_event(patient_id: int, data: AdverseEventIn, request: Request, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    application = None
    lot = None
    region, point_key = data.region, data.point_key
    if data.application_id is not None:
        application = Application.objects.filter(pk=data.application_id, patient=patient).select_related("lot__product").first()
        if application is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Aplicação não pertence a este paciente.")
        lot = application.lot
        region, point_key = application.region, application.point_key
    elif data.lot_id is not None:
        lot = _own_lot(user, data.lot_id)

    hyal_lot = None
    if data.hyaluronidase_lot_id is not None:
        if data.hyaluronidase_amount is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Informe a quantidade de hialuronidase usada.")
        hyal_lot = _own_lot(user, data.hyaluronidase_lot_id)
        if hyal_lot.expires_on < timezone.localdate():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Lote vencido: {hyal_lot.product.name} lote {hyal_lot.number}.")

    with transaction.atomic():
        if hyal_lot is not None:
            # Mesma regra da aplicação: o saldo nunca fica negativo, mesmo com pedidos simultâneos.
            amount = data.hyaluronidase_amount
            if not Lot.objects.filter(pk=hyal_lot.pk, balance__gte=amount).update(balance=F("balance") - amount):
                raise HTTPException(status.HTTP_409_CONFLICT, f"Saldo insuficiente no lote {hyal_lot.number} de {hyal_lot.product.name}.")
            hyal_lot.refresh_from_db(fields=["balance"])
        event = AdverseEvent.objects.create(
            patient=patient, application=application, lot=lot, region=region, point_key=point_key, kind=data.kind,
            severity=data.severity, onset_at=data.onset_at, signs=list(data.signs), description=data.description,
            conduct=data.conduct, hyaluronidase_lot=hyal_lot, hyaluronidase_amount=data.hyaluronidase_amount if hyal_lot else None,
            protocol_started_at=data.protocol_started_at, created_by=user,
        )
        if hyal_lot is not None:
            LotMovement.objects.create(
                lot=hyal_lot, kind=LotMovement.Kind.WRITE_OFF, delta=-data.hyaluronidase_amount, balance_after=hyal_lot.balance,
                author=user, reason=f"Intercorrência #{event.id}",
            )
        log_access(user, AccessLog.Action.CREATE, "intercorrencia", event.id, request)
    return _out(_own_event(user, event.id))


@router.patch("/adverse-events/{event_id}", response_model=AdverseEventOut)
@orm
def update_event(event_id: int, data: AdverseEventPatch, request: Request, user: User = Depends(current_user)):
    event = _own_event(user, event_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is None and field in {"description", "conduct", "anvisa_protocol"}:
            value = ""
        if value is None and field in {"severity", "outcome"}:
            continue
        setattr(event, field, value)
    event.save()
    log_access(user, AccessLog.Action.UPDATE, "intercorrencia", event.id, request)
    return _out(_own_event(user, event.id))


SIGN_LABELS = {
    "palidez": "palidez / branqueamento",
    "livedo": "livedo reticular",
    "dor_desproporcional": "dor desproporcional",
    "enchimento_capilar_lento": "enchimento capilar lento",
    "cianose": "cianose",
    "bolhas": "bolhas / pústulas",
    "alteracao_visual": "alteração visual",
    "dor_ocular": "dor ocular",
    "alteracao_neurologica": "alteração neurológica",
}


@router.get("/adverse-events/{event_id}/notivisa", response_class=PlainTextResponse)
@orm
def notivisa_summary(event_id: int, request: Request, user: User = Depends(current_user)):
    """Resumo em texto para a profissional copiar no formulário do Notivisa. O sistema não envia nada à Anvisa."""
    event = _own_event(user, event_id)
    tz = timezone.get_current_timezone()
    app = event.application
    lines = [
        "RESUMO PARA NOTIFICAÇÃO (preencher no Notivisa)",
        f"Tipo de evento: {_label(AdverseEvent.Kind, event.kind)}",
        f"Gravidade: {_label(AdverseEvent.Severity, event.severity)}",
        f"Início: {event.onset_at.astimezone(tz).strftime('%d/%m/%Y %H:%M')}",
    ]
    if event.region:
        name = point_label(event.region, event.point_key)
        lines.append(f"Região: {_label(Region, event.region)}{f' ({name})' if name else ''}")
    if event.lot:
        product = event.lot.product
        lines += [
            f"Produto: {product.brand} {product.name}",
            f"Registro Anvisa: {product.anvisa_registration or 'não informado'}",
            f"Lote: {event.lot.number} · validade {event.lot.expires_on.strftime('%d/%m/%Y')}",
        ]
    if app:
        lines += [
            f"Aplicação: {app.applied_at.astimezone(tz).strftime('%d/%m/%Y %H:%M')} · "
            f"{_qty(app.amount)} {app.unit}",
            f"Técnica / plano: {_label(Technique, app.technique)} / {_label(Depth, app.depth)}",
        ]
    if event.signs:
        lines.append("Sinais: " + ", ".join(SIGN_LABELS.get(s, s) for s in event.signs))
    if event.description:
        lines.append(f"Descrição: {event.description}")
    if event.conduct:
        lines.append(f"Conduta: {event.conduct}")
    if event.hyaluronidase_lot:
        lines.append(
            f"Hialuronidase: {_lot_label(event.hyaluronidase_lot)} · "
            f"{_qty(event.hyaluronidase_amount)} {event.hyaluronidase_lot.product.unit}"
        )
    lines.append(f"Desfecho: {_label(AdverseEvent.Outcome, event.outcome)}")
    log_access(user, AccessLog.Action.VIEW, "intercorrencia", event.id, request)
    return PlainTextResponse("\n".join(lines), headers={"Cache-Control": "no-store"})


# ---- recall por lote ----
@router.get("/inventory/lots/{lot_id}/patients", response_model=RecallOut)
@orm
def lot_recall(lot_id: int, request: Request, user: User = Depends(current_user)):
    """Quem recebeu este lote: serve para alerta da Anvisa ou recolhimento do fabricante."""
    lot = _own_lot(user, lot_id)
    apps = Application.objects.filter(lot=lot, patient__owner=user).select_related("patient").order_by("-applied_at", "-id")
    rows = [
        RecallRow(
            application_id=a.id, applied_at=a.applied_at, patient_id=a.patient_id,
            # Paciente com dados ocultos já tem nome e contato mascarados no cadastro; a tela avisa.
            patient_name=a.patient.full_name, patient_phone=a.patient.phone, hidden=a.patient.anonymized_at is not None,
            region=a.region, point_key=a.point_key, amount=a.amount, unit=a.unit,
        )
        for a in apps
    ]
    log_access(user, AccessLog.Action.VIEW, "lote_pacientes", lot.id, request)
    return RecallOut(lot_id=lot.id, lot_number=lot.number, product=f"{lot.product.brand} {lot.product.name}", rows=rows)


# ---- checagem antes de marcar como aplicado ----
@router.get("/plans/{plan_id}/apply-check", response_model=ApplyCheckOut)
@orm
def apply_check(plan_id: int, user: User = Depends(current_user)):
    """Avisos, sem bloquear: a decisão é da profissional. Nada aqui calcula ou sugere dose."""
    plan = _own_plan(user, plan_id)
    patient = plan.patient
    points = [p for p in plan.points.all() if p.amount > 0]
    items: list[CheckItem] = []

    if not hasattr(patient, "anamnesis"):
        items.append(CheckItem(code="anamnese", level="atencao", message="Anamnese não preenchida."))

    signed = set(
        Signature.objects.filter(patient=patient, revoked_at__isnull=True).values_list("term__kind", flat=True)
    )
    missing = sorted(planned_kinds(patient) - signed)
    if missing:
        items.append(
            CheckItem(code="termo", level="atencao", message=f"Termo de consentimento não assinado: {', '.join(missing)}.")
        )

    if any(p.treatment == "botox" for p in points):
        days = settings.TOXIN_MIN_INTERVAL_DAYS
        since = timezone.now() - timedelta(days=days)
        recent = Application.objects.filter(patient=patient, treatment="botox", applied_at__gte=since)
        last = recent.order_by("-applied_at").first()
        if last:
            total = recent.aggregate(t=Sum("amount"))["t"]
            when = timezone.localtime(last.applied_at).strftime("%d/%m/%Y")
            items.append(
                CheckItem(
                    code="intervalo_toxina", level="atencao",
                    message=(
                        f"Toxina aplicada há menos de {days} dias (última em {when}; "
                        f"{_qty(total)} U no período). Retoque é possível; confira o intervalo do seu protocolo."
                    ),
                )
            )

    risky = sorted({p.region for p in points if p.treatment in FILLER_TREATMENTS and p.region in HIGH_RISK_FILLER_REGIONS})
    if risky:
        names = ", ".join(_label(Region, r) for r in risky)
        items.append(
            CheckItem(
                code="zona_risco", level="info",
                message=f"Preenchedor em zona de maior risco vascular ({names}). Deixe o protocolo de oclusão e o kit de emergência à mão.",
            )
        )

    without_lot = sum(1 for p in points if p.lot_id is None)
    if without_lot:
        items.append(
            CheckItem(code="sem_lote", level="info", message=f"{without_lot} ponto(s) sem lote: não entram na rastreabilidade nem dão baixa.")
        )

    if patient.adverse_events.filter(outcome=AdverseEvent.Outcome.FOLLOW_UP).exists():
        items.append(CheckItem(code="intercorrencia_aberta", level="atencao", message="Paciente tem intercorrência em acompanhamento."))

    return ApplyCheckOut(items=items)
