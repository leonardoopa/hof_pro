import hashlib
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
    """O estado atual, que as telas leem. Cada alteração salva também fica em AnamnesisVersion."""

    patient = models.OneToOneField(Patient, on_delete=models.CASCADE, related_name="anamnesis")
    notes = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def record_version(self, saved_by) -> None:
        """Guarda o estado atual como nova versão. Chamar depois de gravar notas e respostas."""
        last = self.versions.first()
        version = AnamnesisVersion.objects.create(
            anamnesis=self,
            number=last.number + 1 if last else 1,
            notes=self.notes,
            saved_by=saved_by,
            saved_at=self.updated_at,
        )
        AnamnesisVersionAnswer.objects.bulk_create(
            AnamnesisVersionAnswer(
                version=version, question_id=a.question_id, question_text=a.question.text, answer=a.answer, detail=a.detail
            )
            for a in self.answers.select_related("question")
        )


class AnamnesisAnswer(models.Model):
    anamnesis = models.ForeignKey(Anamnesis, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(AnamnesisQuestion, on_delete=models.PROTECT, related_name="answers")
    answer = models.BooleanField()
    detail = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["anamnesis", "question"], name="uniq_answer_per_question")]


class AnamnesisVersion(models.Model):
    """Uma linha por alteração salva. Nada reescreve estas linhas; o sistema só acrescenta."""

    anamnesis = models.ForeignKey(Anamnesis, on_delete=models.PROTECT, related_name="versions")
    number = models.PositiveIntegerField("versão")
    notes = models.TextField(blank=True)
    saved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    saved_at = models.DateTimeField()

    class Meta:
        ordering = ["-number"]
        constraints = [models.UniqueConstraint(fields=["anamnesis", "number"], name="uniq_anamnesis_version")]


class AnamnesisVersionAnswer(models.Model):
    version = models.ForeignKey(AnamnesisVersion, on_delete=models.PROTECT, related_name="answers")
    question = models.ForeignKey(AnamnesisQuestion, on_delete=models.PROTECT, related_name="+")
    # Texto como foi perguntado: a pergunta pode ser reescrita no admin depois.
    question_text = models.CharField(max_length=255)
    answer = models.BooleanField()
    detail = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["question__order", "question_id"]


ANAMNESIS_DECLARATION = (
    "Declaro que as informações desta anamnese são verdadeiras e completas, que não omiti doença, medicamento, "
    "alergia ou procedimento anterior, e que vou avisar sobre qualquer mudança antes de um novo procedimento."
)


class AnamnesisSignature(models.Model):
    """Assinatura do paciente sobre uma versão da anamnese. A versão não muda mais, então a assinatura vale para ela;
    alterar a anamnese cria uma versão nova, ainda sem assinatura."""

    version = models.OneToOneField(AnamnesisVersion, on_delete=models.PROTECT, related_name="signature")
    collected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    signer_name = models.CharField(max_length=150)
    declaration = models.TextField()  # texto exato que o paciente leu ao assinar
    image = models.BinaryField()  # PNG da assinatura; dado sensível, só sai pela API autenticada
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    signed_at = models.DateTimeField()
    document_hash = models.CharField(max_length=64)


def anamnesis_hash(*, version: "AnamnesisVersion", patient_id: int, declaration: str, signer_name: str, signed_at, image: bytes) -> str:
    """SHA-256 das respostas da versão, da declaração e da assinatura: muda se qualquer uma delas mudar."""
    parts = ["anamnese", str(patient_id), str(version.number), declaration, version.notes]
    parts += [f"{a.question_text}|{'Sim' if a.answer else 'Não'}|{a.detail}" for a in version.answers.all()]
    parts += [signer_name, signed_at.isoformat(), hashlib.sha256(bytes(image)).hexdigest()]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


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
