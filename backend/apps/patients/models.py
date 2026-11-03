import uuid

from django.conf import settings
from django.db import models


class Patient(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="patients")
    full_name = models.CharField("nome completo", max_length=150)
    birth_date = models.DateField("nascimento", null=True, blank=True)
    phone = models.CharField("telefone", max_length=30, blank=True)
    email = models.EmailField("e-mail", blank=True)
    notes = models.TextField("observações", blank=True)
    anonymized_at = models.DateTimeField("anonimizado em", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


def photo_path(instance, filename):
    return f"patients/{instance.patient.owner_id}/{instance.patient_id}/{uuid.uuid4().hex}.jpg"


class PatientPhoto(models.Model):
    class Kind(models.TextChoices):
        FRONTAL = "frontal", "Frontal"
        PROFILE_RIGHT = "perfil_direito", "Perfil direito"
        PROFILE_LEFT = "perfil_esquerdo", "Perfil esquerdo"
        OTHER = "outra", "Outra"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to=photo_path)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.FRONTAL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
