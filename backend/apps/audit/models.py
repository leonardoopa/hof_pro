from django.conf import settings
from django.db import models


class AccessLog(models.Model):
    """Trilha mínima de auditoria (LGPD): quem acessou/alterou dado sensível, quando e de onde.

    Não guarda conteúdo clínico, só a referência (recurso + id). O id é inteiro simples, sem FK,
    para o registro sobreviver à exclusão do recurso.
    """

    class Action(models.TextChoices):
        VIEW = "visualizar", "Visualizar"
        ANONYMIZE = "anonimizar", "Anonimizar"
        REVEAL = "mostrar", "Mostrar dados"
        ARCHIVE = "arquivar", "Arquivar"
        UNARCHIVE = "reativar", "Reativar"
        DELETE = "excluir", "Excluir"  # só em registros antigos: o sistema não apaga mais nada

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="access_logs")
    action = models.CharField(max_length=20, choices=Action.choices)
    resource = models.CharField("recurso", max_length=30)
    resource_id = models.PositiveIntegerField("id do recurso")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
