"""Fila de retornos (reaplicação). Regra única, usada pela rota /api/returns e pelo assistente.

O intervalo é um lembrete de atendimento, não recomendação clínica: o profissional pode ajustá-lo por produto
(`Product.return_interval_days`). Sem ajuste, vale o padrão do tipo de produto abaixo; tipo "outro" não lembra.
"""

from datetime import date, datetime, time, timedelta

from django.utils import timezone

from apps.accounts.models import User
from apps.inventory.models import Application
from apps.patients.models import Patient
from apps.scheduling.models import Appointment

# Dias entre uma aplicação e o retorno, por tipo de produto. Tipo fora daqui (ex.: "outro") só lembra
# se o produto tiver intervalo próprio.
DEFAULT_INTERVALS = {"toxina": 120, "bioestimulador": 180, "preenchedor": 365, "skinbooster": 90}

HIDDEN_NAME = "Dados ocultos"

# Complemento de "última aplicação ..." na mensagem.
_KIND_PHRASE = {
    "toxina": " de toxina botulínica",
    "bioestimulador": " de bioestimulador de colágeno",
    "preenchedor": " de preenchedor",
    "skinbooster": " de skinbooster",
}


def build_message(first_name: str | None, kind: str, last_applied_on: date) -> str:
    """Texto neutro de lembrete, sem promoção. `first_name` vazio (dados ocultos) vira saudação sem nome."""
    greeting = f"Olá, {first_name}!" if first_name else "Olá!"
    phrase = _KIND_PHRASE.get(kind, "")
    return (
        f"{greeting} Tudo bem? Já faz um tempo desde a sua última aplicação{phrase} "
        f"({last_applied_on.strftime('%d/%m/%Y')}). "
        "Quando puder, podemos marcar uma avaliação de retorno. Me diga o melhor dia e horário para você."
    )


def _starts_today(today: date) -> datetime:
    return timezone.make_aware(datetime.combine(today, time.min))


def due_returns(user: User, today: date, within_days: int = 30) -> list[dict]:
    """Retornos vencidos ou que vencem em até `within_days` dias, um item por paciente e tipo de produto.

    - Vale a última aplicação de cada tipo; o intervalo vem do produto dessa aplicação, senão do padrão do tipo.
    - Fora: paciente arquivado, paciente com agendamento futuro não cancelado, tipo sem intervalo.
    - Paciente com dados ocultos aparece como "Dados ocultos", sem telefone, qualquer que seja o cadastro.
    - Ordem: vencidos (mais atrasado primeiro), depois próximos (vencimento mais perto primeiro).
    Três consultas, qualquer que seja o número de pacientes.
    """
    rows = (
        Application.objects.filter(patient__owner=user, patient__archived_at__isnull=True)
        .order_by("-applied_at", "-id")
        .values_list("patient_id", "lot__product__kind", "applied_at", "lot__product__return_interval_days")
    )
    latest: dict[tuple[int, str], tuple[datetime, int | None]] = {}
    for patient_id, kind, applied_at, product_interval in rows:
        latest.setdefault((patient_id, kind), (applied_at, product_interval))  # já vem do mais novo para o mais antigo

    candidates = []
    for (patient_id, kind), (applied_at, product_interval) in latest.items():
        interval = product_interval if product_interval is not None else DEFAULT_INTERVALS.get(kind)
        if interval is None:
            continue
        last_on = timezone.localtime(applied_at).date()
        due_on = last_on + timedelta(days=interval)
        days_overdue = (today - due_on).days
        if days_overdue > 0:
            status = "vencido"
        elif -days_overdue <= within_days:
            status = "proximo"
        else:
            continue  # em dia e fora da janela: não entra na lista
        candidates.append((patient_id, kind, applied_at, last_on, due_on, days_overdue, status, interval, product_interval))
    if not candidates:
        return []

    ids = {c[0] for c in candidates}
    booked = set(
        Appointment.objects.filter(owner=user, patient_id__in=ids, starts_at__gte=_starts_today(today))
        .exclude(status=Appointment.Status.CANCELED)
        .values_list("patient_id", flat=True)
    )
    patients = {p.id: p for p in Patient.objects.filter(owner=user, pk__in=ids - booked).only("id", "full_name", "phone", "anonymized_at")}

    items = []
    for patient_id, kind, applied_at, last_on, due_on, days_overdue, status, interval, product_interval in candidates:
        patient = patients.get(patient_id)
        if patient is None:  # com agendamento futuro
            continue
        hidden = patient.anonymized_at is not None
        name = HIDDEN_NAME if hidden else patient.full_name
        words = [] if hidden else patient.full_name.split()
        items.append(
            {
                "patient_id": patient_id,
                "patient_name": name,
                "phone": "" if hidden else patient.phone,
                "kind": kind,
                "last_applied_at": applied_at.isoformat(),
                "due_on": due_on.isoformat(),
                "days_overdue": days_overdue,
                "status": status,
                "interval_days": interval,
                "interval_source": "produto" if product_interval is not None else "padrao",
                "message": build_message(words[0] if words else None, kind, last_on),
            }
        )
    # Vencimento mais antigo primeiro: entre os vencidos é o mais atrasado, entre os próximos é o que vence antes.
    items.sort(key=lambda i: (i["status"] != "vencido", i["due_on"], i["patient_id"]))
    return items
