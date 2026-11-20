from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ActionOut(BaseModel):
    name: str
    description: str
    writes: bool
    params_schema: dict[str, Any]


class ProposeIn(BaseModel):
    # Só `params`: o dono vem da sessão. Chaves como `owner`/`user_id` dentro de `params` são descartadas na validação.
    params: dict[str, Any] = Field(default_factory=dict)


class ProposalOut(BaseModel):
    """Escrita: devolve a proposta (`result` nulo, nada foi gravado). Leitura: já executada, com `result`."""

    proposal_id: int
    summary: str
    writes: bool
    expires_at: datetime | None = None
    params: dict[str, Any]
    result: dict[str, Any] | None = None


class ConfirmOut(BaseModel):
    proposal_id: int
    state: str
    result: dict[str, Any]
