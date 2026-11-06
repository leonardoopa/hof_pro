from django.db import transaction
from fastapi import APIRouter, Depends, HTTPException, status

from apps.accounts.models import User
from apps.clinical.models import Anamnesis, AnamnesisAnswer, AnamnesisQuestion, AnamnesisVersion

from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..schemas import AnamnesisIn, AnamnesisOut, AnamnesisVersionOut, AnswerOut, QuestionOut, VersionAnswerOut

router = APIRouter(tags=["anamnese"])


@router.get("/anamnesis/questions", response_model=list[QuestionOut])
@orm
def list_questions(user: User = Depends(current_user)):
    return list(AnamnesisQuestion.objects.filter(active=True))


def _out(anamnesis: Anamnesis | None) -> AnamnesisOut:
    if anamnesis is None:
        return AnamnesisOut(answers=[], notes="", updated_at=None, version=None)
    return AnamnesisOut(
        answers=[AnswerOut.model_validate(a) for a in anamnesis.answers.all()],
        notes=anamnesis.notes,
        updated_at=anamnesis.updated_at,
        version=anamnesis.versions.values_list("number", flat=True).first(),
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
        )
        for v in versions
    ]
