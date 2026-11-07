from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

STATUSES = ("agendado", "confirmado", "realizado", "cancelado", "faltou")


class AppointmentIn(BaseModel):
    patient_id: int | None = None
    lead_name: str = Field(default="", max_length=150)
    lead_phone: str = Field(default="", max_length=30)
    starts_at: datetime
    ends_at: datetime
    kind: str = Field(default="", max_length=80)
    notes: str = ""

    @model_validator(mode="after")
    def _who(self):
        if self.patient_id is None and not self.lead_name.strip():
            raise ValueError("Informe um paciente ou o nome do novo paciente.")
        return self


class AppointmentPatch(BaseModel):
    patient_id: int | None = None
    lead_name: str | None = Field(default=None, max_length=150)
    lead_phone: str | None = Field(default=None, max_length=30)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    kind: str | None = Field(default=None, max_length=80)
    notes: str | None = None


class StatusIn(BaseModel):
    status: str


class AppointmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int | None
    patient_name: str | None = None
    lead_name: str
    lead_phone: str
    starts_at: datetime
    ends_at: datetime
    kind: str
    status: str
    notes: str
    created_at: datetime
