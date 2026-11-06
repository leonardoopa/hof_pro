from django.db import migrations, models


def copy_point_keys(apps, schema_editor):
    """Aplicações feitas antes deste campo: copia o nome do ponto enquanto o ponto do plano existir. Repetir não muda nada."""
    Application = apps.get_model("inventory", "Application")
    pending = Application.objects.filter(point_key="", point__isnull=False).exclude(point__point_key="")
    for application in pending.select_related("point").iterator():
        application.point_key = application.point.point_key
        application.save(update_fields=["point_key"])


class Migration(migrations.Migration):
    dependencies = [
        ("clinical", "0006_more_regions_point_key"),
        ("inventory", "0002_lotmovement_application_patient_protect"),
    ]

    operations = [
        migrations.AddField(
            model_name="application",
            name="point_key",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
        # Na volta, a coluna sai e o valor continua em PlanPoint.point_key.
        migrations.RunPython(copy_point_keys, migrations.RunPython.noop),
    ]
