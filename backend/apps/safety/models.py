from django.conf import settings
from django.db import models

from apps.inventory.models import Application, Lot
from apps.patients.models import Patient


class AdverseEvent(models.Model):
    """Intercorrência (evento adverso) depois de um procedimento.

    Liga o evento ao ponto aplicado e ao lote usado, quando houver, para a rastreabilidade e para a notificação à
    Anvisa (Notivisa), que é feita pela profissional fora do sistema: aqui só se registra a data e o número.
    """

    class Kind(models.TextChoices):
        VASCULAR_OCCLUSION = "oclusao_vascular", "Suspeita de oclusão vascular"
        NODULE = "nodulo", "Nódulo / granuloma"
        EDEMA = "edema", "Edema persistente"
        BRUISE = "hematoma", "Hematoma"
        PTOSIS = "ptose", "Ptose"
        INFECTION = "infeccao", "Infecção"
        ALLERGY = "alergia", "Reação alérgica"
        ASYMMETRY = "assimetria", "Assimetria"
        OTHER = "outro", "Outro"

    class Severity(models.TextChoices):
        MILD = "leve", "Leve"
        MODERATE = "moderada", "Moderada"
        SEVERE = "grave", "Grave"

    class Outcome(models.TextChoices):
        FOLLOW_UP = "acompanhamento", "Em acompanhamento"
        RESOLVED = "resolvido", "Resolvido"
        SEQUELA = "sequela", "Resolvido com sequela"

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="adverse_events")
    application = models.ForeignKey(Application, on_delete=models.PROTECT, null=True, blank=True, related_name="adverse_events")
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, null=True, blank=True, related_name="adverse_events")
    region = models.CharField(max_length=20, blank=True)
    point_key = models.CharField(max_length=40, blank=True)
    kind = models.CharField("tipo", max_length=20, choices=Kind.choices)
    severity = models.CharField("gravidade", max_length=10, choices=Severity.choices)
    onset_at = models.DateTimeField("início")
    signs = models.JSONField("sinais observados", default=list, blank=True)
    description = models.TextField("descrição", blank=True)
    conduct = models.TextField("conduta", blank=True)
    # Hialuronidase usada no atendimento: a baixa sai do lote informado, como qualquer aplicação.
    hyaluronidase_lot = models.ForeignKey(Lot, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    hyaluronidase_amount = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    protocol_started_at = models.DateTimeField("protocolo iniciado em", null=True, blank=True)
    outcome = models.CharField("desfecho", max_length=20, choices=Outcome.choices, default=Outcome.FOLLOW_UP)
    anvisa_notified_on = models.DateField("notificado à Anvisa em", null=True, blank=True)
    anvisa_protocol = models.CharField("nº da notificação", max_length=60, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-onset_at", "-id"]
