from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Orientacao",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "treatment",
                    models.CharField(
                        choices=[
                            ("botox", "Botox"),
                            ("preenchimento", "Preenchimento"),
                            ("bioestimulador", "Bioestimulador"),
                            ("skinbooster", "Skinbooster"),
                            ("outro", "Outro"),
                        ],
                        max_length=20,
                        verbose_name="tratamento",
                    ),
                ),
                ("title", models.CharField(max_length=120, verbose_name="título")),
                (
                    "text",
                    models.TextField(
                        help_text="Uma orientação por linha; cada linha vira um item da lista.", verbose_name="texto"
                    ),
                ),
                ("active", models.BooleanField(default=True, verbose_name="ativa")),
                ("order", models.PositiveSmallIntegerField(default=0, verbose_name="ordem")),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "orientação",
                "verbose_name_plural": "orientações",
                "ordering": ["treatment", "order", "id"],
            },
        ),
    ]
