from django.db import migrations

# Textos-modelo conservadores: sem promessa de resultado. O profissional deve revisar e adaptar
# ao próprio protocolo e ao produto usado (editáveis no admin).
ORIENTACOES = [
    (
        "botox",
        "Após toxina botulínica",
        [
            "Evite deitar e abaixar a cabeça (posição de cabeça baixa) nas primeiras 4 horas.",
            "Não massageie nem pressione as áreas tratadas nas primeiras 24 horas, para reduzir o risco de a toxina se espalhar para outras regiões.",
            "Evite exercícios físicos intensos, calor excessivo (sauna, banho muito quente) e bebidas alcoólicas nas primeiras 24 horas.",
            "Pode haver pequenas manchas roxas, vermelhidão ou inchaço leve no local das picadas; costumam diminuir em poucos dias.",
            "O efeito não é imediato e a resposta varia de pessoa para pessoa. Costuma ser avaliado após cerca de 14 dias, e a duração é variável.",
            "Entre em contato com o profissional caso note assimetria que o incomoda, queda de pálpebra, dificuldade para engolir ou falar, ou qualquer reação que o preocupe.",
        ],
    ),
    (
        "preenchimento",
        "Após preenchimento",
        [
            "Inchaço, vermelhidão, sensibilidade e pequenos hematomas nos primeiros dias são esperados e costumam diminuir com o tempo.",
            "Evite massagear, pressionar ou comprimir a área tratada, a menos que o profissional oriente.",
            "Evite exercícios intensos, calor excessivo (sauna, banho muito quente), exposição solar prolongada e álcool por cerca de 24 a 48 horas.",
            "Evite dormir de bruços sobre a região tratada nas primeiras noites.",
            "Se orientado pelo profissional, compressas frias envoltas em pano limpo, por curtos períodos, podem ajudar no desconforto.",
            "Evite outros procedimentos faciais e tratamentos dentários eletivos nas semanas seguintes, salvo orientação do profissional.",
            "Procure atendimento imediatamente se houver dor intensa ou crescente, palidez ou escurecimento da pele, alteração da visão, ou área muito quente, endurecida ou com secreção.",
        ],
    ),
    (
        "bioestimulador",
        "Após bioestimulador de colágeno",
        [
            "Inchaço, vermelhidão, sensibilidade e hematomas leves são comuns nos primeiros dias.",
            "Siga a orientação do profissional sobre massagem da região: o protocolo (se houver, quando e por quanto tempo) depende do produto utilizado.",
            "Evite exercícios intensos, calor excessivo (sauna, banho muito quente), exposição solar prolongada e álcool por cerca de 48 horas.",
            "Os efeitos se desenvolvem de forma gradual, ao longo de semanas, e variam de pessoa para pessoa. Podem ser necessárias novas sessões, a critério do profissional.",
            "Mantenha o retorno agendado para avaliação.",
            "Procure o profissional se notar nódulos, dor persistente, assimetria que o preocupe, mudança de cor da pele ou sinais de infecção.",
        ],
    ),
    (
        "skinbooster",
        "Após skinbooster",
        [
            "Pequenas elevações (pápulas), vermelhidão, inchaço leve e hematomas nos pontos de aplicação são esperados e costumam diminuir em horas a poucos dias.",
            "Evite tocar, coçar ou massagear a pele nas primeiras horas. Lave o rosto apenas com água e sabonete suave conforme orientação do profissional.",
            "Evite maquiagem por cerca de 12 a 24 horas, ou conforme orientação.",
            "Evite exercícios intensos, calor excessivo (sauna, banho muito quente), exposição solar direta e álcool por cerca de 24 a 48 horas.",
            "Use protetor solar diariamente e mantenha a pele hidratada.",
            "Os resultados e o número de sessões variam de pessoa para pessoa; o profissional definirá o intervalo entre as aplicações.",
            "Procure o profissional se houver dor intensa, calor local, secreção ou piora progressiva da vermelhidão.",
        ],
    ),
]


def seed(apps, schema_editor):
    Orientacao = apps.get_model("guidance", "Orientacao")
    for treatment, title, lines in ORIENTACOES:
        Orientacao.objects.update_or_create(
            treatment=treatment, title=title, defaults={"text": "\n".join(lines), "order": 1, "active": True}
        )


def unseed(apps, schema_editor):
    apps.get_model("guidance", "Orientacao").objects.filter(title__in=[o[1] for o in ORIENTACOES]).delete()


class Migration(migrations.Migration):
    dependencies = [("guidance", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
