from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, StrictInt, StringConstraints

from apps.clinical.models import Region, Treatment

# Dinheiro: centavos inteiros (JSON sem casas decimais). Quantidade: decimal com 2 casas, vai como número no JSON.
Cents = Annotated[StrictInt, Field(ge=0, le=100_000_000)]
Qty = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
TreatmentKey = Literal[tuple(Treatment.values)]
RegionKey = Literal[tuple(Region.values)]
MethodKey = Literal["pix", "dinheiro", "debito", "credito", "boleto", "outro"]
BudgetStatusKey = Literal["rascunho", "aprovado", "recusado", "cancelado"]


# ---- tabela de preços ----
class PriceItemIn(BaseModel):
    name: Name
    treatment: TreatmentKey
    region: RegionKey | None = None
    unit_price_cents: Cents
    active: bool = True


class PriceItemPatch(BaseModel):
    name: Name | None = None
    treatment: TreatmentKey | None = None
    region: RegionKey | None = None  # null explícito = preço genérico (qualquer região)
    unit_price_cents: Cents | None = None
    active: bool | None = None


class PriceItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    treatment: str
    region: str | None
    unit_price_cents: int
    active: bool


# ---- orçamento ----
class ItemIn(BaseModel):
    id: int | None = None  # só no PUT: linha existente do mesmo orçamento
    description: Description
    quantity: Decimal = Field(gt=0, le=100000, max_digits=8, decimal_places=2)
    unit: str = Field(default="", max_length=8)
    unit_price_cents: Cents


class BudgetIn(BaseModel):
    patient_id: int
    plan_id: int | None = None
    items: list[ItemIn] = Field(min_length=1, max_length=100)
    discount_cents: Cents = 0
    notes: str = Field(default="", max_length=2000)


class BudgetUpdate(BaseModel):
    """Troca as linhas, o desconto e a observação do rascunho. Linha com `id` é atualizada, sem `id` é nova, e a que
    não vier é desativada (continua guardada)."""

    items: list[ItemIn] = Field(min_length=1, max_length=100)
    discount_cents: Cents = 0
    notes: str = Field(default="", max_length=2000)


class StatusIn(BaseModel):
    status: Literal["aprovado", "recusado", "cancelado"]


class PaymentIn(BaseModel):
    amount_cents: StrictInt = Field(gt=0, le=100_000_000)
    method: MethodKey
    paid_at: datetime | None = None  # sem data = agora
    notes: str = Field(default="", max_length=300)


class ReverseIn(BaseModel):
    reason: Reason


class ItemOut(BaseModel):
    id: int
    description: str
    quantity: Qty
    unit: str
    unit_price_cents: int
    total_cents: int


class PaymentOut(BaseModel):
    id: int
    amount_cents: int  # negativo = estorno
    method: str
    paid_at: datetime
    notes: str  # no estorno, o motivo
    reverses_id: int | None
    reversed: bool  # este pagamento já foi estornado


class BudgetOut(BaseModel):
    id: int
    patient_id: int
    patient_name: str  # "Dados ocultos" quando o paciente está oculto
    patient_hidden: bool
    plan_id: int | None
    status: str
    subtotal_cents: int
    discount_cents: int
    total_cents: int
    paid_cents: int
    balance_cents: int
    notes: str
    created_at: datetime
    approved_at: datetime | None
    items: list[ItemOut]
    payments: list[PaymentOut]
    warnings: list[str] = []  # só preenchido em `from-plan`: itens sem preço


# ---- resumo ----
class DayRow(BaseModel):
    date: date
    received_cents: int


class SummaryOut(BaseModel):
    month: str
    billed_cents: int  # soma dos aprovados no mês
    received_cents: int  # pagamentos do mês menos estornos
    open_cents: int  # saldo atual de todos os aprovados
    by_method: dict[str, int]
    by_day: list[DayRow]
