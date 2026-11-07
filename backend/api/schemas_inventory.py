from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

Qty = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
KindKey = Literal["toxina", "preenchedor", "bioestimulador", "skinbooster", "outro"]
UnitKey = Literal["ml", "U"]


class LotBase(BaseModel):
    number: str = Field(min_length=1, max_length=40)
    expires_on: date
    quantity: Decimal = Field(gt=0, le=100000, max_digits=8, decimal_places=2)


class ProductIn(BaseModel):
    brand: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    kind: KindKey = "preenchedor"
    unit: UnitKey = "ml"
    anvisa_registration: str = Field(default="", max_length=40)
    lot: LotBase | None = None  # primeiro lote, criado na mesma transação do produto


class ProductPatch(BaseModel):
    brand: str | None = Field(default=None, min_length=1, max_length=80)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: KindKey | None = None
    anvisa_registration: str | None = Field(default=None, max_length=40)
    active: bool | None = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    brand: str
    name: str
    kind: str
    unit: str
    anvisa_registration: str
    active: bool


class LotIn(LotBase):
    product_id: int


class LotPatch(BaseModel):
    number: str | None = Field(default=None, min_length=1, max_length=40)
    expires_on: date | None = None
    balance: Decimal | None = Field(default=None, ge=0, le=100000, max_digits=8, decimal_places=2)
    reason: str | None = Field(default=None, max_length=200)  # obrigatório ao alterar o saldo


class LotOut(BaseModel):
    id: int
    product_id: int
    product_label: str
    unit: str
    number: str
    expires_on: date
    initial_quantity: Qty
    balance: Qty
    expired: bool
    days_to_expire: int


class ProductCreatedOut(ProductOut):
    lot: LotOut | None  # o lote criado junto, para quem chamou já poder selecioná-lo


class MovementOut(BaseModel):
    id: int
    kind: str
    delta: Qty
    balance_after: Qty
    author: str
    reason: str
    created_at: datetime


class AlertsOut(BaseModel):
    expired: list[LotOut]
    expiring: list[LotOut]
    window_days: int


class ApplyOut(BaseModel):
    applied_at: datetime
    applications: int
    without_lot: int  # pontos com quantidade, mas sem lote (sem baixa nem rastreabilidade)


class TraceRow(BaseModel):
    id: int
    applied_at: datetime
    plan_id: int | None
    region: str
    point_key: str
    treatment: str
    technique: str
    depth: str
    amount: Qty
    unit: str
    product: str
    anvisa_registration: str
    lot_number: str
    lot_expires_on: date


class TraceabilityOut(BaseModel):
    patient_id: int
    patient_name: str
    professional: str
    rows: list[TraceRow]
