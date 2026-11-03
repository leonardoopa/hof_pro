import pytest

from apps.guidance.models import Orientacao

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def templates():
    # O banco é limpo a cada teste (inclusive o seed da migration): recria um modelo por tratamento.
    Orientacao.objects.all().delete()
    for t in ("botox", "preenchimento", "bioestimulador", "skinbooster"):
        Orientacao.objects.create(treatment=t, title=f"Após {t}", text="Primeira orientação\n\nSegunda orientação", order=1)


def make_plan(client, auth, patient, points):
    r = client.post(f"/api/patients/{patient['id']}/plans", json={"title": "Plano", "points": points}, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def pt(treatment, amount):
    return {"region": "testa", "treatment": treatment, "x": 0.5, "y": 0.3, "amount": amount}


def test_list_requires_auth_and_filters(client, auth):
    assert client.get("/api/guidance").status_code == 401
    items = client.get("/api/guidance", headers=auth).json()
    assert len(items) == 4 and all(i["items"] == ["Primeira orientação", "Segunda orientação"] for i in items)
    only = client.get("/api/guidance?treatment=botox", headers=auth).json()
    assert only and {i["treatment"] for i in only} == {"botox"}


def test_inactive_hidden(client, auth):
    Orientacao.objects.filter(treatment="botox").update(active=False)
    assert client.get("/api/guidance?treatment=botox", headers=auth).json() == []


def test_patient_guidance_from_plan(client, auth, patient):
    make_plan(client, auth, patient, [pt("botox", "10"), pt("preenchimento", "0.5"), pt("skinbooster", "0")])
    body = client.get(f"/api/patients/{patient['id']}/guidance", headers=auth).json()
    assert [s["treatment"] for s in body["sections"]] == ["botox", "preenchimento"]
    assert body["patient_name"] == "Maria Paciente"
    assert body["professional_name"] == "Ana Souza"
    assert body["sections"][0]["orientations"][0]["items"]
    assert body["treatments_without_template"] == []


def test_treatment_without_template_reported(client, auth, patient):
    make_plan(client, auth, patient, [pt("outro", "1")])
    body = client.get(f"/api/patients/{patient['id']}/guidance", headers=auth).json()
    assert body["sections"] == [] and body["treatments_without_template"] == ["Outro"]


def test_no_plan_gives_empty(client, auth, patient):
    body = client.get(f"/api/patients/{patient['id']}/guidance", headers=auth).json()
    assert body["plan_id"] is None and body["sections"] == []


def test_isolation_between_professionals(client, auth, other_auth, patient):
    plan = make_plan(client, auth, patient, [pt("botox", "10")])
    assert client.get(f"/api/patients/{patient['id']}/guidance", headers=other_auth).status_code == 404
    mine = client.post("/api/patients", json={"full_name": "Outra"}, headers=other_auth).json()
    r = client.get(f"/api/patients/{mine['id']}/guidance?plan_id={plan['id']}", headers=other_auth)
    assert r.status_code == 404


def test_migration_seed_texts():
    """Os textos-modelo da migration cobrem os 4 tratamentos e não prometem resultado."""
    import importlib

    mod = importlib.import_module("apps.guidance.migrations.0002_seed_orientacoes")
    assert {o[0] for o in mod.ORIENTACOES} == {"botox", "preenchimento", "bioestimulador", "skinbooster"}
    assert all(len(o[2]) >= 5 for o in mod.ORIENTACOES)
    assert not any("garant" in line.lower() for o in mod.ORIENTACOES for line in o[2])
