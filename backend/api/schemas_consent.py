from datetime import datetime

from pydantic import BaseModel, Field


class TermOut(BaseModel):
    id: int
    kind: str
    version: int
    title: str
    content: str


class SignIn(BaseModel):
    term_id: int
    signer_name: str = Field(min_length=2, max_length=150)
    # PNG do canvas, como data URL ("data:image/png;base64,...") ou base64 puro.
    signature: str = Field(min_length=20, max_length=600_000)


class SignatureOut(BaseModel):
    id: int
    term_id: int
    kind: str
    title: str
    version: int
    signer_name: str
    signed_at: datetime
    ip_address: str | None
    document_hash: str
    revoked_at: datetime | None
