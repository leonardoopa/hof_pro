from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.clinical.models import FacialPlan, PlanPoint
from apps.patients.models import Patient


class Product(models.Model):
    """Produto do estoque de um profissional (cada usuário só enxerga os seus)."""

    class Kind(models.TextChoices):
        TOXIN = "toxina", "Toxina"
        FILLER = "preenchedor", "Preenchedor"
        BIOSTIMULATOR = "bioestimulador", "Bioestimulador"
        SKINBOOSTER = "skinbooster", "Skinbooster"
        OTHER = "outro", "Outro"

    class Unit(models.TextChoices):
        ML = "ml", "ml"
        UNITS = "U", "U"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="products")
    brand = models.CharField("marca", max_length=80)
    name = models.CharField("nome", max_length=120)
    kind = models.CharField("tipo", max_length=20, choices=Kind.choices, default=Kind.FILLER)
    unit = models.CharField("unidade", max_length=2, choices=Unit.choices, default=Unit.ML)
    anvisa_registration = models.CharField("registro Anvisa", max_length=40, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["brand", "name"]

    def __str__(self):
        return f"{self.brand} {self.name}"


class Lot(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="lots")
    number = models.CharField("lote", max_length=40)
    expires_on = models.DateField("validade")
    initial_quantity = models.DecimalField(max_digits=8, decimal_places=2)
    balance = models.DecimalField("saldo", max_digits=8, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["expires_on", "id"]
        constraints = [
            models.UniqueConstraint(fields=["product", "number"], name="uniq_lot_per_product"),
            models.CheckConstraint(condition=Q(balance__gte=0), name="lot_balance_not_negative"),
        ]

    def __str__(self):
        return f"{self.product} · lote {self.number}"


class Application(models.Model):
    """Baixa de estoque: uma linha por ponto aplicado. Guarda cópia dos dados clínicos
    para a rastreabilidade não depender do plano."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="applications")
    plan = models.ForeignKey(FacialPlan, on_delete=models.SET_NULL, null=True, blank=True, related_name="applications")
    point = models.ForeignKey(PlanPoint, on_delete=models.SET_NULL, null=True, blank=True, related_name="applications")
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name="applications")
    applied_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=6, decimal_places=2)
    unit = models.CharField(max_length=2)
    region = models.CharField(max_length=20)
    point_key = models.CharField(max_length=40, blank=True, default="")  # "" = ponto adicionado à mão ou plano antigo
    treatment = models.CharField(max_length=20)
    technique = models.CharField(max_length=20, blank=True)
    depth = models.CharField(max_length=20, blank=True)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-applied_at", "-id"]


class LotMovement(models.Model):
    """Histórico de movimentação do saldo de um lote (entrada, ajuste manual, baixa por aplicação)."""

    class Kind(models.TextChoices):
        ENTRY = "entrada", "Entrada"
        ADJUSTMENT = "ajuste", "Ajuste"
        WRITE_OFF = "baixa", "Baixa"

    lot = models.ForeignKey(Lot, on_delete=models.CASCADE, related_name="movements")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    delta = models.DecimalField(max_digits=9, decimal_places=2)  # negativo na baixa/ajuste para menos
    balance_after = models.DecimalField("saldo após", max_digits=8, decimal_places=2)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reason = models.CharField("motivo", max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
