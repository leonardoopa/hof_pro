from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db.models import Count, Max, Sum
from django.utils import timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from apps.accounts.models import User
from apps.clinical.models import Treatment
from apps.inventory.models import Application
from apps.patients.models import Patient

from ..deps import current_user
from ..orm import orm

router = APIRouter(tags=["relatórios"])


class UsageRow(BaseModel):
    product_id: int
    product_label: str
    unit: str
    lot_id: int | None = None
    lot_number: str | None = None
    total: Decimal
    applications: int


class UsageOut(BaseModel):
    date_from: date
    date_to: date
    by_lot: list[UsageRow]
    by_product: list[UsageRow]


class ReturnRow(BaseModel):
    patient_id: int
    full_name: str
    phone: str
    last_applied_at: datetime
    days_since: int
    treatments: list[str]


class ReturnsOut(BaseModel):
    days: int
    patients: list[ReturnRow]


def _not_anonymized(qs, prefix: str = ""):
    """Pacientes anonimizados nunca entram em relatório que expõe dados pessoais.
    Tolera o modelo ainda sem o campo (anonymized_at ou anonymized)."""
    names = {f.name for f in Patient._meta.get_fields()}
    if "anonymized_at" in names:
        return qs.filter(**{f"{prefix}anonymized_at__isnull": True})
    if "anonymized" in names:
        return qs.filter(**{f"{prefix}anonymized": False})
    return qs


@router.get("/reports/usage", response_model=UsageOut)
@orm
def usage(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    user: User = Depends(current_user),
):
    """Consumo (U/ml) por lote e por produto no período, só do dono. Padrão: últimos 30 dias."""
    today = timezone.localdate()
    date_to = date_to or today
    date_from = date_from or date_to - timedelta(days=30)
    if date_from > date_to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A data inicial deve ser anterior à final.")
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(date_from, time.min), tz)
    end = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time.min), tz)
    qs = Application.objects.filter(lot__product__owner=user, applied_at__gte=start, applied_at__lt=end)

    by_lot = [
        UsageRow(
            product_id=r["lot__product_id"], product_label=f'{r["lot__product__brand"]} {r["lot__product__name"]}',
            unit=r["unit"], lot_id=r["lot_id"], lot_number=r["lot__number"], total=r["total"], applications=r["n"],
        )
        for r in qs.values("lot_id", "lot__number", "lot__product_id", "lot__product__brand", "lot__product__name", "unit")
        .annotate(total=Sum("amount"), n=Count("id"))
        .order_by("lot__product__brand", "lot__product__name", "lot__number")
    ]
    by_product = [
        UsageRow(
            product_id=r["lot__product_id"], product_label=f'{r["lot__product__brand"]} {r["lot__product__name"]}',
            unit=r["unit"], total=r["total"], applications=r["n"],
        )
        for r in qs.values("lot__product_id", "lot__product__brand", "lot__product__name", "unit")
        .annotate(total=Sum("amount"), n=Count("id"))
        .order_by("lot__product__brand", "lot__product__name")
    ]
    return UsageOut(date_from=date_from, date_to=date_to, by_lot=by_lot, by_product=by_product)


@router.get("/reports/returns", response_model=ReturnsOut)
@orm
def returns(days: int = Query(90, ge=1, le=3650), user: User = Depends(current_user)):
    """Pacientes cuja última aplicação foi há mais de `days` dias (sem arquivados e sem dados ocultos)."""
    cutoff = timezone.now() - timedelta(days=days)
    patients = (
        _not_anonymized(Patient.objects.filter(owner=user, archived_at__isnull=True))
        .annotate(last=Max("applications__applied_at"))
        .filter(last__isnull=False, last__lt=cutoff)
        .order_by("last")
    )
    labels = dict(Treatment.choices)
    rows = []
    for p in patients:
        kinds = sorted(set(p.applications.values_list("treatment", flat=True)))
        rows.append(
            ReturnRow(
                patient_id=p.id, full_name=p.full_name, phone=p.phone, last_applied_at=p.last,
                days_since=(timezone.now() - p.last).days, treatments=[labels.get(k, k) for k in kinds],
            )
        )
    return ReturnsOut(days=days, patients=rows)
