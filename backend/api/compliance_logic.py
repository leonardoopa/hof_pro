"""Pendências do prontuário: o que ficou sem fechar nos pacientes de um profissional.

As regras espelham a checagem `apply-check` (api/routers/safety.py): anamnese = existe `Anamnesis` salva;
termo = `Signature` não revogada cujo `term.kind` é o do tratamento (os kinds de Term e de Treatment são os mesmos);
intercorrência aberta = desfecho "acompanhamento". A diferença é que aqui o olhar é para trás, sobre planos
já aplicados, e a tela agrupa tudo num lugar só.

Cada tipo de pendência é uma consulta agregada (sem N+1) e o nome do paciente vem junto, por join.
Paciente arquivado fica de fora; paciente com dados ocultos entra, mas sempre como "Dados ocultos".
"""

from collections import defaultdict
from datetime import timedelta

from django.db.models import Count, Exists, OuterRef
from django.utils import timezone

from apps.accounts.models import User
from apps.clinical.models import FacialPlan, PlanPoint
from apps.consent.models import Signature, Term
from apps.inventory.models import Application
from apps.patients.models import Patient
from apps.safety.models import AdverseEvent

HIDDEN_NAME = "Dados ocultos"
STALE_PLAN_DAYS = 30
SEVERITIES = ("alta", "media", "baixa")
_ORDER = {s: i for i, s in enumerate(SEVERITIES)}

_EVENT_SEVERITY = {
    AdverseEvent.Severity.SEVERE: "alta",
    AdverseEvent.Severity.MODERATE: "media",
    AdverseEvent.Severity.MILD: "baixa",
}


def _label(choices, value: str) -> str:
    try:
        return choices(value).label
    except ValueError:
        return value or "-"


def _display_name(full_name: str, anonymized_at) -> str:
    return HIDDEN_NAME if anonymized_at is not None else full_name


def _item(patient_id, name, anonymized_at, code, severity, message, ref_type, ref_id) -> dict:
    return {
        "patient_id": patient_id,
        "patient_name": _display_name(name, anonymized_at),
        "code": code,
        "severity": severity,
        "message": message,
        "ref": {"type": ref_type, "id": ref_id},
    }


def _active_patients(user: User, prefix: str = "patient__") -> dict:
    """Filtro comum: só pacientes do próprio profissional e não arquivados."""
    return {f"{prefix}owner": user, f"{prefix}archived_at__isnull": True}


def _missing_anamnesis(user: User) -> list[dict]:
    has_plan = FacialPlan.objects.filter(patient=OuterRef("pk"))
    has_applied_plan = has_plan.filter(applied_at__isnull=False)
    patients = (
        Patient.objects.filter(owner=user, archived_at__isnull=True, anamnesis__isnull=True)
        .filter(Exists(has_plan))
        .annotate(has_applied=Exists(has_applied_plan))
        .values_list("id", "full_name", "anonymized_at", "has_applied")
    )
    return [
        _item(
            pid, name, hidden, "sem_anamnese",
            # Procedimento já feito sem anamnese pesa mais do que um plano ainda em rascunho.
            "alta" if applied else "media",
            "Paciente com plano e sem anamnese salva.", "patient", pid,
        )
        for pid, name, hidden, applied in patients
    ]


def _missing_terms(user: User) -> list[dict]:
    """Um item por paciente: assinar o termo resolve todos os planos aplicados daquele tratamento."""
    points = (
        PlanPoint.objects.filter(plan__applied_at__isnull=False, amount__gt=0, **_active_patients(user, "plan__patient__"))
        .values_list(
            "plan__patient_id", "plan_id", "plan__applied_at", "treatment", "plan__patient__full_name", "plan__patient__anonymized_at"
        )
        .distinct()
    )
    needed = defaultdict(lambda: {"name": "", "hidden": None, "plans": defaultdict(set)})  # paciente -> plano -> tratamentos
    for patient_id, plan_id, applied_at, treatment, name, hidden in points:
        entry = needed[patient_id]
        entry["name"], entry["hidden"] = name, hidden
        entry["plans"][(applied_at, plan_id)].add(treatment)
    if not needed:
        return []

    signed = defaultdict(set)
    for patient_id, kind in Signature.objects.filter(
        patient__owner=user, patient__archived_at__isnull=True, revoked_at__isnull=True
    ).values_list("patient_id", "term__kind").distinct():
        signed[patient_id].add(kind)

    out = []
    for patient_id, entry in needed.items():
        missing_kinds, newest = set(), None
        for key, treatments in sorted(entry["plans"].items()):  # do mais antigo para o mais novo
            missing = treatments - signed[patient_id]
            if missing:
                missing_kinds |= missing
                newest = key
        if not missing_kinds:
            continue
        names = ", ".join(_label(Term.Kind, k) for k in sorted(missing_kinds))
        out.append(
            _item(
                patient_id, entry["name"], entry["hidden"], "sem_termo", "alta",
                f"Procedimento aplicado sem termo de consentimento assinado: {names}.", "plan", newest[1],
            )
        )
    return out


def _missing_lots(user: User) -> list[dict]:
    """Pontos de plano aplicado que não geraram aplicação (sem lote): ficam fora da rastreabilidade."""
    rows = (
        PlanPoint.objects.filter(plan__applied_at__isnull=False, amount__gt=0, **_active_patients(user, "plan__patient__"))
        .filter(~Exists(Application.objects.filter(point=OuterRef("pk"))))
        .values("plan_id", "plan__patient_id", "plan__patient__full_name", "plan__patient__anonymized_at")
        .annotate(n=Count("id"))
    )
    return [
        _item(
            r["plan__patient_id"], r["plan__patient__full_name"], r["plan__patient__anonymized_at"], "sem_lote", "media",
            f"{r['n']} ponto aplicado sem lote registrado: fica fora da rastreabilidade."
            if r["n"] == 1
            else f"{r['n']} pontos aplicados sem lote registrado: ficam fora da rastreabilidade.",
            "plan", r["plan_id"],
        )
        for r in rows
    ]


def _open_events(user: User) -> list[dict]:
    events = AdverseEvent.objects.filter(outcome=AdverseEvent.Outcome.FOLLOW_UP, **_active_patients(user)).values_list(
        "id", "patient_id", "kind", "severity", "onset_at", "patient__full_name", "patient__anonymized_at"
    )
    out = []
    for event_id, patient_id, kind, severity, onset_at, name, hidden in events:
        level = "alta" if kind == AdverseEvent.Kind.VASCULAR_OCCLUSION else _EVENT_SEVERITY.get(severity, "media")
        since = timezone.localtime(onset_at).strftime("%d/%m/%Y")
        out.append(
            _item(
                patient_id, name, hidden, "intercorrencia_aberta", level,
                f"Intercorrência em acompanhamento: {_label(AdverseEvent.Kind, kind).lower()} ({_label(AdverseEvent.Severity, severity).lower()}), desde {since}.",
                "adverse_event", event_id,
            )
        )
    return out


def _stale_drafts(user: User, now) -> list[dict]:
    drafts = FacialPlan.objects.filter(
        applied_at__isnull=True, created_at__lt=now - timedelta(days=STALE_PLAN_DAYS), **_active_patients(user)
    ).values_list("id", "patient_id", "created_at", "patient__full_name", "patient__anonymized_at")
    return [
        _item(
            patient_id, name, hidden, "plano_sem_aplicacao", "baixa",
            f"Plano em rascunho há {(now - created_at).days} dias, sem aplicação.", "plan", plan_id,
        )
        for plan_id, patient_id, created_at, name, hidden in drafts
    ]


def pending_items(user: User, now=None) -> list[dict]:
    """Pendências do profissional, da mais grave para a mais leve. Seis consultas, não importa quantos pacientes."""
    now = now or timezone.now()
    items = [
        *_missing_anamnesis(user),
        *_missing_terms(user),
        *_missing_lots(user),
        *_open_events(user),
        *_stale_drafts(user, now),
    ]
    items.sort(key=lambda i: (_ORDER[i["severity"]], i["patient_name"].casefold(), i["patient_id"], i["code"], i["ref"]["id"]))
    return items


def count_by_severity(items: list[dict]) -> dict[str, int]:
    counts = dict.fromkeys(SEVERITIES, 0)
    for item in items:
        counts[item["severity"]] += 1
    return counts
