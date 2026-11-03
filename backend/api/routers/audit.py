from datetime import datetime

from fastapi import APIRouter, Depends, Query

from apps.accounts.models import User
from apps.audit.models import AccessLog

from ..deps import current_user
from ..orm import orm
from ..schemas import ORM

router = APIRouter(tags=["auditoria"])


class AccessLogOut(ORM):
    id: int
    action: str
    resource: str
    resource_id: int
    ip_address: str | None
    created_at: datetime


@router.get("/audit", response_model=list[AccessLogOut])
@orm
def list_access_logs(limit: int = Query(100, ge=1, le=500), user: User = Depends(current_user)):
    """Trilha de acessos do próprio usuário (mais recentes primeiro)."""
    return list(AccessLog.objects.filter(user=user)[:limit])
