"""Financeiro: preços, orçamentos, pagamentos e resumo. Valores em centavos inteiros (BRL).

Nada é apagado: a tabela de preços desativa, o orçamento muda de estado, a linha tirada do rascunho fica inativa e o
pagamento errado é estornado por um lançamento negativo. Toda escrita de orçamento/pagamento roda em
`transaction.atomic()` com o orçamento bloqueado (`select_for_update`), para pagamentos simultâneos não passarem do saldo.
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone
from pydantic import ValidationError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.clinical.models import FacialPlan, Region, Treatment
from apps.finance.models import Budget, BudgetItem, Payment, PriceItem, line_total_cents
from apps.patients.models import Patient

from ..audit import log_access
from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..schemas_finance import (
    BudgetIn,
    BudgetOut,
    BudgetStatusKey,
    BudgetUpdate,
    DayRow,
    ItemIn,
    ItemOut,
    PaymentIn,
    PaymentOut,
    PriceItemIn,
    PriceItemOut,
    PriceItemPatch,
    ReverseIn,
    StatusIn,
    SummaryOut,
)

router = APIRouter(prefix="/finance", tags=["financeiro"])

UNPROCESSABLE = status.HTTP_422_UNPROCESSABLE_CONTENT
HIDDEN_NAME = "Dados ocultos"
METHODS = [m.value for m in Payment.Method]


def _brl(cents: int) -> str:
    reais, rest = divmod(abs(cents), 100)
    return f"{'-' if cents < 0 else ''}R$ {reais:,}".replace(",", ".") + f",{rest:02d}"


def _aware(dt: datetime) -> datetime:
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def _lock_owner(user: User) -> None:
    """Serializa a tabela de preços do profissional (checagem de preço duplicado + gravação)."""
    User.objects.select_for_update().only("pk").get(pk=user.pk)


# ---- tabela de preços ----
def _check_price_slot(user: User, treatment: str, region: str | None, exclude_id: int | None = None) -> None:
    clash = PriceItem.objects.filter(owner=user, treatment=treatment, region=region, active=True)
    if exclude_id:
        clash = clash.exclude(pk=exclude_id)
    if clash.exists():
        where = Region(region).label if region else "qualquer região"
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Já existe um preço ativo de {Treatment(treatment).label} para {where}. Desative-o ou edite-o."
        )


def _own_price(user: User, price_id: int) -> PriceItem:
    item = PriceItem.objects.filter(pk=price_id, owner=user).first()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preço não encontrado.")
    return item


@router.get("/price-items", response_model=list[PriceItemOut])
@orm
def list_price_items(user: User = Depends(current_user)):
    return list(PriceItem.objects.filter(owner=user))


@router.post("/price-items", response_model=PriceItemOut, status_code=status.HTTP_201_CREATED)
@orm
def create_price_item(data: PriceItemIn, request: Request, user: User = Depends(current_user)):
    with transaction.atomic():
        _lock_owner(user)
        if data.active:
            _check_price_slot(user, data.treatment, data.region)
        item = PriceItem.objects.create(
            owner=user, name=data.name, treatment=data.treatment, region=data.region,
            unit_price_cents=data.unit_price_cents, active=data.active,
        )
        log_access(user, AccessLog.Action.CREATE, "preco", item.id, request)
    return item


@router.patch("/price-items/{price_id}", response_model=PriceItemOut)
@orm
def update_price_item(price_id: int, data: PriceItemPatch, request: Request, user: User = Depends(current_user)):
    fields = data.model_dump(exclude_unset=True)
    if any(fields.get(k, 0) is None for k in ("name", "treatment", "unit_price_cents", "active")):
        raise HTTPException(UNPROCESSABLE, "Valor inválido.")
    with transaction.atomic():
        _lock_owner(user)
        item = _own_price(user, price_id)
        for key, value in fields.items():
            setattr(item, key, value)
        if item.active:
            _check_price_slot(user, item.treatment, item.region, exclude_id=item.id)
        item.save()
        log_access(user, AccessLog.Action.UPDATE, "preco", item.id, request)
    return item


# ---- orçamento: leitura ----
def _load(qs):
    return qs.select_related("patient").prefetch_related("items", "payments")


def _budget_out(b: Budget, warnings: list[str] | None = None) -> BudgetOut:
    hidden = b.patient.anonymized_at is not None
    payments = list(b.payments.all())
    reversed_ids = {p.reverses_id for p in payments if p.reverses_id}
    items = b.active_items()
    subtotal = sum(i.total_cents for i in items)
    total = max(subtotal - b.discount_cents, 0)
    paid = sum(p.amount_cents for p in payments)
    return BudgetOut(
        id=b.id, patient_id=b.patient_id, patient_name=HIDDEN_NAME if hidden else b.patient.full_name, patient_hidden=hidden,
        plan_id=b.plan_id, status=b.status, subtotal_cents=subtotal, discount_cents=b.discount_cents, total_cents=total,
        paid_cents=paid, balance_cents=total - paid, notes="" if hidden else b.notes, created_at=b.created_at, approved_at=b.approved_at,
        items=[
            ItemOut(
                id=i.id, description=i.description, quantity=i.quantity, unit=i.unit, unit_price_cents=i.unit_price_cents,
                total_cents=i.total_cents,
            )
            for i in items
        ],
        payments=[_payment_out(p, p.id in reversed_ids, hidden) for p in payments],
        warnings=warnings or [],
    )


def _payment_out(p: Payment, reversed_: bool, hidden: bool = False) -> PaymentOut:
    return PaymentOut(
        id=p.id, amount_cents=p.amount_cents, method=p.method, paid_at=p.paid_at, notes="" if hidden else p.notes, reverses_id=p.reverses_id,
        reversed=reversed_,
    )


def _own_budget(user: User, budget_id: int, lock: bool = False) -> Budget:
    """Orçamento do dono (404 se for de outro). Com `lock`, bloqueia a linha até o fim da transação: só dentro de atomic."""
    qs = Budget.objects.filter(pk=budget_id, owner=user)
    if lock:
        qs = qs.select_for_update()
    b = qs.first()
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Orçamento não encontrado.")
    return b


def _reload(user: User, budget_id: int, warnings: list[str] | None = None) -> BudgetOut:
    return _budget_out(_load(Budget.objects.filter(pk=budget_id, owner=user)).get(), warnings)


@router.get("/budgets", response_model=list[BudgetOut])
@orm
def list_budgets(
    patient_id: int | None = Query(None),
    status_filter: BudgetStatusKey | None = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(current_user),
):
    qs = Budget.objects.filter(owner=user)
    if patient_id is not None:
        get_patient_or_404(user, patient_id)
        qs = qs.filter(patient_id=patient_id)
    if status_filter is not None:
        qs = qs.filter(status=status_filter)
    return [_budget_out(b) for b in _load(qs)[:limit]]


@router.get("/budgets/{budget_id}", response_model=BudgetOut)
@orm
def get_budget(budget_id: int, request: Request, user: User = Depends(current_user)):
    _own_budget(user, budget_id)
    log_access(user, AccessLog.Action.VIEW, "orcamento", budget_id, request)
    return _reload(user, budget_id)


# ---- orçamento: criação e edição do rascunho ----
def _subtotal(items: list[ItemIn]) -> int:
    return sum(line_total_cents(i.quantity, i.unit_price_cents) for i in items)


def _check_discount(items: list[ItemIn], discount_cents: int) -> None:
    if discount_cents > _subtotal(items):
        raise HTTPException(UNPROCESSABLE, "O desconto não pode passar do subtotal do orçamento.")


def _new_items(budget: Budget, items: list[ItemIn], start: int = 0) -> None:
    BudgetItem.objects.bulk_create(
        BudgetItem(
            budget=budget, description=i.description, quantity=i.quantity, unit=i.unit, unit_price_cents=i.unit_price_cents,
            position=start + n,
        )
        for n, i in enumerate(items)
    )


def _create_budget(
    user: User, patient: Patient, plan: FacialPlan | None, items: list[ItemIn], discount_cents: int, notes: str, request: Request,
    warnings: list[str] | None = None,
) -> BudgetOut:
    _check_discount(items, discount_cents)
    with transaction.atomic():
        b = Budget.objects.create(owner=user, patient=patient, plan=plan, discount_cents=discount_cents, notes=notes)
        _new_items(b, items)
        log_access(user, AccessLog.Action.CREATE, "orcamento", b.id, request)
    return _reload(user, b.id, warnings)


@router.post("/budgets", response_model=BudgetOut, status_code=status.HTTP_201_CREATED)
@orm
def create_budget(data: BudgetIn, request: Request, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, data.patient_id)
    plan = None
    if data.plan_id is not None:
        plan = FacialPlan.objects.filter(pk=data.plan_id, patient__owner=user).first()
        if plan is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Plano não encontrado.")
        if plan.patient_id != patient.id:
            raise HTTPException(UNPROCESSABLE, "O plano não é deste paciente.")
    return _create_budget(user, patient, plan, data.items, data.discount_cents, data.notes, request)


@router.post("/budgets/from-plan/{plan_id}", response_model=BudgetOut, status_code=status.HTTP_201_CREATED)
@orm
def budget_from_plan(plan_id: int, request: Request, user: User = Depends(current_user)):
    """Uma linha por tratamento + região, com a soma das doses dos pontos. O preço é o ativo da região; sem ele, o
    genérico do tratamento; sem nenhum, a linha entra com valor 0 e a resposta traz `warnings`."""
    plan = FacialPlan.objects.filter(pk=plan_id, patient__owner=user).select_related("patient").prefetch_related("points").first()
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plano não encontrado.")
    groups: dict[tuple[str, str], dict] = {}
    for point in sorted(plan.points.all(), key=lambda p: p.id):
        if point.amount <= 0:
            continue  # ponto sem dose não tem o que cobrar
        g = groups.setdefault((point.treatment, point.region), {"quantity": Decimal("0"), "unit": point.unit})
        g["quantity"] += point.amount
    if not groups:
        raise HTTPException(UNPROCESSABLE, "O plano não tem pontos com quantidade para orçar.")

    specific: dict[tuple[str, str], int] = {}
    generic: dict[str, int] = {}
    for p in PriceItem.objects.filter(owner=user, active=True, treatment__in={t for t, _ in groups}).order_by("id"):
        if p.region:
            specific[(p.treatment, p.region)] = p.unit_price_cents
        else:
            generic[p.treatment] = p.unit_price_cents

    items, warnings = [], []
    for (treatment, region), g in groups.items():
        description = f"{Treatment(treatment).label} — {Region(region).label}"
        unit_price = specific.get((treatment, region), generic.get(treatment))
        if unit_price is None:
            unit_price = 0
            warnings.append(f"Sem preço cadastrado para {description}: o item entrou com valor zero.")
        try:
            items.append(ItemIn(description=description, quantity=g["quantity"], unit=g["unit"], unit_price_cents=unit_price))
        except ValidationError:  # dose somada fora do limite do item: 422 em vez de 500
            raise HTTPException(UNPROCESSABLE, f"A quantidade de {description} passa do limite de um item.")
    return _create_budget(user, plan.patient, plan, items, 0, "", request, warnings)


@router.put("/budgets/{budget_id}", response_model=BudgetOut)
@orm
def update_budget(budget_id: int, data: BudgetUpdate, request: Request, user: User = Depends(current_user)):
    """Só o rascunho muda. Depois de aprovado, recusado ou cancelado, nada edita as linhas."""
    _check_discount(data.items, data.discount_cents)
    with transaction.atomic():
        b = _own_budget(user, budget_id, lock=True)
        if b.status != Budget.Status.DRAFT:
            raise HTTPException(status.HTTP_409_CONFLICT, "Só o orçamento em rascunho pode ser editado.")
        existing = {i.id: i for i in b.items.filter(active=True)}
        kept = [i.id for i in data.items if i.id is not None]
        if len(kept) != len(set(kept)) or any(k not in existing for k in kept):
            raise HTTPException(UNPROCESSABLE, "Linha que não pertence a este orçamento.")
        for row in existing.values():
            if row.id not in kept:
                row.active = False
                row.save(update_fields=["active"])
        fresh = []
        for position, i in enumerate(data.items):
            if i.id is None:
                fresh.append((position, i))
                continue
            row = existing[i.id]
            row.description, row.quantity, row.unit, row.unit_price_cents, row.position = (
                i.description, i.quantity, i.unit, i.unit_price_cents, position,
            )
            row.save()
        for position, i in fresh:
            _new_items(b, [i], start=position)
        b.discount_cents, b.notes = data.discount_cents, data.notes
        b.save()
        log_access(user, AccessLog.Action.UPDATE, "orcamento", b.id, request)
    return _reload(user, budget_id)


@router.post("/budgets/{budget_id}/status", response_model=BudgetOut)
@orm
def set_budget_status(budget_id: int, data: StatusIn, request: Request, user: User = Depends(current_user)):
    """rascunho -> aprovado | recusado | cancelado. Aprovado só cancela se o saldo pago estiver zerado (estorne antes)."""
    with transaction.atomic():
        b = _own_budget(user, budget_id, lock=True)  # relido sob o bloqueio: o estado pode ter mudado
        if b.status == Budget.Status.DRAFT:
            pass
        elif b.status == Budget.Status.APPROVED and data.status == "cancelado":
            if b.paid_cents != 0:
                raise HTTPException(status.HTTP_409_CONFLICT, "O orçamento tem pagamentos: estorne-os antes de cancelar.")
        else:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Orçamento {b.get_status_display().lower()} não muda de estado.")
        b.status = data.status
        if data.status == "aprovado":
            b.approved_at = timezone.now()
        b.save()
        log_access(user, AccessLog.Action.UPDATE, "orcamento", b.id, request)
    return _reload(user, budget_id)


# ---- pagamentos ----
@router.post("/budgets/{budget_id}/payments", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
@orm
def add_payment(budget_id: int, data: PaymentIn, request: Request, user: User = Depends(current_user)):
    now = timezone.now()
    paid_at = _aware(data.paid_at) if data.paid_at else now
    if paid_at > now + timedelta(days=1):
        raise HTTPException(UNPROCESSABLE, "A data do pagamento não pode ser no futuro.")
    with transaction.atomic():
        b = _own_budget(user, budget_id, lock=True)  # dois pagamentos simultâneos esperam um pelo outro
        if b.status != Budget.Status.APPROVED:
            raise HTTPException(status.HTTP_409_CONFLICT, "Só orçamento aprovado recebe pagamento.")
        balance = b.total_cents - (b.payments.aggregate(s=Sum("amount_cents"))["s"] or 0)
        if data.amount_cents > balance:
            raise HTTPException(UNPROCESSABLE, f"O valor passa do saldo do orçamento ({_brl(balance)}).")
        p = Payment.objects.create(
            budget=b, amount_cents=data.amount_cents, method=data.method, paid_at=paid_at, notes=data.notes, created_by=user
        )
        log_access(user, AccessLog.Action.CREATE, "pagamento", p.id, request)
    return _payment_out(p, False)


@router.post("/payments/{payment_id}/reverse", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
@orm
def reverse_payment(payment_id: int, data: ReverseIn, request: Request, user: User = Depends(current_user)):
    """Estorno = novo lançamento negativo ligado ao original. Cada pagamento só é estornado uma vez."""
    budget_id = Payment.objects.filter(pk=payment_id, budget__owner=user).values_list("budget_id", flat=True).first()
    if budget_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pagamento não encontrado.")
    with transaction.atomic():
        b = _own_budget(user, budget_id, lock=True)
        original = Payment.objects.get(pk=payment_id, budget=b)  # relido sob o bloqueio
        if original.reverses_id is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Um estorno não pode ser estornado.")
        if Payment.objects.filter(reverses=original).exists():
            raise HTTPException(status.HTTP_409_CONFLICT, "Este pagamento já foi estornado.")
        try:
            with transaction.atomic():
                rev = Payment.objects.create(
                    budget=b, amount_cents=-original.amount_cents, method=original.method, paid_at=timezone.now(),
                    notes=data.reason, reverses=original, created_by=user,
                )
        except IntegrityError:  # rede de segurança: o OneToOne barra o segundo estorno mesmo sem o bloqueio
            raise HTTPException(status.HTTP_409_CONFLICT, "Este pagamento já foi estornado.")
        log_access(user, AccessLog.Action.CREATE, "pagamento", rev.id, request)
    return _payment_out(rev, False)


# ---- resumo ----
@router.get("/summary", response_model=SummaryOut)
@orm
def summary(month: str | None = Query(None), user: User = Depends(current_user)):
    """Mês AAAA-MM (padrão: o atual). Faturado = aprovados no mês; recebido = pagamentos do mês já com os estornos
    (negativos); em aberto = saldo atual de todos os orçamentos aprovados."""
    if month is None:
        today = timezone.localdate()
        year, mon = today.year, today.month
    else:
        try:
            if len(month) != 7 or month[4] != "-":
                raise ValueError
            year, mon = int(month[:4]), int(month[5:])
            first = date(year, mon, 1)
        except ValueError:
            raise HTTPException(UNPROCESSABLE, "Mês inválido. Use o formato AAAA-MM.")
    first = date(year, mon, 1)
    nxt = date(year + (mon == 12), mon % 12 + 1, 1)
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(first, time.min), tz)
    end = timezone.make_aware(datetime.combine(nxt, time.min), tz)

    approved = list(Budget.objects.filter(owner=user, status=Budget.Status.APPROVED).prefetch_related("items", "payments"))
    billed = sum(b.total_cents for b in approved if b.approved_at and start <= b.approved_at < end)
    open_cents = sum(b.balance_cents for b in approved)

    by_method = dict.fromkeys(METHODS, 0)
    by_day: dict[date, int] = defaultdict(int)
    rows = Payment.objects.filter(budget__owner=user, paid_at__gte=start, paid_at__lt=end).values_list(
        "amount_cents", "method", "paid_at"
    )
    for amount, method, paid_at in rows:
        by_method[method] += amount
        by_day[timezone.localtime(paid_at).date()] += amount
    return SummaryOut(
        month=f"{year:04d}-{mon:02d}", billed_cents=billed, received_cents=sum(by_method.values()), open_cents=open_cents,
        by_method=by_method, by_day=[DayRow(date=d, received_cents=v) for d, v in sorted(by_day.items())],
    )
