from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from apps.accounts.models import User
from apps.clinical.models import FacialPlan, Treatment
from apps.guidance.models import Orientacao

from ..deps import current_user, get_patient_or_404
from ..orm import orm

router = APIRouter(tags=["orientações"])

TREATMENT_LABEL = dict(Treatment.choices)


class OrientacaoOut(BaseModel):
    id: int
    treatment: str
    title: str
    items: list[str]  # o texto do admin, uma orientação por linha


class GuidanceSection(BaseModel):
    treatment: str
    treatment_label: str
    orientations: list[OrientacaoOut]


class PatientGuidanceOut(BaseModel):
    patient_name: str
    plan_id: int | None
    plan_title: str
    plan_date: datetime | None
    professional_name: str
    professional_title: str
    sections: list[GuidanceSection]
    treatments_without_template: list[str]  # tratamentos do plano sem orientação ativa cadastrada


def _out(o: Orientacao) -> OrientacaoOut:
    items = [line.strip() for line in o.text.splitlines() if line.strip()]
    return OrientacaoOut(id=o.id, treatment=o.treatment, title=o.title, items=items)


@router.get("/guidance", response_model=list[OrientacaoOut])
@orm
def list_guidance(treatment: str | None = None, _user: User = Depends(current_user)):
    qs = Orientacao.objects.filter(active=True)
    if treatment:
        qs = qs.filter(treatment=treatment)
    return [_out(o) for o in qs]


@router.get("/patients/{patient_id}/guidance", response_model=PatientGuidanceOut)
@orm
def patient_guidance(patient_id: int, plan_id: int | None = None, user: User = Depends(current_user)):
    """Orientações do paciente a partir dos tratamentos aplicados (quantidade > 0) no plano."""
    patient = get_patient_or_404(user, patient_id)
    plans = patient.plans.prefetch_related("points")
    plan: FacialPlan | None
    if plan_id is not None:
        plan = plans.filter(pk=plan_id).first()
        if plan is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Plano não encontrado.")
    else:
        plan = plans.first()

    used: list[str] = []
    if plan is not None:
        for p in plan.points.all():
            if p.amount > 0 and p.treatment not in used:
                used.append(p.treatment)
    used.sort(key=list(TREATMENT_LABEL).index)

    by_treatment: dict[str, list[Orientacao]] = {}
    for o in Orientacao.objects.filter(active=True, treatment__in=used):
        by_treatment.setdefault(o.treatment, []).append(o)

    return PatientGuidanceOut(
        patient_name=patient.full_name,
        plan_id=plan.id if plan else None,
        plan_title=plan.title if plan else "",
        plan_date=plan.created_at if plan else None,
        professional_name=user.full_name,
        professional_title=user.professional_title,
        sections=[
            GuidanceSection(
                treatment=t, treatment_label=TREATMENT_LABEL[t], orientations=[_out(o) for o in by_treatment[t]]
            )
            for t in used
            if t in by_treatment
        ],
        treatments_without_template=[TREATMENT_LABEL[t] for t in used if t not in by_treatment],
    )
