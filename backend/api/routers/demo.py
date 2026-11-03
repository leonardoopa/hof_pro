from fastapi import APIRouter, Depends
from pydantic import BaseModel

from apps.accounts.demo import seed_demo
from apps.accounts.models import User
from apps.patients.models import Patient

from ..deps import current_user
from ..orm import orm

router = APIRouter(tags=["onboarding"])


class DemoOut(BaseModel):
    created: bool


@router.post("/demo", response_model=DemoOut)
@orm
def load_demo(user: User = Depends(current_user)):
    """Carrega os dados de demonstração, mas só para quem ainda não tem nenhum paciente."""
    if Patient.objects.filter(owner=user).exists():
        return DemoOut(created=False)
    return DemoOut(created=seed_demo(user))
