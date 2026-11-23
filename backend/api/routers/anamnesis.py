from django.db import IntegrityError, transaction
from django.utils import timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from apps.accounts.models import User
from apps.audit.models import AccessLog
from apps.clinical.models import (
    ANAMNESIS_DECLARATION,
    Anamnesis,
    AnamnesisAnswer,
    AnamnesisQuestion,
    AnamnesisSignature,
    AnamnesisVersion,
    anamnesis_hash,
)

from ..audit import client_ip, log_access
from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..schemas import (
    AnamnesisIn,
    AnamnesisOut,
    AnamnesisSignatureOut,
    AnamnesisSignIn,
    AnamnesisVersionOut,
    AnswerOut,
    QuestionOut,
    VersionAnswerOut,
)
from .consent import _decode_signature

router = APIRouter(tags=["anamnese"])


@router.get("/anamnesis/questions", response_model=list[QuestionOut])
@orm
def list_questions(user: User = Depends(current_user)):
    return list(AnamnesisQuestion.objects.filter(active=True))


def _signature_out(version: AnamnesisVersion) -> AnamnesisSignatureOut | None:
    sig = AnamnesisSignature.objects.filter(version=version).first()
    if sig is None:
        return None
    return AnamnesisSignatureOut(
        id=sig.id, version=version.number, signer_name=sig.signer_name, signed_at=sig.signed_at, document_hash=sig.document_hash
    )


def _out(anamnesis: Anamnesis | None) -> AnamnesisOut:
    if anamnesis is None:
        return AnamnesisOut(answers=[], notes="", updated_at=None, version=None, declaration=ANAMNESIS_DECLARATION)
    latest = anamnesis.versions.first()
    return AnamnesisOut(
        # Só o que o formulário mostra e devolve ao salvar. As demais respostas aparecem nas versões.
        answers=[AnswerOut.model_validate(a) for a in anamnesis.answers.filter(question__active=True)],
        notes=anamnesis.notes,
        updated_at=anamnesis.updated_at,
        version=latest.number if latest else None,
        signature=_signature_out(latest) if latest else None,
        declaration=ANAMNESIS_DECLARATION,
    )


@router.get("/patients/{patient_id}/anamnesis", response_model=AnamnesisOut)
@orm
def get_anamnesis(patient_id: int, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    return _out(Anamnesis.objects.filter(patient=patient).first())


@router.put("/patients/{patient_id}/anamnesis", response_model=AnamnesisOut)
@orm
def save_anamnesis(patient_id: int, data: AnamnesisIn, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    questions = {q.id: q for q in AnamnesisQuestion.objects.filter(active=True)}

    seen, missing_detail = set(), []
    for a in data.answers:
        question = questions.get(a.question_id)
        if question is None or a.question_id in seen:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Pergunta inválida ou repetida: {a.question_id}.")
        seen.add(a.question_id)
        if a.answer and not a.detail.strip():
            missing_detail.append(question.text)
    if missing_detail:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            [f"Descreva a resposta: {text}" for text in missing_detail],
        )

    answers = {a.question_id: (a.answer, a.detail.strip() if a.answer else "") for a in data.answers}
    with transaction.atomic():
        anamnesis, created = Anamnesis.objects.get_or_create(patient=patient)
        current = {a.question_id: (a.answer, a.detail) for a in anamnesis.answers.all()}
        # Pergunta desativada sai do formulário, mas a resposta já dada continua valendo.
        answers |= {question_id: value for question_id, value in current.items() if question_id not in questions}
        if created or data.notes != anamnesis.notes or answers != current:
            anamnesis.notes = data.notes
            anamnesis.save()  # o UPDATE trava a linha: dois salvamentos ao mesmo tempo não pegam o mesmo número de versão
            anamnesis.answers.all().delete()
            AnamnesisAnswer.objects.bulk_create(
                AnamnesisAnswer(anamnesis=anamnesis, question_id=question_id, answer=answer, detail=detail)
                for question_id, (answer, detail) in answers.items()
            )
            anamnesis.record_version(user)
    return _out(anamnesis)


@router.get("/patients/{patient_id}/anamnesis/versions", response_model=list[AnamnesisVersionOut])
@orm
def list_versions(patient_id: int, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    versions = AnamnesisVersion.objects.filter(anamnesis__patient=patient).select_related("saved_by").prefetch_related("answers")
    return [
        AnamnesisVersionOut(
            number=v.number,
            notes=v.notes,
            saved_by=str(v.saved_by),
            saved_at=v.saved_at,
            answers=[VersionAnswerOut.model_validate(a) for a in v.answers.all()],
            signature=_signature_out(v),
        )
        for v in versions
    ]


@router.post("/patients/{patient_id}/anamnesis/signature", response_model=AnamnesisOut, status_code=status.HTTP_201_CREATED)
@orm
def sign_anamnesis(patient_id: int, data: AnamnesisSignIn, request: Request, user: User = Depends(current_user)):
    """O paciente assina a versão atual da anamnese. Uma assinatura por versão; alterar a anamnese pede assinatura nova."""
    patient = get_patient_or_404(user, patient_id)
    anamnesis = Anamnesis.objects.filter(patient=patient).first()
    version = anamnesis.versions.first() if anamnesis else None
    if version is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Salve a anamnese antes de colher a assinatura.")
    if AnamnesisSignature.objects.filter(version=version).exists():
        raise HTTPException(status.HTTP_409_CONFLICT, f"A versão {version.number} da anamnese já está assinada.")
    image = _decode_signature(data.signature)
    name = data.signer_name.strip()
    signed_at = timezone.now().replace(microsecond=0)
    try:
        with transaction.atomic():
            sig = AnamnesisSignature.objects.create(
                version=version, collected_by=user, signer_name=name, declaration=ANAMNESIS_DECLARATION, image=image,
                ip_address=client_ip(request), signed_at=signed_at,
                document_hash=anamnesis_hash(
                    version=version, patient_id=patient.id, declaration=ANAMNESIS_DECLARATION, signer_name=name,
                    signed_at=signed_at, image=image,
                ),
            )
            log_access(user, AccessLog.Action.CREATE, "assinatura_anamnese", sig.id, request)
    except IntegrityError:  # duas assinaturas ao mesmo tempo para a mesma versão: a segunda perde
        raise HTTPException(status.HTTP_409_CONFLICT, f"A versão {version.number} da anamnese já está assinada.")
    return _out(anamnesis)


@router.get("/anamnesis-signatures/{signature_id}/image")
@orm
def signature_image(signature_id: int, user: User = Depends(current_user)):
    sig = AnamnesisSignature.objects.filter(pk=signature_id, version__anamnesis__patient__owner=user).first()
    if sig is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assinatura não encontrada.")
    return Response(bytes(sig.image), media_type="image/png", headers={"Cache-Control": "private, no-store"})
