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


def test_apply_deducts_balance_and_traceability(client, auth, other_auth, patient):
    prod = product(client, auth)
    l1 = lot(client, auth, prod["id"], "A1", quantity=25).json()
    plan = plan_with(client, auth, patient, l1["id"], amount=10, technique="bolus", depth="intramuscular").json()
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
    assert client.get(f"/api/patients/{patient['id']}/traceability/print").status_code == 401
    assert client.delete(f"/api/inventory/lots/{l1['id']}", headers=auth).status_code == 409  # já aplicado


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
