from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from fastapi import APIRouter, Depends, HTTPException, Request, status

from apps.accounts.models import User

from .. import ratelimit
from ..audit import client_ip
from ..deps import current_user
from ..orm import orm
from ..schemas import LoginIn, RegisterIn, TokenOut, UserOut
from ..security import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_for(user: User) -> TokenOut:
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
@orm
def register(data: RegisterIn):
    email = data.email.lower()
    if User.objects.filter(email__iexact=email).exists():
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conta com esse e-mail.")
    candidate = User(email=email, full_name=data.full_name)
    try:
        validate_password(data.password, candidate)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, list(exc.messages))
    user = User.objects.create_user(
        email=email,
        password=data.password,
        full_name=data.full_name.strip(),
        professional_title=data.professional_title.strip(),
        license_number=data.license_number.strip(),
    )
    return _token_for(user)


@router.post("/login", response_model=TokenOut)
@orm
def login(data: LoginIn, request: Request):
    email, ip = data.email.lower(), client_ip(request) or ""
    wait = ratelimit.retry_after(email, ip)
    if wait:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Muitas tentativas de login. Tente novamente em {-(-wait // 60)} minuto(s).",
            headers={"Retry-After": str(wait)},
        )
    user = authenticate(email=email, password=data.password)
    if user is None:
        ratelimit.register_failure(email, ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
    ratelimit.reset(email, ip)
    return _token_for(user)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user
