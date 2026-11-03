from fastapi import Request

from apps.accounts.models import User
from apps.audit.models import AccessLog


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def log_access(user: User, action: str, resource: str, resource_id: int, request: Request) -> None:
    """Grava uma linha na trilha de auditoria. Chamar dentro de função síncrona (@orm)."""
    AccessLog.objects.create(
        user=user, action=action, resource=resource, resource_id=resource_id, ip_address=client_ip(request)
    )
