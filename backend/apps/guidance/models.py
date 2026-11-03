from django.db import models


class Orientacao(models.Model):
    """Orientação pós-procedimento por tipo de tratamento. O texto é um modelo editável no admin:
    cada profissional deve revisá-lo conforme o seu protocolo e o produto utilizado."""

    # Mesmos valores de clinical.Treatment (sem acoplar o app: o campo é só um texto).
    class Treatment(models.TextChoices):
        TOXIN = "botox", "Botox"
        FILLER = "preenchimento", "Preenchimento"
        BIOSTIMULATOR = "bioestimulador", "Bioestimulador"
        SKINBOOSTER = "skinbooster", "Skinbooster"
        OTHER = "outro", "Outro"

    treatment = models.CharField("tratamento", max_length=20, choices=Treatment.choices)
    title = models.CharField("título", max_length=120)
    text = models.TextField("texto", help_text="Uma orientação por linha; cada linha vira um item da lista.")
    active = models.BooleanField("ativa", default=True)
    order = models.PositiveSmallIntegerField("ordem", default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["treatment", "order", "id"]
        verbose_name = "orientação"
        verbose_name_plural = "orientações"

    def __str__(self):
        return f"{self.get_treatment_display()} - {self.title}"
