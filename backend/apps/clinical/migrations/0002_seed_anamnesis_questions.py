from django.db import migrations

# (key, pergunta, texto do campo "se sim")
QUESTIONS = [
    ("doenca-sistemica", "Possui alguma doença sistêmica (diabetes, hipertensão, cardiopatia, etc.)?", "Qual?"),
    ("medicamentos", "Faz uso contínuo de medicamentos?", "Quais?"),
    ("alergias", "Possui alergias (medicamentos, anestésicos, látex, alimentos)?", "A quê?"),
    ("gestante-lactante", "Está grávida ou amamentando?", "Detalhes"),
    ("autoimune", "Possui doença autoimune?", "Qual?"),
    ("coagulacao", "Tem distúrbio de coagulação ou usa anticoagulante?", "Qual?"),
    ("queloide", "Tem tendência a queloide ou cicatrização alterada?", "Detalhes"),
    ("herpes", "Tem herpes labial recorrente?", "Frequência"),
    ("infeccao-ativa", "Tem infecção ativa ou lesão na região a ser tratada?", "Onde?"),
    ("oncologico", "Faz ou já fez tratamento oncológico?", "Qual e quando?"),
    ("isotretinoina", "Usou isotretinoína nos últimos 6 meses?", "Quando?"),
    ("fumante", "É fumante?", "Quantos por dia?"),
    ("procedimentos-previos", "Já realizou procedimentos estéticos faciais (toxina, preenchimento, fios)?", "Quais e quando?"),
    ("reacao-previa", "Já teve reação adversa a algum procedimento estético?", "Qual?"),
    ("preenchimento-permanente", "Possui preenchimento permanente (PMMA, silicone) na face?", "Onde?"),
]


def seed(apps, schema_editor):
    Question = apps.get_model("clinical", "AnamnesisQuestion")
    for order, (key, text, prompt) in enumerate(QUESTIONS, start=1):
        Question.objects.update_or_create(key=key, defaults={"text": text, "detail_prompt": prompt, "order": order})


def unseed(apps, schema_editor):
    apps.get_model("clinical", "AnamnesisQuestion").objects.filter(key__in=[q[0] for q in QUESTIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("clinical", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
