"""Dados de demonstração para onboarding. Tudo é marcado "(Demo)" e não usa foto de pessoa real.

A mesma lógica serve ao comando `manage.py seed_demo` e à rota POST /api/demo."""

from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.clinical.models import Anamnesis, AnamnesisAnswer, AnamnesisQuestion, FacialPlan, PlanPoint
from apps.inventory.models import Application, Lot, LotMovement, Product
from apps.patients.models import Patient

DEMO_TAG = "(Demo)"

PRODUCTS = [
    # (marca, nome, tipo, unidade, lote, quantidade)
    ("Demo", f"Toxina botulínica 100U {DEMO_TAG}", Product.Kind.TOXIN, Product.Unit.UNITS, "DEMO-TOX-001", Decimal("100")),
    ("Demo", f"Ácido hialurônico 1 ml {DEMO_TAG}", Product.Kind.FILLER, Product.Unit.ML, "DEMO-AH-001", Decimal("10")),
]

PATIENTS = ["Ana Exemplo (Demo)", "Bruno Exemplo (Demo)"]


def has_demo(user) -> bool:
    return Patient.objects.filter(owner=user, full_name__endswith=DEMO_TAG, archived_at__isnull=True).exists()


def _products(user) -> dict[str, Lot]:
    lots = {}
    for brand, name, kind, unit, number, qty in PRODUCTS:
        product, _ = Product.objects.get_or_create(
            owner=user, brand=brand, name=name, defaults={"kind": kind, "unit": unit, "anvisa_registration": "0000000000000"}
        )
        lot = Lot.objects.filter(product=product, number=number).first()
        if lot is None:
            lot = Lot.objects.create(
                product=product, number=number, expires_on=timezone.localdate() + timedelta(days=365),
                initial_quantity=qty, balance=qty,
            )
            LotMovement.objects.create(
                lot=lot, kind=LotMovement.Kind.ENTRY, delta=qty, balance_after=qty, author=user, reason="Entrada do lote (demo)"
            )
        lots[unit] = lot
    return lots


def _anamnesis(patient: Patient) -> None:
    anamnesis = Anamnesis.objects.create(patient=patient, notes="Paciente fictícia para demonstração.")
    AnamnesisAnswer.objects.bulk_create(
        AnamnesisAnswer(anamnesis=anamnesis, question=q, answer=False) for q in AnamnesisQuestion.objects.filter(active=True)
    )
    anamnesis.record_version(patient.owner)


def _plan(user, patient, title, specs, lots, apply_days_ago=None) -> None:
    plan = FacialPlan.objects.create(patient=patient, created_by=user, title=title, notes="Plano de demonstração.")
    for region, treatment, unit, x, y, amount, technique, depth in specs:
        PlanPoint.objects.create(
            plan=plan, region=region, treatment=treatment, unit=unit, x=x, y=y, amount=Decimal(amount),
            technique=technique, depth=depth, lot=lots[unit],
        )
    if apply_days_ago is None:
        return
    when = timezone.now() - timedelta(days=apply_days_ago)
    FacialPlan.objects.filter(pk=plan.pk).update(applied_at=when)
    for p in plan.points.select_related("lot"):
        lot = p.lot
        Lot.objects.filter(pk=lot.pk).update(balance=F("balance") - p.amount)
        lot.refresh_from_db(fields=["balance"])
        LotMovement.objects.create(
            lot=lot, kind=LotMovement.Kind.WRITE_OFF, delta=-p.amount, balance_after=lot.balance, author=user,
            reason=f"Aplicação do plano #{plan.id} (demo)",
        )
        app = Application.objects.create(
            patient=patient, plan=plan, point=p, lot=lot, applied_by=user, amount=p.amount, unit=p.unit,
            region=p.region, point_key=p.point_key, treatment=p.treatment, technique=p.technique, depth=p.depth,
        )
        Application.objects.filter(pk=app.pk).update(applied_at=when)  # auto_now_add ignora o valor na criação


@transaction.atomic
def seed_demo(user) -> bool:
    """Cria os dados de demonstração. Idempotente: devolve False (sem mudar nada) se já houver demo."""
    if has_demo(user):
        return False
    lots = _products(user)
    ana = Patient.objects.create(
        owner=user, full_name=PATIENTS[0], phone="(00) 00000-0000", notes="Paciente fictícia (Demo). Pode ser arquivada."
    )
    bruno = Patient.objects.create(
        owner=user, full_name=PATIENTS[1], phone="(00) 00000-0001", notes="Paciente fictício (Demo). Pode ser arquivado."
    )
    for patient in (ana, bruno):
        _anamnesis(patient)
    # Ana: aplicação há ~100 dias (aparece no relatório de retorno). Bruno: plano ainda só planejado.
    _plan(user, ana, "Botox terço superior (Demo)", [
        ("testa", "botox", "U", 0.50, 0.18, "8", "bolus", "intramuscular"),
        ("testa", "botox", "U", 0.38, 0.20, "4", "bolus", "intramuscular"),
    ], lots, apply_days_ago=100)
    _plan(user, bruno, "Preenchimento malar (Demo)", [
        ("malar", "preenchimento", "ml", 0.30, 0.50, "0.5", "canula", "subcutaneo"),
        ("malar", "preenchimento", "ml", 0.70, 0.50, "0.5", "canula", "subcutaneo"),
    ], lots)
    return True
