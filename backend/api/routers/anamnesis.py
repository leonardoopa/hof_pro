from django.db import transaction
from fastapi import APIRouter, Depends, HTTPException, status

from apps.accounts.models import User
from apps.clinical.models import Anamnesis, AnamnesisAnswer, AnamnesisQuestion

from ..deps import current_user, get_patient_or_404
from ..orm import orm
from ..schemas import AnamnesisIn, AnamnesisOut, AnswerOut, QuestionOut

router = APIRouter(tags=["anamnese"])


@router.get("/anamnesis/questions", response_model=list[QuestionOut])
@orm
def list_questions(user: User = Depends(current_user)):
    return list(AnamnesisQuestion.objects.filter(active=True))


def _out(anamnesis: Anamnesis | None) -> AnamnesisOut:
    if anamnesis is None:
        return AnamnesisOut(answers=[], notes="", updated_at=None)
    return AnamnesisOut(
        answers=[AnswerOut.model_validate(a) for a in anamnesis.answers.all()],
        notes=anamnesis.notes,
        updated_at=anamnesis.updated_at,
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

    with transaction.atomic():
        anamnesis, _ = Anamnesis.objects.get_or_create(patient=patient)
        anamnesis.notes = data.notes
        anamnesis.save()
        anamnesis.answers.all().delete()
        AnamnesisAnswer.objects.bulk_create(
            AnamnesisAnswer(
                anamnesis=anamnesis,
                question_id=a.question_id,
                answer=a.answer,
                detail=a.detail.strip() if a.answer else "",
            )
            for a in data.answers
        )
    return _out(anamnesis)
