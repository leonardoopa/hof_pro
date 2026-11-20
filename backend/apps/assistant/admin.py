from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import AssistantProposal


@admin.register(AssistantProposal)
class AssistantProposalAdmin(KeepRecordsAdmin):
    """Trilha do assistente: só leitura. Não lista o resumo na tabela para não espalhar nome de paciente."""

    list_display = ("created_at", "owner", "action", "writes", "state")
    list_filter = ("action", "state", "writes")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
