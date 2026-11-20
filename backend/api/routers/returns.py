from datetime import date

from django.utils import timezone
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from apps.accounts.models import User
from apps.audit.models import AccessLog

from .. import returns_logic
from ..audit import log_access
from ..deps import current_user
from ..orm import orm

router = APIRouter(tags=["retornos"])


class ReturnItem(BaseModel):
    patient_id: int
    patient_name: str  # "Dados ocultos" quando o paciente teve os dados ocultos
    phone: str  # vazio sem telefone ou com dados ocultos
    kind: str
    last_applied_at: str
    due_on: date
    days_overdue: int  # negativo = faltam dias
    status: str  # vencido | proximo | em_dia
    interval_days: int
    interval_source: str  # produto | padrao
    message: str


class ReturnsOut(BaseModel):
    items: list[ReturnItem]
    defaults: dict[str, int]


@router.get("/returns", response_model=ReturnsOut)
@orm
def list_returns(request: Request, within_days: int = Query(30, ge=0, le=365), user: User = Depends(current_user)):
    """Pacientes para reaplicação: vencidos e os que vencem em até `within_days` dias (só do dono).
    Lembrete de atendimento com intervalo configurável por produto; não é recomendação clínica."""
    items = returns_logic.due_returns(user, timezone.localdate(), within_days)
    log_access(user, AccessLog.Action.VIEW, "retornos", user.id, request)  # lista nomes e telefones
    return ReturnsOut(items=items, defaults=returns_logic.DEFAULT_INTERVALS)
