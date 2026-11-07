from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse

from apps.accounts.models import User
from apps.clinical.models import FacialPlan, UNIT_BY_TREATMENT, Depth, Region, Technique, Treatment
from apps.clinical.point_labels import point_label
from apps.inventory.models import Application, Lot, LotMovement, Product

from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..printing import esc, page
from ..schemas_inventory import (
    AlertsOut,
    ApplyOut,
    LotBase,
    LotIn,
    LotOut,
    LotPatch,
    MovementOut,
    ProductCreatedOut,
    ProductIn,
    ProductOut,
    ProductPatch,
    TraceabilityOut,
    TraceRow,
)
from .plans import _own_plan

router = APIRouter(tags=["estoque"])

ALERT_DAYS = 30


# ---- helpers ----
def _lot_out(lot: Lot, today) -> LotOut:
    days = (lot.expires_on - today).days
    return LotOut(
        id=lot.id,
        product_id=lot.product_id,
        product_label=f"{lot.product.brand} {lot.product.name}",
        unit=lot.product.unit,
        number=lot.number,
        expires_on=lot.expires_on,
        initial_quantity=lot.initial_quantity,
        balance=lot.balance,
        expired=days < 0,
        days_to_expire=days,
    )


def _own_product(user: User, product_id: int) -> Product:
    product = Product.objects.filter(pk=product_id, owner=user).first()
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")
    return product


def _own_lot(user: User, lot_id: int) -> Lot:
    lot = Lot.objects.filter(pk=lot_id, product__owner=user).select_related("product").first()
    if lot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lote não encontrado.")
    return lot


@transaction.atomic
def register_lot(user: User, product: Product, data: LotBase) -> Lot:
    """Cria o lote com a movimentação de entrada. Serve à entrada de lote e ao cadastro do produto com o primeiro lote."""
    number = data.number.strip()
    if Lot.objects.filter(product=product, number__iexact=number).exists():
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um lote com esse número para este produto.")
    lot = Lot.objects.create(
        product=product, number=number, expires_on=data.expires_on, initial_quantity=data.quantity, balance=data.quantity
    )
    LotMovement.objects.create(
        lot=lot, kind=LotMovement.Kind.ENTRY, delta=data.quantity, balance_after=lot.balance, author=user, reason="Entrada do lote"
    )
    return lot


def _check_lot_usable(lot: Lot, treatment: str, today) -> None:
    label = f"{lot.product.name} lote {lot.number}"
    if lot.expires_on < today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Lote vencido: {label}.")
    if lot.product.unit != UNIT_BY_TREATMENT[Treatment(treatment)]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unidade do produto ({lot.product.unit}) não confere com o tratamento: {label}."
        )


def validate_point_lots(user: User, points) -> None:
    """Usado ao salvar o plano: lote precisa ser do profissional, estar válido e ter unidade compatível."""
    wanted = {p.lot_id for p in points if p.lot_id is not None}
    if not wanted:
        return
    lots = {l.id: l for l in Lot.objects.filter(pk__in=wanted, product__owner=user).select_related("product")}
    today = timezone.localdate()
    for p in points:
        if p.lot_id is None:
            continue
        lot = lots.get(p.lot_id)
        if lot is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Lote não encontrado.")
        _check_lot_usable(lot, p.treatment, today)


# ---- produtos ----
@router.get("/inventory/products", response_model=list[ProductOut])
@orm
def list_products(user: User = Depends(current_user)):
    return list(Product.objects.filter(owner=user))


@router.post("/inventory/products", response_model=ProductCreatedOut, status_code=status.HTTP_201_CREATED)
@orm
def create_product(data: ProductIn, user: User = Depends(current_user)):
    with transaction.atomic():  # produto e primeiro lote: grava os dois ou nenhum
        product = Product.objects.create(owner=user, **data.model_dump(exclude={"lot"}))
        lot = register_lot(user, product, data.lot) if data.lot else None
    created = _lot_out(lot, timezone.localdate()) if lot else None
    return ProductCreatedOut(**ProductOut.model_validate(product).model_dump(), lot=created)


@router.patch("/inventory/products/{product_id}", response_model=ProductOut)
@orm
def update_product(product_id: int, data: ProductPatch, user: User = Depends(current_user)):
    product = _own_product(user, product_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        setattr(product, field, value)
    product.save()
    return product


# ---- lotes ----
@router.get("/inventory/lots", response_model=list[LotOut])
@orm
def list_lots(product_id: int | None = None, available: bool = False, user: User = Depends(current_user)):
    today = timezone.localdate()
    qs = Lot.objects.filter(product__owner=user).select_related("product")
    if product_id is not None:
        qs = qs.filter(product_id=product_id)
    if available:  # com saldo, válido e de produto ativo (primeiro a vencer primeiro)
        qs = qs.filter(balance__gt=0, expires_on__gte=today, product__active=True)
    return [_lot_out(l, today) for l in qs]


@router.post("/inventory/lots", response_model=LotOut, status_code=status.HTTP_201_CREATED)
@orm
def create_lot(data: LotIn, user: User = Depends(current_user)):
    lot = register_lot(user, _own_product(user, data.product_id), data)
    return _lot_out(lot, timezone.localdate())


@router.patch("/inventory/lots/{lot_id}", response_model=LotOut)
@orm
def update_lot(lot_id: int, data: LotPatch, user: User = Depends(current_user)):
    lot = _own_lot(user, lot_id)
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "number" in changes:
        changes["number"] = changes["number"].strip()
        if Lot.objects.filter(product=lot.product, number__iexact=changes["number"]).exclude(pk=lot.pk).exists():
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um lote com esse número para este produto.")
    reason = (changes.pop("reason", "") or "").strip()
    old_balance = lot.balance
    new_balance = changes.get("balance")
    adjusting = new_balance is not None and new_balance != old_balance
    if adjusting and not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Informe o motivo (reason) ao alterar o saldo do lote.")
    with transaction.atomic():
        for field, value in changes.items():
            setattr(lot, field, value)  # "balance" = correção manual de inventário
        lot.save()
        if adjusting:
            LotMovement.objects.create(
                lot=lot, kind=LotMovement.Kind.ADJUSTMENT, delta=new_balance - old_balance,
                balance_after=new_balance, author=user, reason=reason,
            )
    return _lot_out(lot, timezone.localdate())


@router.get("/inventory/lots/{lot_id}/movements", response_model=list[MovementOut])
@orm
def lot_movements(lot_id: int, user: User = Depends(current_user)):
    lot = _own_lot(user, lot_id)
    return [
        MovementOut(
            id=m.id, kind=m.kind, delta=m.delta, balance_after=m.balance_after,
            author=m.author.full_name if m.author else "", reason=m.reason, created_at=m.created_at,
        )
        for m in lot.movements.select_related("author")
    ]


@router.get("/inventory/alerts", response_model=AlertsOut)
@orm
def alerts(user: User = Depends(current_user)):
    """Lotes com saldo que já venceram ou vencem em até 30 dias."""
    today = timezone.localdate()
    qs = Lot.objects.filter(
        product__owner=user, balance__gt=0, expires_on__lte=today + timedelta(days=ALERT_DAYS)
    ).select_related("product")
    lots = [_lot_out(l, today) for l in qs]
    return AlertsOut(
        expired=[l for l in lots if l.expired],
        expiring=[l for l in lots if not l.expired],
        window_days=ALERT_DAYS,
    )


# ---- baixa ao marcar o plano como aplicado ----
@router.post("/plans/{plan_id}/apply", response_model=ApplyOut)
@orm
def apply_plan(plan_id: int, user: User = Depends(current_user)):
    """Dá baixa no saldo dos lotes dos pontos do plano e registra a rastreabilidade.
    Tudo ou nada: lote vencido ou saldo insuficiente cancela a operação inteira."""
    plan = _own_plan(user, plan_id)
    if plan.applied_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este plano já foi marcado como aplicado.")
    today = timezone.localdate()
    applied = without_lot = 0
    with transaction.atomic():
        # Trava contra aplicação dupla simultânea: só uma requisição consegue marcar o plano.
        if not FacialPlan.objects.filter(pk=plan.pk, applied_at__isnull=True).update(applied_at=timezone.now()):
            raise HTTPException(status.HTTP_409_CONFLICT, "Este plano já foi marcado como aplicado.")
        for p in plan.points.select_related("lot__product"):
            if p.amount <= 0:
                continue
            lot = p.lot
            if lot is None:
                without_lot += 1
                continue
            if lot.product.owner_id != user.id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Lote não encontrado.")
            _check_lot_usable(lot, p.treatment, today)
            # Decremento condicional: nunca deixa o saldo negativo, mesmo com requisições simultâneas.
            if not Lot.objects.filter(pk=lot.pk, balance__gte=p.amount).update(balance=F("balance") - p.amount):
                raise HTTPException(
                    status.HTTP_409_CONFLICT, f"Saldo insuficiente no lote {lot.number} de {lot.product.name}."
                )
            lot.refresh_from_db(fields=["balance"])
            LotMovement.objects.create(
                lot=lot, kind=LotMovement.Kind.WRITE_OFF, delta=-p.amount, balance_after=lot.balance, author=user,
                reason=f"Aplicação do plano #{plan.id}",
            )
            Application.objects.create(
                patient=plan.patient, plan=plan, point=p, lot=lot, applied_by=user, amount=p.amount, unit=p.unit,
                region=p.region, point_key=p.point_key, treatment=p.treatment, technique=p.technique, depth=p.depth,
            )
            applied += 1
        plan.refresh_from_db(fields=["applied_at"])
    return ApplyOut(applied_at=plan.applied_at, applications=applied, without_lot=without_lot)


# ---- cartão de rastreabilidade ----
def _label(choices, value: str) -> str:
    try:
        return choices(value).label
    except ValueError:
        return value or "-"


def _point_small(row: TraceRow) -> str:
    label = point_label(row.region, row.point_key)
    return f"<br><small>{esc(label)}</small>" if label else ""


def _trace(user: User, patient_id: int) -> TraceabilityOut:
    patient = get_patient_or_404(user, patient_id)
    apps = patient.applications.select_related("lot__product")
    rows = [
        TraceRow(
            id=a.id, applied_at=a.applied_at, plan_id=a.plan_id, region=a.region, point_key=a.point_key, treatment=a.treatment,
            technique=a.technique, depth=a.depth, amount=a.amount, unit=a.unit,
            product=f"{a.lot.product.brand} {a.lot.product.name}", anvisa_registration=a.lot.product.anvisa_registration,
            lot_number=a.lot.number, lot_expires_on=a.lot.expires_on,
        )
        for a in apps
    ]
    return TraceabilityOut(patient_id=patient.id, patient_name=patient.full_name, professional=user.full_name, rows=rows)


@router.get("/patients/{patient_id}/traceability", response_model=TraceabilityOut)
@orm
def traceability(patient_id: int, user: User = Depends(current_user)):
    return _trace(user, patient_id)


@router.get("/patients/{patient_id}/traceability/print", response_class=HTMLResponse)
@orm
def traceability_print(patient_id: int, user: User = Depends(current_user)):
    data = _trace(user, patient_id)
    tz = timezone.get_current_timezone()
    rows = "".join(
        "<tr>"
        f"<td>{esc(r.applied_at.astimezone(tz).strftime('%d/%m/%Y %H:%M'))}</td>"
        f"<td>{esc(_label(Region, r.region))}{_point_small(r)}</td>"
        f"<td>{esc(r.product)}<br><small>Anvisa: {esc(r.anvisa_registration or '-')}</small></td>"
        f"<td>{esc(r.lot_number)}<br><small>val. {esc(r.lot_expires_on.strftime('%d/%m/%Y'))}</small></td>"
        f"<td>{esc(_label(Technique, r.technique))} / {esc(_label(Depth, r.depth))}</td>"
        f"<td>{esc(f'{r.amount.normalize():f}'.replace('.', ','))} {esc(r.unit)}</td>"
        "</tr>"
        for r in data.rows
    ) or '<tr><td colspan="6">Nenhuma aplicação registrada.</td></tr>'
    body = (
        "<h1>Cartão de rastreabilidade</h1>"
        f'<p class="meta">Paciente: {esc(data.patient_name)} · Profissional: {esc(data.professional)} · '
        f"Emitido em {esc(timezone.localtime().strftime('%d/%m/%Y %H:%M'))}</p>"
        "<table><tr><th>Data</th><th>Região</th><th>Produto</th><th>Lote</th><th>Técnica / plano</th><th>Quantidade</th></tr>"
        f"{rows}</table>"
    )
    return HTMLResponse(page(f"Rastreabilidade - {data.patient_name}", body), headers={"Cache-Control": "no-store"})
