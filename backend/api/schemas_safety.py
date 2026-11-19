from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, PlainSerializer

Qty = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
KindKey = Literal["oclusao_vascular", "nodulo", "edema", "hematoma", "ptose", "infeccao", "alergia", "assimetria", "outro"]
SeverityKey = Literal["leve", "moderada", "grave"]
OutcomeKey = Literal["acompanhamento", "resolvido", "sequela"]
# Sinais do checklist de oclusão vascular. A lista vem dos guias citados na tela; texto livre vai na descrição.
SignKey = Literal[
    "palidez", "livedo", "dor_desproporcional", "enchimento_capilar_lento", "cianose", "bolhas", "alteracao_visual", "dor_ocular",
    "alteracao_neurologica",
]


class AdverseEventIn(BaseModel):
    application_id: int | None = None
    lot_id: int | None = None  # sem aplicação ligada; com aplicação, o lote vem dela
    region: str = Field(default="", max_length=20)
    point_key: str = Field(default="", max_length=40)
    kind: KindKey
    severity: SeverityKey
    onset_at: datetime
    signs: list[SignKey] = Field(default_factory=list, max_length=20)
    description: str = Field(default="", max_length=5000)
    conduct: str = Field(default="", max_length=5000)
    hyaluronidase_lot_id: int | None = None
    hyaluronidase_amount: Decimal | None = Field(default=None, gt=0, le=100000, max_digits=8, decimal_places=2)
    protocol_started_at: datetime | None = None


class AdverseEventPatch(BaseModel):
    severity: SeverityKey | None = None
    description: str | None = Field(default=None, max_length=5000)
    conduct: str | None = Field(default=None, max_length=5000)
    outcome: OutcomeKey | None = None
    anvisa_notified_on: date | None = None
    anvisa_protocol: str | None = Field(default=None, max_length=60)


class AdverseEventOut(BaseModel):
    id: int
    patient_id: int
    application_id: int | None
    lot_id: int | None
    lot_label: str
    region: str
    point_key: str
    kind: str
    kind_label: str
    severity: str
    onset_at: datetime
    signs: list[str]
    description: str
    conduct: str
    hyaluronidase_lot_id: int | None
    hyaluronidase_label: str
    hyaluronidase_amount: Qty | None
    protocol_started_at: datetime | None
    outcome: str
    anvisa_notified_on: date | None
    anvisa_protocol: str
    created_at: datetime
    updated_at: datetime


class RecallRow(BaseModel):
    application_id: int
    applied_at: datetime
    patient_id: int
    patient_name: str
    patient_phone: str
    hidden: bool  # dados ocultos: nome e contato não aparecem
    region: str
    point_key: str
    amount: Qty
    unit: str


class RecallOut(BaseModel):
    lot_id: int
    lot_number: str
    product: str
    rows: list[RecallRow]


class CheckItem(BaseModel):
    code: str
    level: Literal["atencao", "info"]
    message: str


class ApplyCheckOut(BaseModel):
    items: list[CheckItem]
