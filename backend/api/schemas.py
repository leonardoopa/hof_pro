from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, PlainSerializer

# Decimal no banco; número JSON na resposta.
Amount = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]

RegionKey = Literal["testa", "temporas", "olheiras", "malar", "nasolabial", "mandibula", "mento"]
TreatmentKey = Literal["botox", "preenchimento", "bioestimulador", "skinbooster", "outro"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth ----
class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    professional_title: str = Field(default="", max_length=80)
    license_number: str = Field(default="", max_length=40)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    professional_title: str
    license_number: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---- pacientes ----
class PatientIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    birth_date: date | None = None
    phone: str = Field(default="", max_length=30)
    email: EmailStr | Literal[""] = ""
    notes: str = ""


class PatientPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    birth_date: date | None = None
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | Literal[""] | None = None
    notes: str | None = None


class PatientOut(ORM):
    id: int
    full_name: str
    birth_date: date | None
    phone: str
    email: str
    notes: str
    created_at: datetime


class PhotoOut(ORM):
    id: int
    kind: str
    width: int
    height: int
    created_at: datetime


# ---- anamnese ----
class QuestionOut(ORM):
    id: int
    key: str
    text: str
    detail_prompt: str


class AnswerIn(BaseModel):
    question_id: int
    answer: bool
    detail: str = Field(default="", max_length=500)


class AnamnesisIn(BaseModel):
    answers: list[AnswerIn]
    notes: str = ""


class AnswerOut(ORM):
    question_id: int
    answer: bool
    detail: str


class AnamnesisOut(BaseModel):
    answers: list[AnswerOut]
    notes: str
    updated_at: datetime | None


# ---- planejamento ----
class PointIn(BaseModel):
    region: RegionKey
    treatment: TreatmentKey
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    amount: Decimal = Field(default=Decimal("0"), ge=0, le=200, max_digits=6, decimal_places=2)


class PlanIn(BaseModel):
    photo_id: int | None = None
    title: str = Field(default="", max_length=120)
    notes: str = ""
    points: list[PointIn] = Field(default_factory=list, max_length=200)


class PointOut(ORM):
    id: int
    region: str
    treatment: str
    x: float
    y: float
    amount: Amount
    unit: str


class PlanTotals(BaseModel):
    total_ml: Amount
    total_units: Amount
    areas: int


class PlanOut(BaseModel):
    id: int
    patient_id: int
    photo_id: int | None
    title: str
    notes: str
    created_at: datetime
    updated_at: datetime
    totals: PlanTotals
    points: list[PointOut]


class PlanSummaryOut(BaseModel):
    id: int
    title: str
    photo_id: int | None
    created_at: datetime
    totals: PlanTotals
