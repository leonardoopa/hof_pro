"""Registro das ações que o assistente pode chamar.

Cada ação tem parâmetros tipados (modelo Pydantic), uma função `run` que executa e uma `summarize` que descreve em
português o que vai acontecer. Quem decide se uma ação escreve é `writes`: escrita só roda depois de proposta e
confirmação (ver `api/routers/assistant.py`). O dono (`user`) vem sempre da sessão, nunca dos parâmetros.
"""
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel

from apps.accounts.models import User


@dataclass(frozen=True)
class Action:
    name: str
    description: str
    writes: bool
    params_model: type[BaseModel]
    run: Callable[[User, Any], dict]  # (user, params) -> resultado JSON; levanta HTTPException em erro de negócio
    summarize: Callable[[User, Any], str]  # (user, params) -> resumo; 404 se o dado não é do usuário
    # Para escritas: do resultado tira (ação de auditoria, recurso, id) e grava também na trilha do recurso alterado.
    audit_ref: Callable[[dict], tuple[str, str, int]] | None = None


_ACTIONS: dict[str, Action] = {}


def register(action: Action) -> Action:
    if action.name in _ACTIONS:
        raise ValueError(f"Ação duplicada: {action.name}")
    _ACTIONS[action.name] = action
    return action


def get(name: str) -> Action | None:
    return _ACTIONS.get(name)


def catalog() -> list[dict]:
    """Lista para o assistente saber o que existe: nome, descrição, se escreve e o JSON Schema dos parâmetros."""
    return [
        {"name": a.name, "description": a.description, "writes": a.writes, "params_schema": a.params_model.model_json_schema()}
        for a in _ACTIONS.values()
    ]
