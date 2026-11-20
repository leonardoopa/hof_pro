"""Histórico do paciente: linha do tempo só de leitura, do item mais novo para o mais antigo.

Junta o que já existe (plano, aplicação, termo, intercorrência, agendamento, foto, anamnese) sem criar modelo novo.
Com os dados do paciente ocultos nenhum item leva nome, texto livre ou foto: só o tipo e a data do que aconteceu.
"""

from datetime import datetime
from typing import Literal

from django.db.models import Count, Q
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.clinical.models import AnamnesisVersion, Region
from apps.finance.models import Budget, Payment
from apps.inventory.models import Application
from apps.patients.models import PatientPhoto
from apps.scheduling.models import Appointment

from ..audit import log_access
from ..deps import current_user, get_patient_or_404
from ..orm import orm

router = APIRouter(tags=["histórico"])

Kind = Literal["plano", "aplicacao", "termo", "intercorrencia", "agendamento", "foto", "anamnese", "orcamento", "pagamento"]

# Palavra usada no título da aplicação ("Aplicação de toxina"); tratamento sem palavra própria fica só "Aplicação".
TREATMENT_WORD = {"botox": "toxina", "preenchimento": "preenchimento", "bioestimulador": "bioestimulador", "skinbooster": "skinbooster"}
PHOTO_TITLE = {
    PatientPhoto.Kind.FRONTAL: "Foto frontal",
    PatientPhoto.Kind.PROFILE_RIGHT: "Foto de perfil direito",
    PatientPhoto.Kind.PROFILE_LEFT: "Foto de perfil esquerdo",
    PatientPhoto.Kind.LABEL: "Etiqueta de produto adicionada",
}


class TimelineRef(BaseModel):
    type: str
    id: int


class TimelineItem(BaseModel):
    at: datetime
    kind: Kind
    title: str
    detail: str = ""
    ref: TimelineRef


class TimelineOut(BaseModel):
    items: list[TimelineItem]


def _item(at: datetime, kind: str, title: str, ref_type: str, ref_id: int, detail: str = "") -> TimelineItem:
    return TimelineItem(at=at, kind=kind, title=title, detail=detail, ref=TimelineRef(type=ref_type, id=ref_id))


def _qty(value) -> str:
    return f"{value.normalize():f}".replace(".", ",")  # 20 e não 2E+1


def _region(value: str) -> str:
    try:
        return Region(value).label
    except ValueError:
        return value


def _applications(patient) -> list[TimelineItem]:
    """Uma linha por plano e tratamento (os pontos de um mesmo plano são uma aplicação só); sem plano, uma por ponto."""
    groups: dict[tuple, list[Application]] = {}
    for a in patient.applications.select_related("lot").order_by("applied_at", "id"):
        key = (a.plan_id, a.treatment) if a.plan_id else ("avulsa", a.id)
        groups.setdefault(key, []).append(a)
    items = []
    for rows in groups.values():
        first = rows[0]
        totals: dict[tuple[str, str], object] = {}
        for a in rows:
            key = (a.region, a.unit)
            totals[key] = totals.get(key, 0) + a.amount
        parts = ", ".join(f"{_region(region)} {_qty(total)} {unit}" for (region, unit), total in totals.items())
        lots = sorted({a.lot.number for a in rows})
        word = TREATMENT_WORD.get(first.treatment)
        items.append(
            _item(
                max(a.applied_at for a in rows), "aplicacao", f"Aplicação de {word}" if word else "Aplicação",
                "plan" if first.plan_id else "application", first.plan_id or first.id, f"{parts} · lote {', '.join(lots)}",
            )
        )
    return items


def _brl(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    reais, centavos = divmod(abs(int(cents)), 100)
    return f"{sign}R$ {reais:,}".replace(",", ".") + f",{centavos:02d}"


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


@router.get("/patients/{patient_id}/timeline", response_model=TimelineOut)
@orm
def patient_timeline(patient_id: int, request: Request, limit: int = Query(100, ge=1, le=300), user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    hidden = patient.anonymized_at is not None
    items: list[TimelineItem] = []

    for plan in patient.plans.annotate(point_count=Count("points")):
        title = "Plano facial" if hidden else (plan.title.strip() or "Plano facial")
        points = _plural(plan.point_count, "ponto", "pontos") if plan.point_count else "Sem pontos"
        detail = f"{points} · aplicado" if plan.applied_at else points
        items.append(_item(plan.created_at, "plano", title, "plan", plan.id, detail))

    items += _applications(patient)

    # Sem o nome de quem assinou: o nome do paciente fica de fora quando os dados estão ocultos.
    for s in patient.signatures.select_related("term").defer("image"):
        detail = f"Versão {s.term.version}"
        items.append(_item(s.signed_at, "termo", f"Termo assinado: {s.term_title}", "signature", s.id, detail))
        if s.revoked_at:
            items.append(_item(s.revoked_at, "termo", f"Termo revogado: {s.term_title}", "signature", s.id, detail))

    for e in patient.adverse_events.all():
        detail = " · ".join(
            part for part in (f"Gravidade {e.get_severity_display().lower()}", _region(e.region) if e.region else "", e.get_outcome_display()) if part
        )
        items.append(_item(e.onset_at, "intercorrencia", f"Intercorrência: {e.get_kind_display()}", "adverse_event", e.id, detail))

    for a in Appointment.objects.filter(owner=user, patient=patient):
        title = f"Agendamento: {a.kind}" if a.kind and not hidden else "Agendamento"
        items.append(_item(a.starts_at, "agendamento", title, "appointment", a.id, a.get_status_display()))

    if not hidden:  # a lista de fotos também vem vazia com os dados ocultos
        for p in patient.photos.all():
            items.append(_item(p.created_at, "foto", PHOTO_TITLE.get(p.kind, "Foto adicionada"), "photo", p.id))

    versions = AnamnesisVersion.objects.filter(anamnesis__patient=patient).annotate(yes=Count("answers", filter=Q(answers__answer=True)))
    for v in versions:
        detail = _plural(v.yes, "resposta positiva", "respostas positivas") if v.yes else "Nenhuma resposta positiva"
        items.append(_item(v.saved_at, "anamnese", f"Anamnese salva (versão {v.number})", "anamnesis", v.id, detail))

    # Só valor e estado: observações e motivos (texto livre) ficam de fora.
    budgets = Budget.objects.filter(owner=user, patient=patient).prefetch_related("items", "payments")
    for b in budgets:
        items.append(_item(b.created_at, "orcamento", "Orçamento", "budget", b.id, f"{b.get_status_display()} · {_brl(b.total_cents)}"))
        for pay in b.payments.all():
            reversal = pay.amount_cents < 0
            title = "Pagamento estornado" if reversal else "Pagamento recebido"
            items.append(_item(pay.paid_at, "pagamento", title, "budget", b.id, f"{_brl(abs(pay.amount_cents))} · {pay.get_method_display()}"))

    items.sort(key=lambda i: i.at, reverse=True)  # estável: na mesma hora, vale a ordem acima
    log_access(user, AccessLog.Action.VIEW, "historico", patient.id, request)
    return TimelineOut(items=items[:limit])
