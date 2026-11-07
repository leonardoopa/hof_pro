from django.conf import settings
from django.db import models
from django.db.models import F, Q

from apps.patients.models import Patient


class Appointment(models.Model):
    """Agendamento de um profissional. Nunca é apagado: cancelar muda o status.
    Quem ainda não é paciente entra como lead (nome/telefone) até ser convertido."""

    class Status(models.TextChoices):
        SCHEDULED = "agendado", "Agendado"
        CONFIRMED = "confirmado", "Confirmado"
        DONE = "realizado", "Realizado"
        CANCELED = "cancelado", "Cancelado"
        NO_SHOW = "faltou", "Faltou"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="appointments")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, null=True, blank=True, related_name="appointments")
    lead_name = models.CharField("nome (novo paciente)", max_length=150, blank=True)
    lead_phone = models.CharField("telefone (novo paciente)", max_length=30, blank=True)
    starts_at = models.DateTimeField("início")
    ends_at = models.DateTimeField("fim")
    kind = models.CharField("tipo/procedimento", max_length=80, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SCHEDULED)
    notes = models.TextField("observações", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["starts_at", "id"]
        constraints = [models.CheckConstraint(condition=Q(ends_at__gt=F("starts_at")), name="appointment_end_after_start")]
