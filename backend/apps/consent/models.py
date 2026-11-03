import hashlib

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.patients.models import Patient


class Term(models.Model):
    """Termo de consentimento versionado por procedimento. Uma linha = uma versão.

    Versões já assinadas não são editadas (o admin bloqueia): para mudar o texto, crie
    uma nova versão. O uso de imagem para marketing é um termo próprio (kind=uso_imagem),
    nunca embutido no termo do procedimento."""

    class Kind(models.TextChoices):
        TOXIN = "botox", "Toxina botulínica"
        FILLER = "preenchimento", "Preenchimento"
        BIOSTIMULATOR = "bioestimulador", "Bioestimulador"
        SKINBOOSTER = "skinbooster", "Skinbooster"
        OTHER = "outro", "Outro procedimento"
        IMAGE_USE = "uso_imagem", "Uso de imagem (marketing)"

    kind = models.CharField("procedimento", max_length=20, choices=Kind.choices)
    version = models.PositiveIntegerField("versão", default=1)
    title = models.CharField("título", max_length=150)
    content = models.TextField("texto do termo")
    active = models.BooleanField("ativo", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["kind", "-version"]
        constraints = [models.UniqueConstraint(fields=["kind", "version"], name="uniq_term_version")]

    def __str__(self):
        return f"{self.get_kind_display()} v{self.version}"


class Signature(models.Model):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="signatures")
    term = models.ForeignKey(Term, on_delete=models.PROTECT, related_name="signatures")
    collected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    signer_name = models.CharField(max_length=150)
    # Cópia do termo no momento da assinatura: o hash é calculado sobre ela.
    term_title = models.CharField(max_length=150)
    term_content = models.TextField()
    image = models.BinaryField()  # PNG da assinatura; dado sensível, só sai pela API autenticada
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    signed_at = models.DateTimeField(default=timezone.now)  # UTC
    document_hash = models.CharField(max_length=64)
    revoked_at = models.DateTimeField(null=True, blank=True)  # só faz sentido para uso de imagem

    class Meta:
        ordering = ["-signed_at", "-id"]


def compute_hash(*, term_kind, term_version, term_content, patient_id, signer_name, signed_at, image: bytes) -> str:
    """SHA-256 do conteúdo do termo + assinatura + dados que a vinculam ao ato."""
    parts = [
        term_kind,
        str(term_version),
        term_content,
        str(patient_id),
        signer_name,
        signed_at.isoformat(),
        hashlib.sha256(bytes(image)).hexdigest(),
    ]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
