import base64
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.consent.models import Signature, Term, compute_hash
from tests.conftest import png_bytes

pytestmark = pytest.mark.django_db(transaction=True)


def product(client, auth, **over):
    body = {"brand": "Allergan", "name": "Botox 100U", "kind": "toxina", "unit": "U", "anvisa_registration": "123"} | over
    r = client.post("/api/inventory/products", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def lot(client, auth, product_id, number="L1", days=90, quantity=100):
    expires = (timezone.localdate() + timedelta(days=days)).isoformat()
    return client.post(
        "/api/inventory/lots", json={"product_id": product_id, "number": number, "expires_on": expires, "quantity": quantity}, headers=auth
    )


def plan_with(client, auth, patient, lot_id, amount=10, treatment="botox", **point):
    body = {"points": [{"region": "testa", "treatment": treatment, "x": 0.5, "y": 0.2, "amount": amount, "lot_id": lot_id, **point}]}
    return client.post(f"/api/patients/{patient['id']}/plans", json=body, headers=auth)


def test_point_new_fields_optional_and_roundtrip(client, auth, patient):
    old = client.post(
        f"/api/patients/{patient['id']}/plans",
        json={"points": [{"region": "testa", "treatment": "botox", "x": 0.5, "y": 0.2, "amount": 4}]},
        headers=auth,
    )
    assert old.status_code == 201
    p = old.json()["points"][0]
    assert (p["technique"], p["depth"], p["lot_id"]) == ("", "", None)

    new = plan_with(client, auth, patient, None, technique="retroinjecao", depth="supraperiosteal")
    assert new.json()["points"][0]["technique"] == "retroinjecao"
    bad = plan_with(client, auth, patient, None, technique="xyz")
    assert bad.status_code == 422


def test_inventory_isolation_and_lot_rules(client, auth, other_auth):
    prod = product(client, auth)
    assert client.get("/api/inventory/products", headers=other_auth).json() == []
    assert lot(client, other_auth, prod["id"]).status_code == 404  # produto de outro profissional
    first = lot(client, auth, prod["id"])
    assert first.status_code == 201 and first.json()["balance"] == 100
    assert lot(client, auth, prod["id"]).status_code == 409  # número duplicado
    assert client.get("/api/inventory/lots", headers=other_auth).json() == []
    assert client.patch(f"/api/inventory/lots/{first.json()['id']}", json={"balance": 5}, headers=other_auth).status_code == 404


def test_product_with_first_lot_creates_lot_and_entry(client, auth, other_auth):
    expires = (timezone.localdate() + timedelta(days=200)).isoformat()
    prod = product(client, auth, lot={"number": " P1 ", "expires_on": expires, "quantity": 12.5})
    first = prod["lot"]
    assert (first["product_id"], first["number"], first["expires_on"]) == (prod["id"], "P1", expires)
    assert (first["initial_quantity"], first["balance"], first["unit"]) == (12.5, 12.5, "U")
    assert client.get(f"/api/inventory/lots?product_id={prod['id']}", headers=auth).json() == [first]
    moves = client.get(f"/api/inventory/lots/{first['id']}/movements", headers=auth).json()
    assert [(m["kind"], m["delta"], m["balance_after"], m["reason"], m["author"]) for m in moves] == [
        ("entrada", 12.5, 12.5, "Entrada do lote", "Ana Souza"),
    ]
    assert lot(client, auth, prod["id"], "p1").status_code == 409  # mesma regra de número da entrada de lote
    assert "lot" not in client.get("/api/inventory/products", headers=auth).json()[0]  # a listagem não muda
    assert client.get("/api/inventory/lots", headers=other_auth).json() == []


def test_product_with_invalid_lot_is_not_created(client, auth, monkeypatch):
    from apps.inventory.models import LotMovement, Product

    expires = (timezone.localdate() + timedelta(days=200)).isoformat()
    body = {"brand": "Allergan", "name": "Botox 100U", "kind": "toxina", "unit": "U"}
    for bad in [
        {"number": "P1", "expires_on": expires, "quantity": 0},
        {"number": "", "expires_on": expires, "quantity": 5},
        {"number": "P1", "quantity": 5},
        {"number": "P1", "expires_on": "31/12/2099", "quantity": 5},
    ]:
        assert client.post("/api/inventory/products", json=body | {"lot": bad}, headers=auth).status_code == 422, bad

    # falha depois de o produto já ter sido inserido: a transação desfaz o produto e o lote
    def fail(**kwargs):
        raise RuntimeError("falha simulada")

    monkeypatch.setattr(LotMovement.objects, "create", fail)
    with pytest.raises(RuntimeError):
        client.post("/api/inventory/products", json=body | {"lot": {"number": "P1", "expires_on": expires, "quantity": 5}}, headers=auth)
    assert not Product.objects.exists()
    assert client.get("/api/inventory/lots", headers=auth).json() == []


def test_product_without_lot_still_works(client, auth):
    prod = product(client, auth)
    assert prod["lot"] is None and prod["active"] is True
    assert client.get("/api/inventory/lots", headers=auth).json() == []


def test_lot_number_of_only_spaces_is_refused(client, auth):
    expires = (timezone.localdate() + timedelta(days=200)).isoformat()
    blank = {"number": "   ", "expires_on": expires, "quantity": 5}
    body = {"brand": "Allergan", "name": "Botox 100U", "kind": "toxina", "unit": "U"}
    assert client.post("/api/inventory/products", json=body | {"lot": blank}, headers=auth).status_code == 422
    assert client.get("/api/inventory/products", headers=auth).json() == []

    prod = product(client, auth)
    assert client.post("/api/inventory/lots", json=blank | {"product_id": prod["id"]}, headers=auth).status_code == 422
    first = lot(client, auth, prod["id"], number="  L7  ").json()
    assert first["number"] == "L7"
    assert client.patch(f"/api/inventory/lots/{first['id']}", json={"number": "   "}, headers=auth).status_code == 422
    assert client.get("/api/inventory/lots", headers=auth).json()[0]["number"] == "L7"


def test_alerts_expired_and_expiring(client, auth):
    prod = product(client, auth)
    ok = lot(client, auth, prod["id"], "OK", days=90).json()
    soon = lot(client, auth, prod["id"], "SOON", days=10).json()
    old = lot(client, auth, prod["id"], "OLD", days=-5).json()
    r = client.get("/api/inventory/alerts", headers=auth).json()
    assert [l["id"] for l in r["expiring"]] == [soon["id"]]
    assert [l["id"] for l in r["expired"]] == [old["id"]]
    avail = [l["id"] for l in client.get("/api/inventory/lots?available=true", headers=auth).json()]
    assert avail == [soon["id"], ok["id"]]


def test_plan_rejects_expired_foreign_and_wrong_unit_lot(client, auth, other_auth, patient):
    prod = product(client, auth)
    old = lot(client, auth, prod["id"], "OLD", days=-1).json()
    assert plan_with(client, auth, patient, old["id"]).status_code == 422
    good = lot(client, auth, prod["id"], "G").json()
    assert plan_with(client, other_auth, {"id": patient["id"]}, good["id"]).status_code == 404
    assert plan_with(client, auth, patient, good["id"], treatment="preenchimento").status_code == 422  # U vs ml
    assert plan_with(client, auth, patient, 99999).status_code == 422


def test_traceability_names_the_point_and_shows_quantity(client, auth, patient):
    prod = product(client, auth)
    l1 = lot(client, auth, prod["id"], "A1", quantity=25).json()
    body = {
        "points": [
            {"region": "glabela", "point_key": "procero", "treatment": "botox", "x": 0.5, "y": 0.3, "amount": 2.5, "lot_id": l1["id"]},
            {"region": "testa", "treatment": "botox", "x": 0.5, "y": 0.2, "amount": 4, "lot_id": l1["id"]},
        ]
    }
    plan = client.post(f"/api/patients/{patient['id']}/plans", json=body, headers=auth).json()
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200

    rows = client.get(f"/api/patients/{patient['id']}/traceability", headers=auth).json()["rows"]
    assert {r["region"]: r["point_key"] for r in rows} == {"glabela": "procero", "testa": ""}
    html = client.get(f"/api/patients/{patient['id']}/traceability/print", headers=auth).text
    assert "<small>Prócero</small>" in html
    assert "<small></small>" not in html  # ponto sem nome não deixa linha vazia
    assert "2,5 U" in html


def test_point_key_backfill_copies_from_the_plan_point(client, auth, patient):
    from importlib import import_module

    from django.apps import apps

    from apps.inventory.models import Application

    prod = product(client, auth)
    l1 = lot(client, auth, prod["id"], "A1", quantity=25).json()
    plan = plan_with(client, auth, patient, l1["id"], amount=2, region="glabela", point_key="procero").json()
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200
    Application.objects.update(point_key="")  # como ficou quem aplicou antes da migration

    backfill = import_module("apps.inventory.migrations.0003_application_point_key").copy_point_keys
    backfill(apps, None)
    assert Application.objects.get().point_key == "procero"

    Application.objects.update(point_key="ja_tinha")  # rodar de novo não sobrescreve
    backfill(apps, None)
    assert Application.objects.get().point_key == "ja_tinha"


def test_apply_deducts_balance_and_traceability(client, auth, other_auth, patient):
    prod = product(client, auth)
    l1 = lot(client, auth, prod["id"], "A1", quantity=25).json()
    plan = plan_with(
        client, auth, patient, l1["id"], amount=10, technique="bolus", depth="intramuscular", region="platisma"
    ).json()
    assert client.get(f"/api/inventory/lots?product_id={prod['id']}", headers=auth).json()[0]["balance"] == 25  # salvar não baixa

    assert client.post(f"/api/plans/{plan['id']}/apply", headers=other_auth).status_code == 404
    done = client.post(f"/api/plans/{plan['id']}/apply", headers=auth)
    assert done.status_code == 200 and done.json()["applications"] == 1
    assert client.get("/api/inventory/lots", headers=auth).json()[0]["balance"] == 15
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 409  # não baixa duas vezes
    assert client.put(f"/api/plans/{plan['id']}", json={"points": []}, headers=auth).status_code == 409
    assert client.get(f"/api/plans/{plan['id']}", headers=auth).json()["applied_at"]

    trace = client.get(f"/api/patients/{patient['id']}/traceability", headers=auth).json()
    row = trace["rows"][0]
    assert (row["lot_number"], row["amount"], row["technique"], row["anvisa_registration"]) == ("A1", 10, "bolus", "123")
    assert client.get(f"/api/patients/{patient['id']}/traceability", headers=other_auth).status_code == 404
    html = client.get(f"/api/patients/{patient['id']}/traceability/print", headers=auth)
    assert html.status_code == 200 and "A1" in html.text and "Maria Paciente" in html.text
    assert "Platisma (pescoço)" in html.text  # rótulo de região nova no impresso
    assert client.get(f"/api/patients/{patient['id']}/traceability/print").status_code == 401


def test_apply_never_goes_negative_and_is_atomic(client, auth, patient):
    prod = product(client, auth)
    small = lot(client, auth, prod["id"], "S", quantity=12).json()
    body = {
        "points": [
            {"region": "testa", "treatment": "botox", "x": 0.4, "y": 0.2, "amount": 8, "lot_id": small["id"]},
            {"region": "testa", "treatment": "botox", "x": 0.6, "y": 0.2, "amount": 8, "lot_id": small["id"]},
        ]
    }
    plan = client.post(f"/api/patients/{patient['id']}/plans", json=body, headers=auth).json()
    r = client.post(f"/api/plans/{plan['id']}/apply", headers=auth)
    assert r.status_code == 409
    assert client.get("/api/inventory/lots", headers=auth).json()[0]["balance"] == 12  # nada foi baixado
    assert client.get(f"/api/plans/{plan['id']}", headers=auth).json()["applied_at"] is None


def test_apply_blocks_lot_that_expired_after_planning(client, auth, patient):
    from apps.inventory.models import Lot

    prod = product(client, auth)
    l = lot(client, auth, prod["id"], "X").json()
    plan = plan_with(client, auth, patient, l["id"]).json()
    Lot.objects.filter(pk=l["id"]).update(expires_on=timezone.localdate() - timedelta(days=1))
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 422


def test_apply_without_lot_is_reported(client, auth, patient):
    plan = plan_with(client, auth, patient, None).json()
    r = client.post(f"/api/plans/{plan['id']}/apply", headers=auth).json()
    assert (r["applications"], r["without_lot"]) == (0, 1)


# ---- consentimento ----
def signature_data(color=(0, 0, 0)):
    return "data:image/png;base64," + base64.b64encode(png_bytes((300, 120), color)).decode()


@pytest.fixture
def terms():
    return {
        "botox": Term.objects.create(kind="botox", version=1, title="Termo Botox", content="Texto do termo de toxina."),
        "img": Term.objects.create(kind="uso_imagem", version=1, title="Uso de imagem", content="Autorizo uso de imagem."),
    }


def test_terms_latest_active_version(client, auth, terms):
    Term.objects.create(kind="botox", version=2, title="Termo Botox v2", content="Novo texto.")
    Term.objects.filter(kind="botox", version=1).update(active=False)
    listed = client.get("/api/consent/terms", headers=auth).json()
    assert {(t["kind"], t["version"]) for t in listed} == {("botox", 2), ("uso_imagem", 1)}
    assert client.get("/api/consent/terms").status_code == 401


def test_sign_stores_evidence_and_hash(client, auth, other_auth, patient, terms):
    pid = patient["id"]
    r = client.post(
        f"/api/patients/{pid}/consents",
        json={"term_id": terms["botox"].id, "signer_name": "Maria Paciente", "signature": signature_data()},
        headers=auth,
    )
    assert r.status_code == 201, r.text
    out = r.json()
    assert len(out["document_hash"]) == 64 and out["ip_address"] and out["version"] == 1

    sig = Signature.objects.get(pk=out["id"])
    assert sig.document_hash == compute_hash(
        term_kind="botox", term_version=1, term_content="Texto do termo de toxina.",
        patient_id=pid, signer_name="Maria Paciente", signed_at=sig.signed_at, image=sig.image,
    )
    # outra assinatura (imagem diferente) gera outro hash
    other = client.post(
        f"/api/patients/{pid}/consents",
        json={"term_id": terms["botox"].id, "signer_name": "Maria Paciente", "signature": signature_data((9, 9, 9))},
        headers=auth,
    ).json()
    assert other["document_hash"] != out["document_hash"]

    assert client.get(f"/api/patients/{pid}/consents", headers=other_auth).status_code == 404
    assert len(client.get(f"/api/patients/{pid}/consents", headers=auth).json()) == 2
    # imagem e documento: só com token e só do dono
    assert client.get(f"/api/consents/{out['id']}/signature").status_code == 401
    assert client.get(f"/api/consents/{out['id']}/signature", headers=other_auth).status_code == 404
    assert client.get(f"/api/consents/{out['id']}/signature", headers=auth).headers["content-type"] == "image/png"
    doc = client.get(f"/api/consents/{out['id']}/document", headers=auth)
    assert out["document_hash"] in doc.text and "Hash conferido" in doc.text
    assert client.get(f"/api/consents/{out['id']}/document", headers=other_auth).status_code == 404


def test_sign_validation(client, auth, patient, terms):
    url = f"/api/patients/{patient['id']}/consents"
    base = {"term_id": terms["botox"].id, "signer_name": "Maria"}
    assert client.post(url, json=base | {"signature": "data:image/png;base64,naoebase64!!!!!!!!!"}, headers=auth).status_code == 422
    fake = "data:image/png;base64," + base64.b64encode(b"nao sou png" * 5).decode()
    assert client.post(url, json=base | {"signature": fake}, headers=auth).status_code == 422
    assert client.post(url, json=base | {"term_id": 9999, "signature": signature_data()}, headers=auth).status_code == 404
    Term.objects.filter(pk=terms["botox"].id).update(active=False)
    assert client.post(url, json=base | {"signature": signature_data()}, headers=auth).status_code == 404


def test_image_use_consent_is_separate_and_revocable(client, auth, patient, terms):
    pid = patient["id"]
    proc = client.post(
        f"/api/patients/{pid}/consents",
        json={"term_id": terms["botox"].id, "signer_name": "Maria", "signature": signature_data()},
        headers=auth,
    ).json()
    assert client.post(f"/api/consents/{proc['id']}/revoke", headers=auth).status_code == 422  # procedimento não revoga aqui
    img = client.post(
        f"/api/patients/{pid}/consents",
        json={"term_id": terms["img"].id, "signer_name": "Maria", "signature": signature_data()},
        headers=auth,
    ).json()
    assert img["kind"] == "uso_imagem" and img["revoked_at"] is None
    revoked = client.post(f"/api/consents/{img['id']}/revoke", headers=auth).json()
    assert revoked["revoked_at"]
    # o consentimento do procedimento segue intacto
    states = {s["kind"]: s["revoked_at"] for s in client.get(f"/api/patients/{pid}/consents", headers=auth).json()}
    assert states["botox"] is None and states["uso_imagem"]


def test_seed_migration_creates_model_terms():
    # O banco de teste é limpo a cada teste; confere a função de seed diretamente.
    import importlib

    from django.apps import apps

    mod = importlib.import_module("apps.consent.migrations.0002_seed_terms")
    Term.objects.all().delete()
    mod.seed(apps, None)
    kinds = set(Term.objects.values_list("kind", flat=True))
    assert kinds == {"botox", "preenchimento", "bioestimulador", "skinbooster", "outro", "uso_imagem"}
    assert "RDC" not in "".join(Term.objects.values_list("content", flat=True))


# ---- arquivar / ocultar dados / auditoria de estoque ----
def applied_patient(client, auth, patient, number="AN1", quantity=50, amount=10):
    prod = product(client, auth)
    l = lot(client, auth, prod["id"], number, quantity=quantity).json()
    plan = plan_with(client, auth, patient, l["id"], amount=amount).json()
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200
    return l, plan


def patient_actions(client, auth):
    return [l["action"] for l in client.get("/api/audit", headers=auth).json() if l["resource"] == "paciente"]


def test_archive_leaves_the_list_and_keeps_everything(client, auth, other_auth, patient):
    from apps.inventory.models import Application

    pid = patient["id"]
    photo = client.post(f"/api/patients/{pid}/photos", files={"file": ("a.png", png_bytes(), "image/png")}, headers=auth).json()
    applied_patient(client, auth, patient)

    assert client.post(f"/api/patients/{pid}/archive", headers=other_auth).status_code == 404
    assert client.post(f"/api/patients/{pid}/archive").status_code == 401
    assert client.post(f"/api/patients/{pid}/archive", headers=auth).json()["archived_at"]
    assert client.get("/api/patients", headers=auth).json() == []
    assert [p["id"] for p in client.get("/api/patients?archived=true", headers=auth).json()] == [pid]

    # Arquivado continua abrindo inteiro: paciente, foto e rastreabilidade.
    assert client.get(f"/api/patients/{pid}", headers=auth).json()["full_name"] == patient["full_name"]
    assert client.get(f"/api/photos/{photo['id']}/file", headers=auth).status_code == 200
    assert Application.objects.filter(patient_id=pid).count() == 1
    assert len(client.get(f"/api/patients/{pid}/traceability", headers=auth).json()["rows"]) == 1

    assert client.post(f"/api/patients/{pid}/unarchive", headers=other_auth).status_code == 404
    assert client.post(f"/api/patients/{pid}/unarchive", headers=auth).json()["archived_at"] is None
    assert client.post(f"/api/patients/{pid}/unarchive", headers=auth).status_code == 200  # idempotente
    assert [p["id"] for p in client.get("/api/patients", headers=auth).json()] == [pid]
    assert patient_actions(client, auth) == ["reativar", "arquivar"]


def test_hide_masks_personal_data_deletes_nothing_and_reveal_restores(client, auth, other_auth, questions):
    from apps.clinical.models import Anamnesis
    from apps.inventory.models import Application
    from apps.patients.models import PatientHiddenData, PatientPhoto

    p = client.post(
        "/api/patients",
        json={"full_name": "Joana Real", "phone": "11999990000", "email": "joana@x.com", "birth_date": "1990-01-02", "notes": "obs"},
        headers=auth,
    ).json()
    pid = p["id"]
    photo = client.post(f"/api/patients/{pid}/photos", files={"file": ("a.png", png_bytes(), "image/png")}, headers=auth).json()
    path = PatientPhoto.objects.get(pk=photo["id"]).image.path
    import os

    client.put(
        f"/api/patients/{pid}/anamnesis",
        json={"notes": "texto livre sensivel", "answers": [{"question_id": questions[0].id, "answer": True, "detail": "penicilina"}]},
        headers=auth,
    )
    term = Term.objects.create(kind="botox", version=1, title="T", content="c")
    sig = client.post(
        f"/api/patients/{pid}/consents", json={"term_id": term.id, "signer_name": "Joana Real", "signature": signature_data()}, headers=auth
    ).json()
    l, plan = applied_patient(client, auth, p, number="ANON")
    draft = plan_with(client, auth, p, None, amount=3, point_key="procero").json()

    assert client.post(f"/api/patients/{pid}/anonymize", headers=other_auth).status_code == 404
    assert client.post(f"/api/patients/{pid}/anonymize").status_code == 401
    r = client.post(f"/api/patients/{pid}/anonymize", headers=auth)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["full_name"].startswith("Paciente com dados ocultos") and out["anonymized_at"]
    assert (out["phone"], out["email"], out["notes"], out["birth_date"]) == ("", "", "", None)

    # Sai das telas e dos documentos.
    assert client.get(f"/api/patients/{pid}/photos", headers=auth).json() == []
    assert client.get(f"/api/photos/{photo['id']}/file", headers=auth).status_code == 404
    assert client.get("/api/patients?q=Joana", headers=auth).json() == []
    trace = client.get(f"/api/patients/{pid}/traceability", headers=auth).json()
    assert trace["rows"][0]["lot_number"] == "ANON" and trace["patient_name"].startswith("Paciente com dados ocultos")
    assert "Joana" not in client.get(f"/api/patients/{pid}/traceability/print", headers=auth).text

    # A tela não recebe foto nem pontos, então salvar dali esvaziaria o plano.
    assert client.put(f"/api/plans/{draft['id']}", json={"points": []}, headers=auth).status_code == 409
    assert plan_with(client, auth, p, None).status_code == 409
    assert client.post(f"/api/patients/{pid}/photos", files={"file": ("b.png", png_bytes(), "image/png")}, headers=auth).status_code == 409
    assert len(client.get(f"/api/plans/{draft['id']}", headers=auth).json()["points"]) == 1

    # Nada foi apagado.
    assert PatientPhoto.objects.filter(pk=photo["id"]).exists() and os.path.exists(path)
    assert Anamnesis.objects.filter(patient_id=pid).exists() and Signature.objects.filter(pk=sig["id"]).exists()
    assert client.get(f"/api/patients/{pid}/anamnesis/versions", headers=auth).json()[0]["notes"] == "texto livre sensivel"
    assert Application.objects.filter(patient_id=pid).count() == 1

    # "Mostrar dados" devolve tudo, só para o dono.
    assert client.post(f"/api/patients/{pid}/reveal", headers=other_auth).status_code == 404
    assert client.post(f"/api/patients/{pid}/reveal").status_code == 401
    back = client.post(f"/api/patients/{pid}/reveal", headers=auth).json()
    assert (back["full_name"], back["phone"], back["email"], back["notes"], back["birth_date"]) == (
        "Joana Real", "11999990000", "joana@x.com", "obs", "1990-01-02",
    )
    assert back["anonymized_at"] is None
    assert [item["id"] for item in client.get(f"/api/patients/{pid}/photos", headers=auth).json()] == [photo["id"]]
    assert client.get(f"/api/photos/{photo['id']}/file", headers=auth).status_code == 200
    assert client.post(f"/api/patients/{pid}/reveal", headers=auth).status_code == 200  # idempotente

    # Ocultar de novo acrescenta outra cópia, e a anterior fica.
    client.patch(f"/api/patients/{pid}", json={"phone": "11888880000"}, headers=auth)
    client.post(f"/api/patients/{pid}/anonymize", headers=auth)
    assert PatientHiddenData.objects.filter(patient_id=pid).count() == 2
    assert client.post(f"/api/patients/{pid}/reveal", headers=auth).json()["phone"] == "11888880000"
    assert patient_actions(client, auth) == ["mostrar", "anonimizar", "mostrar", "anonimizar"]


def test_reveal_of_patient_anonymized_by_the_old_version_is_409(client, auth, patient):
    from apps.patients.models import Patient

    Patient.objects.filter(pk=patient["id"]).update(full_name="Paciente anonimizado #1", anonymized_at=timezone.now())
    r = client.post(f"/api/patients/{patient['id']}/reveal", headers=auth)
    assert r.status_code == 409 and "versão antiga" in r.json()["detail"]
    assert client.get(f"/api/patients/{patient['id']}", headers=auth).json()["anonymized_at"]


def test_double_apply_second_is_409_and_deducts_once(client, auth, patient):
    l, plan = applied_patient(client, auth, patient, quantity=30, amount=10)
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 409
    assert client.get("/api/inventory/lots", headers=auth).json()[0]["balance"] == 20


def test_consent_and_printables_idor(client, auth, other_auth, patient, terms):
    pid = patient["id"]
    sid = client.post(
        f"/api/patients/{pid}/consents",
        json={"term_id": terms["img"].id, "signer_name": "Maria", "signature": signature_data()},
        headers=auth,
    ).json()["id"]
    for method, url in [
        ("get", f"/api/consents/{sid}/signature"),
        ("get", f"/api/consents/{sid}/document"),
        ("post", f"/api/consents/{sid}/revoke"),
        ("get", f"/api/patients/{pid}/traceability/print"),
        ("get", f"/api/patients/{pid}/traceability"),
        ("get", f"/api/patients/{pid}/consents"),
    ]:
        assert getattr(client, method)(url, headers=other_auth).status_code == 404, url
        assert getattr(client, method)(url).status_code == 401, url
    assert Signature.objects.get(pk=sid).revoked_at is None  # revogação alheia não surtiu efeito


def test_lot_movements_log(client, auth, other_auth, patient):
    prod = product(client, auth)
    l = lot(client, auth, prod["id"], "M1", quantity=30).json()
    url = f"/api/inventory/lots/{l['id']}/movements"

    # ajuste de saldo exige motivo
    assert client.patch(f"/api/inventory/lots/{l['id']}", json={"balance": 25}, headers=auth).status_code == 422
    assert client.patch(f"/api/inventory/lots/{l['id']}", json={"balance": 25, "reason": "  "}, headers=auth).status_code == 422
    ok = client.patch(f"/api/inventory/lots/{l['id']}", json={"balance": 25, "reason": "Frasco quebrado"}, headers=auth)
    assert ok.status_code == 200 and ok.json()["balance"] == 25
    # trocar só o número não exige motivo nem gera movimento
    assert client.patch(f"/api/inventory/lots/{l['id']}", json={"number": "M1b"}, headers=auth).status_code == 200

    plan = plan_with(client, auth, patient, l["id"], amount=10).json()
    assert client.post(f"/api/plans/{plan['id']}/apply", headers=auth).status_code == 200

    moves = client.get(url, headers=auth).json()
    assert [(m["kind"], m["delta"], m["balance_after"]) for m in reversed(moves)] == [
        ("entrada", 30, 30), ("ajuste", -5, 25), ("baixa", -10, 15),
    ]
    assert moves[1]["reason"] == "Frasco quebrado" and moves[1]["author"] == "Ana Souza"
    assert client.get(url, headers=other_auth).status_code == 404
    assert client.get(url).status_code == 401
