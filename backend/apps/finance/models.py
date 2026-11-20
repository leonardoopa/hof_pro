from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import models

from apps.clinical.models import FacialPlan, Region, Treatment
from apps.patients.models import Patient

# Dinheiro é sempre inteiro em centavos (BRL). A quantidade é decimal (2 casas) porque a dose do plano é (0,5 ml, 2,5 U).


def line_total_cents(quantity: Decimal, unit_price_cents: int) -> int:
    """Quantidade x preço unitário, arredondado para o centavo (meio para cima)."""
    return int((Decimal(quantity) * unit_price_cents).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


class PriceItem(models.Model):
    """Preço do dono por unidade do plano (U para toxina, ml para os demais), por tratamento e região opcional.
    A região vazia vale para qualquer região; havendo preço da região, ele vence. Sai de uso pelo campo `active`."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="price_items")
    name = models.CharField("nome", max_length=120)
    treatment = models.CharField("tratamento", max_length=20, choices=Treatment.choices)
    region = models.CharField("região", max_length=20, choices=Region.choices, null=True, blank=True)
    unit_price_cents = models.PositiveIntegerField("preço unitário (centavos)")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["treatment", "region", "id"]

    def __str__(self):
        return self.name


class Budget(models.Model):
    class Status(models.TextChoices):
        DRAFT = "rascunho", "Rascunho"
        APPROVED = "aprovado", "Aprovado"
        REFUSED = "recusado", "Recusado"
        CANCELED = "cancelado", "Cancelado"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="budgets")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="budgets")
    plan = models.ForeignKey(FacialPlan, on_delete=models.PROTECT, null=True, blank=True, related_name="budgets")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    discount_cents = models.PositiveIntegerField("desconto (centavos)", default=0)
    notes = models.TextField(blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["owner", "status"]), models.Index(fields=["owner", "approved_at"])]

    def active_items(self) -> list["BudgetItem"]:
        return [i for i in self.items.all() if i.active]  # usa o prefetch quando houver

    @property
    def subtotal_cents(self) -> int:
        return sum(i.total_cents for i in self.active_items())

    @property
    def total_cents(self) -> int:
        return max(self.subtotal_cents - self.discount_cents, 0)

    @property
    def paid_cents(self) -> int:
        return sum(p.amount_cents for p in self.payments.all())  # estornos entram negativos

    @property
    def balance_cents(self) -> int:
        return self.total_cents - self.paid_cents


class BudgetItem(models.Model):
    """Linha do orçamento. Tirar uma linha do rascunho a desativa (`active`), não a apaga."""

    budget = models.ForeignKey(Budget, on_delete=models.PROTECT, related_name="items")
    description = models.CharField("descrição", max_length=200)
    quantity = models.DecimalField("quantidade", max_digits=8, decimal_places=2)
    unit = models.CharField("unidade", max_length=8, blank=True, default="")
    unit_price_cents = models.PositiveIntegerField("preço unitário (centavos)")
    position = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["position", "id"]

    @property
    def total_cents(self) -> int:
        return line_total_cents(self.quantity, self.unit_price_cents)


class Payment(models.Model):
    """Lançamento de recebimento. Nunca é editado: o erro se corrige com um estorno, que é um lançamento negativo
    (`reverses` aponta o original; o OneToOne impede dois estornos do mesmo pagamento)."""

    class Method(models.TextChoices):
        PIX = "pix", "Pix"
        CASH = "dinheiro", "Dinheiro"
        DEBIT = "debito", "Débito"
        CREDIT = "credito", "Crédito"
        BOLETO = "boleto", "Boleto"
        OTHER = "outro", "Outro"

    budget = models.ForeignKey(Budget, on_delete=models.PROTECT, related_name="payments")
    amount_cents = models.BigIntegerField("valor (centavos)")  # negativo = estorno
    method = models.CharField(max_length=10, choices=Method.choices)
    paid_at = models.DateTimeField()
    notes = models.CharField(max_length=300, blank=True)  # no estorno, o motivo
    reverses = models.OneToOneField("self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversal")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["paid_at", "id"]
        indexes = [models.Index(fields=["budget", "paid_at"])]
