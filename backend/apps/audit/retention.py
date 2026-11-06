"""Nada do que o sistema registra é apagado.

A API não tem rota DELETE e o admin não oferece exclusão. A guarda daqui cobre o resto: cascata, exclusão
em massa, shell e código futuro. Modelo novo nasce protegido; só fica de fora o que está em NOT_PROTECTED.
"""
from django.apps import apps
from django.contrib import admin
from django.db.models import ProtectedError
from django.db.models.signals import pre_delete

# Catálogos saem de uso pelo campo `active`. Respostas e pontos são regravados ao editar anamnese e rascunho de plano.
NOT_PROTECTED = {
    "clinical.AnamnesisQuestion",
    "clinical.AnamnesisAnswer",
    "clinical.PlanPoint",
    "consent.Term",
    "guidance.Orientacao",
}


def refuse_delete(sender, instance, **kwargs):
    raise ProtectedError(f"{sender._meta.label} não pode ser apagado: o sistema guarda todos os registros.", {instance})


def protect_records() -> None:
    for model in apps.get_models():
        if model.__module__.startswith("apps.") and model._meta.label not in NOT_PROTECTED:
            pre_delete.connect(refuse_delete, sender=model)


class KeepRecordsAdmin(admin.ModelAdmin):
    """Sem permissão de excluir, o admin não mostra o botão nem a ação em massa."""

    def has_delete_permission(self, request, obj=None):
        return False
