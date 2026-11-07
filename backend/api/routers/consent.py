import base64
import binascii
import io
from datetime import timezone as dt_timezone

from django.db.models import Max
from django.utils import timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse
from PIL import Image

from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.consent.models import Signature, Term, compute_hash
from apps.patients.models import Patient

from ..audit import log_access
from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..printing import esc, page
from ..schemas_consent import SignatureOut, SignIn, TermOut

router = APIRouter(tags=["consentimento"])

MAX_SIGNATURE_BYTES = 400_000
MAX_SIGNATURE_SIDE = 2000


def _decode_signature(raw: str) -> bytes:
    """Aceita data URL ou base64 puro; confere que é mesmo um PNG de tamanho razoável."""
    payload = raw.split(",", 1)[1] if raw.startswith("data:") else raw
    try:
        data = base64.b64decode(payload, validate=True)
        if len(data) > MAX_SIGNATURE_BYTES:
            raise ValueError("grande")
        img = Image.open(io.BytesIO(data))
        img.verify()
        if img.format != "PNG" or max(img.size) > MAX_SIGNATURE_SIDE:
            raise ValueError("formato")
    except (binascii.Error, ValueError, OSError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Assinatura inválida: envie um PNG gerado pelo campo de assinatura.")
    return data


def _sig_out(s: Signature) -> SignatureOut:
    return SignatureOut(
        id=s.id, term_id=s.term_id, kind=s.term.kind, title=s.term_title, version=s.term.version,
        signer_name=s.signer_name, signed_at=s.signed_at, ip_address=s.ip_address,
        document_hash=s.document_hash, revoked_at=s.revoked_at,
    )


def _own_signature(user: User, signature_id: int) -> Signature:
    sig = Signature.objects.filter(pk=signature_id, patient__owner=user).select_related("term", "patient").first()
    if sig is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assinatura não encontrada.")
    return sig


def _latest_terms() -> list[Term]:
    latest = Term.objects.filter(active=True).values("kind").annotate(v=Max("version"))
    terms = [Term.objects.get(kind=row["kind"], version=row["v"]) for row in latest]
    return sorted(terms, key=lambda t: (t.kind == Term.Kind.IMAGE_USE, t.kind))


def planned_kinds(patient: Patient) -> set[str]:
    """Tratamentos com quantidade no plano mais recente. O paciente só assina o termo do que foi planejado:
    assinar por um procedimento que não vai fazer não faz sentido."""
    plan = patient.plans.order_by("-created_at", "-id").first()
    if plan is None:
        return set()
    return set(plan.points.filter(amount__gt=0).values_list("treatment", flat=True))


@router.get("/consent/terms", response_model=list[TermOut])
@orm
def list_terms(user: User = Depends(current_user)):
    """Versão ativa mais recente de cada termo."""
    return _latest_terms()


@router.get("/patients/{patient_id}/consents/terms", response_model=list[TermOut])
@orm
def patient_terms(patient_id: int, user: User = Depends(current_user)):
    """Termos que este paciente pode assinar: os dos tratamentos do plano mais recente e o de uso de imagem."""
    kinds = planned_kinds(get_patient_or_404(user, patient_id)) | {Term.Kind.IMAGE_USE}
    return [t for t in _latest_terms() if t.kind in kinds]


@router.get("/patients/{patient_id}/consents", response_model=list[SignatureOut])
@orm
def list_signatures(patient_id: int, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    return [_sig_out(s) for s in patient.signatures.select_related("term")]


@router.post("/patients/{patient_id}/consents", response_model=SignatureOut, status_code=status.HTTP_201_CREATED)
@orm
def sign(patient_id: int, data: SignIn, request: Request, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    term = Term.objects.filter(pk=data.term_id, active=True).first()
    if term is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Termo não encontrado ou desativado.")
    if term.kind != Term.Kind.IMAGE_USE and term.kind not in planned_kinds(patient):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Este procedimento não está no plano do paciente: inclua-o no planejamento antes de colher a assinatura.",
        )
    image = _decode_signature(data.signature)
    signed_at = timezone.now().replace(microsecond=0)
    name = data.signer_name.strip()
    sig = Signature.objects.create(
        patient=patient,
        term=term,
        collected_by=user,
        signer_name=name,
        term_title=term.title,
        term_content=term.content,
        image=image,
        ip_address=request.client.host if request.client else None,
        signed_at=signed_at,
        document_hash=compute_hash(
            term_kind=term.kind, term_version=term.version, term_content=term.content,
            patient_id=patient.id, signer_name=name, signed_at=signed_at, image=image,
        ),
    )
    return _sig_out(sig)


@router.post("/consents/{signature_id}/revoke", response_model=SignatureOut)
@orm
def revoke(signature_id: int, user: User = Depends(current_user)):
    sig = _own_signature(user, signature_id)
    if sig.term.kind != Term.Kind.IMAGE_USE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Só a autorização de uso de imagem pode ser revogada por aqui.")
    if sig.revoked_at is None:
        sig.revoked_at = timezone.now()
        sig.save(update_fields=["revoked_at"])
    return _sig_out(sig)


@router.get("/consents/{signature_id}/signature")
@orm
def signature_image(signature_id: int, request: Request, user: User = Depends(current_user)):
    sig = _own_signature(user, signature_id)
    log_access(user, AccessLog.Action.VIEW, "assinatura", sig.id, request)
    return Response(bytes(sig.image), media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.get("/consents/{signature_id}/document", response_class=HTMLResponse)
@orm
def document(signature_id: int, request: Request, user: User = Depends(current_user)):
    sig = _own_signature(user, signature_id)
    log_access(user, AccessLog.Action.VIEW, "prontuario", sig.id, request)
    expected = compute_hash(
        term_kind=sig.term.kind, term_version=sig.term.version, term_content=sig.term_content,
        patient_id=sig.patient_id, signer_name=sig.signer_name, signed_at=sig.signed_at, image=sig.image,
    )
    intact = expected == sig.document_hash
    img = base64.b64encode(bytes(sig.image)).decode()
    local = timezone.localtime(sig.signed_at).strftime("%d/%m/%Y %H:%M")
    utc = sig.signed_at.astimezone(dt_timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    revoked = (
        f"<p><strong>Autorização revogada em {esc(timezone.localtime(sig.revoked_at).strftime('%d/%m/%Y %H:%M'))}.</strong></p>"
        if sig.revoked_at else ""
    )
    body = (
        f"<h1>{esc(sig.term_title)}</h1>"
        f'<p class="meta">Versão {sig.term.version} · Paciente: {esc(sig.patient.full_name)}</p>'
        f'<div class="term">{esc(sig.term_content)}</div>{revoked}'
        f'<h2>Assinatura</h2><div class="sig"><img alt="Assinatura" src="data:image/png;base64,{img}"></div>'
        f"<p>{esc(sig.signer_name)}<br>Assinado em {esc(local)} (horário de Brasília) · {esc(utc)}"
        f"<br>IP: {esc(sig.ip_address or 'não registrado')}</p>"
        f'<h2>Integridade (SHA-256)</h2><div class="hash">{esc(sig.document_hash)}</div>'
        f'<p class="meta">{"Hash conferido: o conteúdo do registro confere com o hash gravado na assinatura." if intact else "ATENÇÃO: o conteúdo do registro NÃO confere com o hash gravado."}'
        " O hash cobre o texto do termo, a versão, o nome do assinante, o paciente, a data/hora e a imagem da assinatura.</p>"
    )
    return HTMLResponse(page(f"{sig.term_title} - {sig.patient.full_name}", body), headers={"Cache-Control": "no-store"})
