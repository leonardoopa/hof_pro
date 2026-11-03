from django.db import migrations

RISCOS = (
    "Declaro que fui informado(a), em linguagem clara, sobre o procedimento, seus objetivos, "
    "alternativas, cuidados antes e depois, e possíveis riscos e efeitos adversos, que podem incluir "
    "{riscos}. Os resultados variam de pessoa para pessoa e não há garantia de resultado específico. "
    "Informei corretamente meu histórico de saúde, alergias e medicamentos em uso, e tive a oportunidade de "
    "esclarecer minhas dúvidas. Autorizo a realização do procedimento pelo profissional responsável e "
    "posso revogar este consentimento antes da aplicação."
)

TERMS = [
    ("botox", "Termo de consentimento - Toxina botulínica", RISCOS.format(
        riscos="dor ou hematoma no local, assimetria, queda de pálpebra ou sobrancelha, dor de cabeça e reações alérgicas")),
    ("preenchimento", "Termo de consentimento - Preenchimento", RISCOS.format(
        riscos="edema, hematoma, nódulos, assimetria, infecção e, raramente, oclusão vascular com necrose de tecido ou alteração visual")),
    ("bioestimulador", "Termo de consentimento - Bioestimulador de colágeno", RISCOS.format(
        riscos="edema, hematoma, nódulos palpáveis, assimetria, infecção e reações inflamatórias tardias")),
    ("skinbooster", "Termo de consentimento - Skinbooster", RISCOS.format(
        riscos="pequenos hematomas, pápulas transitórias, edema, infecção e reações alérgicas")),
    ("outro", "Termo de consentimento - Procedimento estético", RISCOS.format(
        riscos="dor, edema, hematoma, assimetria, infecção e reações alérgicas")),
    ("uso_imagem", "Autorização de uso de imagem para divulgação", (
        "Autorizo, de forma livre e específica, o uso das minhas fotografias e imagens do tratamento (antes e depois) "
        "para divulgação em redes sociais, site e materiais de marketing do profissional/clínica. Esta autorização é "
        "independente do consentimento ao procedimento: recusá-la não altera em nada o meu atendimento. "
        "Posso revogá-la a qualquer momento, sem custo, e o material passará a deixar de ser publicado a partir da revogação. "
        "Os dados e imagens são tratados conforme a Lei Geral de Proteção de Dados (LGPD).")),
]
AVISO = "\n\n[Modelo inicial: revise o texto com sua assessoria jurídica e adapte à sua prática antes de usar.]"


def seed(apps, schema_editor):
    Term = apps.get_model("consent", "Term")
    for kind, title, content in TERMS:
        Term.objects.get_or_create(kind=kind, version=1, defaults={"title": title, "content": content + AVISO})


class Migration(migrations.Migration):
    dependencies = [("consent", "0001_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
