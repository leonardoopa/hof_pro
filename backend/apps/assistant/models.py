from django.conf import settings
from django.db import models
from django.utils import timezone


class AssistantProposal(models.Model):
    """Uma chamada de ação do assistente. Toda escrita nasce como proposta (`pendente`) e só vira efeito quando
    o profissional a confirma; a leitura é executada na hora e fica registrada como `executada`, sem resultado.
    Nada é apagado: vencer ou falhar muda o estado."""

    class State(models.TextChoices):
        PENDING = "pendente", "Pendente"
        EXECUTED = "executada", "Executada"
        FAILED = "falhou", "Falhou"
        EXPIRED = "vencida", "Vencida"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assistant_proposals")
    action = models.CharField("ação", max_length=60)
    params = models.JSONField("parâmetros", default=dict)
    summary = models.TextField("resumo", blank=True)
    writes = models.BooleanField("escreve", default=False)
    state = models.CharField("estado", max_length=12, choices=State.choices, default=State.PENDING)
    # Só ações de escrita guardam o resultado (para a 2ª confirmação devolver o mesmo); ele traz ids e horários, nunca nomes.
    result = models.JSONField("resultado", null=True, blank=True)
    error_status = models.PositiveSmallIntegerField("código do erro", null=True, blank=True)
    error_detail = models.CharField("erro", max_length=255, blank=True)
    expires_at = models.DateTimeField("vence em", null=True, blank=True)
    confirmed_at = models.DateTimeField("confirmada em", null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["owner", "-created_at"], name="assistant_owner_created_idx")]

    def __str__(self):
        return f"{self.action} #{self.pk} ({self.state})"
