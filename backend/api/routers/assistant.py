"""Base do assistente: catálogo de ações e fluxo propor -> confirmar. Sem LLM e sem tela.

Leitura executa na hora. Escrita só vira proposta (nada é gravado); `confirm` executa uma única vez, dentro de 10 minutos,
e a segunda chamada devolve o mesmo resultado. O dono é sempre o usuário da sessão.
"""
import json
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError

from apps.accounts.models import User
from apps.assistant import actions as _actions  # noqa: F401  (registra as ações)
from apps.assistant import registry
from apps.assistant.models import AssistantProposal
from apps.audit.models import AccessLog

from ..audit import log_access
from ..deps import current_user
from ..orm import orm
from ..schemas_assistant import ActionOut, ConfirmOut, ProposalOut, ProposeIn

router = APIRouter(prefix="/assistant", tags=["assistant"])

PROPOSAL_TTL = timedelta(minutes=10)
RESOURCE = "assistente"
State = AssistantProposal.State


def clock() -> datetime:
    """Relógio da API; os testes o trocam por `app.dependency_overrides[clock]`."""
    return timezone.now()


def _invalid_params(exc: ValidationError) -> HTTPException:
    detail = json.loads(exc.json(include_url=False, include_context=False, include_input=False))
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


@router.get("/actions", response_model=list[ActionOut])
async def list_actions(user: User = Depends(current_user)):
    return registry.catalog()


@router.post("/actions/{name}/propose", response_model=ProposalOut)
@orm
def propose(name: str, data: ProposeIn, request: Request, user: User = Depends(current_user), now: datetime = Depends(clock)):
    action = registry.get(name)
    if action is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ação não encontrada.")
    try:
        params = action.params_model.model_validate(data.params)
    except ValidationError as exc:
        raise _invalid_params(exc)
    clean = params.model_dump(mode="json")  # o que foi validado: chaves ignoradas (owner, user_id...) não ficam guardadas

    summary = action.summarize(user, params)  # com nome, só para mostrar agora
    stored_summary = f"Proposta: {action.name}"  # o banco guarda sem nome: o paciente pode ter os dados ocultados depois
    with transaction.atomic():
        if action.writes:
            row = AssistantProposal.objects.create(
                owner=user, action=action.name, params=clean, summary=stored_summary, writes=True,
                state=State.PENDING, expires_at=now + PROPOSAL_TTL, created_at=now,
            )
            log_access(user, AccessLog.Action.CREATE, RESOURCE, row.id, request)
            return ProposalOut(proposal_id=row.id, summary=summary, writes=True, expires_at=row.expires_at, params=clean)

        result = action.run(user, params)
        row = AssistantProposal.objects.create(
            owner=user, action=action.name, params={}, summary=stored_summary, writes=False,  # leitura: o texto buscado não fica guardado
            state=State.EXECUTED, confirmed_at=now, created_at=now,  # o resultado de leitura não é guardado (traz dados de paciente)
        )
        log_access(user, AccessLog.Action.VIEW, RESOURCE, row.id, request)
        return ProposalOut(proposal_id=row.id, summary=summary, writes=False, params=clean, result=result)


@router.post("/proposals/{proposal_id}/confirm", response_model=ConfirmOut)
@orm
def confirm(proposal_id: int, request: Request, user: User = Depends(current_user), now: datetime = Depends(clock)):
    failure: HTTPException | None = None  # levantada só depois do commit: dentro do bloco desfaria o estado gravado
    with transaction.atomic():
        row = AssistantProposal.objects.select_for_update().filter(pk=proposal_id, owner=user).first()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposta não encontrada.")
        if not row.writes:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esta ação é de leitura e já foi executada: não há o que confirmar.")
        if row.state == State.EXECUTED:
            return ConfirmOut(proposal_id=row.id, state=row.state, result=row.result or {})

        action = registry.get(row.action)
        if row.state == State.FAILED:
            failure = HTTPException(row.error_status or status.HTTP_409_CONFLICT, row.error_detail)
        elif row.state == State.EXPIRED or now > row.expires_at:
            if row.state == State.PENDING:
                row.state = State.EXPIRED
                row.save(update_fields=["state"])
                log_access(user, AccessLog.Action.UPDATE, RESOURCE, row.id, request)
            failure = HTTPException(status.HTTP_410_GONE, "Proposta vencida: peça a ação de novo para confirmar.")
        elif action is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Ação não encontrada.")
        else:
            try:
                with transaction.atomic():  # ponto de salvamento: erro de negócio desfaz só o efeito da ação
                    result = action.run(user, action.params_model.model_validate(row.params))
            except ValidationError as exc:
                failure = _invalid_params(exc)
            except HTTPException as exc:
                failure = exc
            if failure is None:
                row.state, row.result, row.confirmed_at = State.EXECUTED, result, now
                row.save(update_fields=["state", "result", "confirmed_at"])
                if action.audit_ref:
                    log_action, resource, resource_id = action.audit_ref(result)
                    log_access(user, log_action, resource, resource_id, request)
            else:
                row.state, row.error_status = State.FAILED, failure.status_code
                row.error_detail = failure.detail if isinstance(failure.detail, str) else json.dumps(failure.detail, ensure_ascii=False)[:255]
                row.confirmed_at = now
                row.save(update_fields=["state", "error_status", "error_detail", "confirmed_at"])
            log_access(user, AccessLog.Action.UPDATE, RESOURCE, row.id, request)
    if failure is not None:
        raise failure
    return ConfirmOut(proposal_id=row.id, state=row.state, result=row.result)
