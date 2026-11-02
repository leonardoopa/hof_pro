import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from apps.accounts.models import User
from apps.patients.models import Patient

from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)

_unauthorized = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Não autenticado.",
    headers={"WWW-Authenticate": "Bearer"},
)


async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    if creds is None:
        raise _unauthorized
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise _unauthorized
    user = await User.objects.filter(pk=payload.get("sub"), is_active=True).afirst()
    if user is None:
        raise _unauthorized
    return user


def get_patient_or_404(user: User, patient_id: int) -> Patient:
    """Sempre filtra pelo dono: um profissional nunca enxerga paciente de outro."""
    patient = Patient.objects.filter(owner=user, pk=patient_id).first()
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paciente não encontrado.")
    return patient
