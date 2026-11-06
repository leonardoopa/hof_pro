from django.db import transaction
from fastapi import APIRouter, Depends, HTTPException, status

from apps.accounts.models import User
from apps.clinical.models import UNIT_BY_TREATMENT, FacialPlan, PlanPoint
from apps.patients.models import PatientPhoto

from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..schemas import PlanIn, PlanOut, PlanSummaryOut, PlanTotals, PointOut

router = APIRouter(tags=["planejamento"])


def _totals(plan: FacialPlan) -> PlanTotals:
    return PlanTotals(**plan.totals())


def _plan_out(plan: FacialPlan) -> PlanOut:
    return PlanOut(
        id=plan.id,
        patient_id=plan.patient_id,
        photo_id=plan.photo_id,
        title=plan.title,
        notes=plan.notes,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        applied_at=plan.applied_at,
        totals=_totals(plan),
        points=[PointOut.model_validate(p) for p in plan.points.all()],
    )


def _own_plan(user: User, plan_id: int) -> FacialPlan:
    plan = FacialPlan.objects.filter(pk=plan_id, patient__owner=user).prefetch_related("points").first()
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plano não encontrado.")
    return plan


def _check_photo(patient, photo_id):
    if photo_id is not None and not PatientPhoto.objects.filter(pk=photo_id, patient=patient).exists():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Foto não pertence a este paciente.")


def _check_not_hidden(patient) -> None:
    # Com os dados ocultos a tela não recebe a foto nem os pontos: salvar dali esvaziaria o plano.
    if patient.anonymized_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Paciente com dados ocultos: mostre os dados antes de alterar o plano.")


def _replace_points(plan: FacialPlan, points) -> None:
    from .inventory import validate_point_lots  # import tardio: inventory importa _own_plan daqui

    validate_point_lots(plan.patient.owner, points)
    plan.points.all().delete()
    PlanPoint.objects.bulk_create(
        PlanPoint(
            plan=plan,
            region=p.region,
            treatment=p.treatment,
            x=p.x,
            y=p.y,
            amount=p.amount,
            technique=p.technique,
            depth=p.depth,
            lot_id=p.lot_id,
            point_key=p.point_key,
            unit=UNIT_BY_TREATMENT[p.treatment],
        )
        for p in points
    )


@router.get("/patients/{patient_id}/plans", response_model=list[PlanSummaryOut])
@orm
def list_plans(patient_id: int, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    plans = patient.plans.prefetch_related("points")
    return [
        PlanSummaryOut(
            id=p.id, title=p.title, photo_id=p.photo_id, created_at=p.created_at, applied_at=p.applied_at, totals=_totals(p)
        )
        for p in plans
    ]


@router.post("/patients/{patient_id}/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
@orm
def create_plan(patient_id: int, data: PlanIn, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    _check_not_hidden(patient)
    _check_photo(patient, data.photo_id)
    with transaction.atomic():
        plan = FacialPlan.objects.create(
            patient=patient, created_by=user, photo_id=data.photo_id, title=data.title, notes=data.notes
        )
        _replace_points(plan, data.points)
    return _plan_out(_own_plan(user, plan.id))


@router.get("/plans/{plan_id}", response_model=PlanOut)
@orm
def get_plan(plan_id: int, user: User = Depends(current_user)):
    return _plan_out(_own_plan(user, plan_id))


@router.put("/plans/{plan_id}", response_model=PlanOut)
@orm
def update_plan(plan_id: int, data: PlanIn, user: User = Depends(current_user)):
    plan = _own_plan(user, plan_id)
    if plan.applied_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Plano já aplicado não pode ser alterado: crie um novo plano.")
    _check_not_hidden(plan.patient)
    _check_photo(plan.patient, data.photo_id)
    with transaction.atomic():
        plan.photo_id = data.photo_id
        plan.title = data.title
        plan.notes = data.notes
        plan.save()
        _replace_points(plan, data.points)
    return _plan_out(_own_plan(user, plan_id))
