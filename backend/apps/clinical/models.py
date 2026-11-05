from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.patients.models import Patient, PatientPhoto


class AnamnesisQuestion(models.Model):
    """Pergunta sim/não. Se a resposta for sim, o profissional descreve (detail_prompt)."""

    key = models.SlugField(unique=True)
    text = models.CharField(max_length=255)
    detail_prompt = models.CharField(max_length=120, default="Qual?")
    order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text


class Anamnesis(models.Model):
    patient = models.OneToOneField(Patient, on_delete=models.CASCADE, related_name="anamnesis")
    notes = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class AnamnesisAnswer(models.Model):
    anamnesis = models.ForeignKey(Anamnesis, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(AnamnesisQuestion, on_delete=models.PROTECT, related_name="answers")
    answer = models.BooleanField()
    detail = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["anamnesis", "question"], name="uniq_answer_per_question")]


class Region(models.TextChoices):
    FOREHEAD = "testa", "Testa"
    TEMPLES = "temporas", "Têmporas"
    UNDER_EYE = "olheiras", "Olheiras"
    MALAR = "malar", "Malar"
    NASOLABIAL = "nasolabial", "Nasolabial"
    JAW = "mandibula", "Mandíbula"
    CHIN = "mento", "Mento"
    LIPS = "boca", "Boca"
    GLABELLA = "glabela", "Glabela"
    PERIORBITAL = "periorbital", "Periorbital (pés de galinha)"
    NOSE = "nariz", "Nariz"
    ZYGOMATIC = "zigomatico", "Zigomático"
    SUBMALAR = "submalar", "Submalar"
    GUMMY_SMILE = "gengival", "Sorriso gengival (LLSAN)"
    MARIONETTE = "marionete", "Marionete"
    DAO = "dao", "DAO (depressor do ângulo da boca)"
    PREJOWL = "prejowl", "Pré-jowl"
    MASSETER = "masseter", "Masseter"
    PLATYSMA = "platisma", "Platisma (pescoço)"


class Treatment(models.TextChoices):
    TOXIN = "botox", "Botox"
    FILLER = "preenchimento", "Preenchimento"
    BIOSTIMULATOR = "bioestimulador", "Bioestimulador"
    SKINBOOSTER = "skinbooster", "Skinbooster"
    OTHER = "outro", "Outro"


# Toxina é dosada em unidades; os demais produtos em ml.
UNIT_BY_TREATMENT = {
    Treatment.TOXIN: "U",
    Treatment.FILLER: "ml",
    Treatment.BIOSTIMULATOR: "ml",
    Treatment.SKINBOOSTER: "ml",
    Treatment.OTHER: "ml",
}


class Technique(models.TextChoices):
    BOLUS = "bolus", "Bolus"
    RETROINJECTION = "retroinjecao", "Retroinjeção"
    FAN = "leque", "Leque"
    CANNULA = "canula", "Cânula"
    MICRODROPLETS = "microgotas", "Microgotas"
    PAPULE = "papula", "Pápula"
    OTHER = "outra", "Outra"


class Depth(models.TextChoices):
    INTRADERMAL = "intradermico", "Intradérmico"
    SUBDERMAL = "subdermico", "Subdérmico"
    SUBCUTANEOUS = "subcutaneo", "Subcutâneo"
    SUPRAPERIOSTEAL = "supraperiosteal", "Supraperiosteal"
    INTRAMUSCULAR = "intramuscular", "Intramuscular"


class FacialPlan(models.Model):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="plans")
    photo = models.ForeignKey(PatientPhoto, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    title = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)  # preenchido ao marcar como aplicado (dá baixa no estoque)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def totals(self):
        total_ml = Decimal("0")
        total_units = Decimal("0")
        regions = set()
        for p in self.points.all():
            if p.amount <= 0:
                continue
            regions.add(p.region)
            if p.unit == "U":
                total_units += p.amount
            else:
                total_ml += p.amount
        return {"total_ml": total_ml, "total_units": total_units, "areas": len(regions)}


class PlanPoint(models.Model):
    """Ponto de aplicação. x/y normalizados (0..1) sobre a foto."""

    plan = models.ForeignKey(FacialPlan, on_delete=models.CASCADE, related_name="points")
    region = models.CharField(max_length=20, choices=Region.choices)
    treatment = models.CharField(max_length=20, choices=Treatment.choices, default=Treatment.FILLER)
    x = models.FloatField()
    y = models.FloatField()
    amount = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    unit = models.CharField(max_length=2, default="ml")
    technique = models.CharField(max_length=20, choices=Technique.choices, blank=True, default="")
    depth = models.CharField(max_length=20, choices=Depth.choices, blank=True, default="")
    lot = models.ForeignKey("inventory.Lot", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Nome do ponto no catálogo do modelo; "" = ponto adicionado à mão ou plano salvo antes deste campo.
    point_key = models.CharField(max_length=40, blank=True, default="")
