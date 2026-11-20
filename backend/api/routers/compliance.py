"""Painel de pendências do prontuário. As regras ficam em api/compliance_logic.py."""

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from apps.accounts.models import User
from apps.audit.models import AccessLog

from ..audit import log_access
from ..compliance_logic import count_by_severity, pending_items
from ..deps import current_user
from ..orm import orm

router = APIRouter(tags=["compliance"])


class RefOut(BaseModel):
    type: Literal["patient", "plan", "adverse_event"]
    id: int


class PendingOut(BaseModel):
    patient_id: int
    patient_name: str  # "Dados ocultos" quando o paciente está com os dados ocultos
    code: Literal["sem_termo", "sem_lote", "sem_anamnese", "intercorrencia_aberta", "plano_sem_aplicacao"]
    severity: Literal["alta", "media", "baixa"]
    message: str
    ref: RefOut


class ComplianceOut(BaseModel):
    items: list[PendingOut]
    counts: dict[Literal["alta", "media", "baixa"], int]


@router.get("/compliance", response_model=ComplianceOut)
@orm
def compliance(request: Request, user: User = Depends(current_user)):
    items = pending_items(user)
    log_access(user, AccessLog.Action.VIEW, "pendencias", user.id, request)
    return ComplianceOut(items=items, counts=count_by_severity(items))
