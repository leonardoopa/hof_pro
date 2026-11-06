from typing import get_args

import pytest

from api.schemas import RegionKey
from apps.clinical.models import Region
from tests.conftest import png_bytes, register

pytestmark = pytest.mark.django_db(transaction=True)


def test_register_login_me(client):
    headers = register(client)
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200 and me.json()["email"] == "ana@clinica.com"

    ok = client.post("/api/auth/login", json={"email": "ANA@clinica.com", "password": "Senha-forte-123"})
    assert ok.status_code == 200 and ok.json()["access_token"]

    bad = client.post("/api/auth/login", json={"email": "ana@clinica.com", "password": "errada"})
    assert bad.status_code == 401


def test_register_rejects_duplicate_and_weak_password(client):
    register(client)
    dup = client.post("/api/auth/register", json={"full_name": "Outra", "email": "Ana@clinica.com", "password": "Senha-forte-123"})
    assert dup.status_code == 409
    weak = client.post("/api/auth/register", json={"full_name": "Fraca", "email": "f@x.com", "password": "12345678"})
    assert weak.status_code == 422


def test_endpoints_require_token(client):
    assert client.get("/api/patients").status_code == 401
    assert client.get("/api/patients", headers={"Authorization": "Bearer lixo"}).status_code == 401


def test_patient_crud_and_isolation(client, auth, other_auth, patient):
    pid = patient["id"]
    assert client.get(f"/api/patients/{pid}", headers=auth).status_code == 200
    assert client.get(f"/api/patients/{pid}", headers=other_auth).status_code == 404
    assert client.get("/api/patients", headers=other_auth).json() == []

    patched = client.patch(f"/api/patients/{pid}", json={"phone": "11 99999-0000", "birth_date": "1990-05-02"}, headers=auth)
    assert patched.json()["phone"] == "11 99999-0000"
    cleared = client.patch(f"/api/patients/{pid}", json={"birth_date": None}, headers=auth)
    assert cleared.json()["birth_date"] is None

    found = client.get("/api/patients?q=maria", headers=auth).json()
    assert [p["id"] for p in found] == [pid] and found[0]["anamnesis_done"] is False

    assert client.post(f"/api/patients/{pid}/archive", headers=other_auth).status_code == 404
    assert client.post(f"/api/patients/{pid}/archive", headers=auth).status_code == 200


def test_anamnesis_requires_detail_when_yes(client, auth, patient, questions):
    url = f"/api/patients/{patient['id']}/anamnesis"
    alergia, fumante = questions

    missing = client.put(url, json={"answers": [{"question_id": alergia.id, "answer": True}]}, headers=auth)
    assert missing.status_code == 422

    body = {
        "answers": [
            {"question_id": alergia.id, "answer": True, "detail": "Dipirona"},
            {"question_id": fumante.id, "answer": False, "detail": "ignorado"},
        ],
        "notes": "Paciente tranquila.",
    }
    assert client.put(url, json=body, headers=auth).status_code == 200

    saved = client.get(url, headers=auth).json()
    by_q = {a["question_id"]: a for a in saved["answers"]}
    assert by_q[alergia.id] == {"question_id": alergia.id, "answer": True, "detail": "Dipirona"}
    assert by_q[fumante.id]["detail"] == ""
    assert saved["notes"] == "Paciente tranquila."

    listed = client.get("/api/patients", headers=auth).json()
    assert listed[0]["anamnesis_done"] is True


def test_photo_upload_is_private(client, auth, other_auth, patient):
    pid = patient["id"]
    up = client.post(
        f"/api/patients/{pid}/photos",
        files={"file": ("rosto.png", png_bytes(), "image/png")},
        data={"kind": "frontal"},
        headers=auth,
    )
    assert up.status_code == 201, up.text
    photo = up.json()
    assert (photo["width"], photo["height"]) == (60, 80)

    assert client.get(f"/api/photos/{photo['id']}/file", headers=auth).headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/photos/{photo['id']}/file", headers=other_auth).status_code == 404
    assert client.get(f"/api/photos/{photo['id']}/file").status_code == 401

    bad = client.post(
        f"/api/patients/{pid}/photos", files={"file": ("x.txt", b"nao sou imagem", "text/plain")}, headers=auth
    )
    assert bad.status_code == 422


def test_plan_totals_units_and_validation(client, auth, other_auth, patient):
    pid = patient["id"]
    plan_body = {
        "title": "Plano inicial",
        "points": [
            {"region": "testa", "treatment": "botox", "x": 0.4, "y": 0.2, "amount": 4},
            {"region": "testa", "treatment": "botox", "x": 0.6, "y": 0.2, "amount": 6},
            {"region": "malar", "treatment": "preenchimento", "x": 0.3, "y": 0.5, "amount": 0.5},
            {"region": "mento", "treatment": "preenchimento", "x": 0.5, "y": 0.8, "amount": 1},
            {"region": "boca", "treatment": "preenchimento", "x": 0.5, "y": 0.7, "amount": 0.5},
            {"region": "temporas", "treatment": "bioestimulador", "x": 0.2, "y": 0.3, "amount": 0},
        ],
    }
    created = client.post(f"/api/patients/{pid}/plans", json=plan_body, headers=auth)
    assert created.status_code == 201, created.text
    plan = created.json()
    assert plan["totals"] == {"total_ml": 2.0, "total_units": 10.0, "areas": 4}
    assert {p["unit"] for p in plan["points"] if p["treatment"] == "botox"} == {"U"}

    # PUT substitui os pontos
    plan_body["points"] = plan_body["points"][:1]
    updated = client.put(f"/api/plans/{plan['id']}", json=plan_body, headers=auth).json()
    assert updated["totals"] == {"total_ml": 0.0, "total_units": 4.0, "areas": 1}

    summaries = client.get(f"/api/patients/{pid}/plans", headers=auth).json()
    assert summaries[0]["totals"]["total_units"] == 4.0

    assert client.get(f"/api/plans/{plan['id']}", headers=other_auth).status_code == 404

    bad_xy = {"points": [{"region": "testa", "treatment": "botox", "x": 1.5, "y": 0.2, "amount": 1}]}
    assert client.post(f"/api/patients/{pid}/plans", json=bad_xy, headers=auth).status_code == 422
    bad_region = {"points": [{"region": "orelha", "treatment": "botox", "x": 0.5, "y": 0.2, "amount": 1}]}
    assert client.post(f"/api/patients/{pid}/plans", json=bad_region, headers=auth).status_code == 422
    negative = {"points": [{"region": "testa", "treatment": "botox", "x": 0.5, "y": 0.2, "amount": -1}]}
    assert client.post(f"/api/patients/{pid}/plans", json=negative, headers=auth).status_code == 422


def test_plan_new_regions_and_point_key(client, auth, patient):
    url = f"/api/patients/{patient['id']}/plans"
    body = {
        "points": [
            {"region": "glabela", "treatment": "botox", "x": 0.5, "y": 0.25, "amount": 4, "point_key": "procero"},
            {"region": "masseter", "treatment": "botox", "x": 0.2, "y": 0.7, "amount": 10, "point_key": "inferior_anterior"},
            {"region": "platisma", "treatment": "botox", "x": 0.3, "y": 0.9, "amount": 2},  # sem point_key
        ]
    }
    created = client.post(url, json=body, headers=auth)
    assert created.status_code == 201, created.text
    loaded = client.get(f"/api/plans/{created.json()['id']}", headers=auth).json()
    assert {p["region"]: p["point_key"] for p in loaded["points"]} == {
        "glabela": "procero", "masseter": "inferior_anterior", "platisma": ""
    }

    for bad in ("Prócero!", "a" * 41):
        point = {"region": "glabela", "treatment": "botox", "x": 0.5, "y": 0.25, "amount": 4, "point_key": bad}
        assert client.post(url, json={"points": [point]}, headers=auth).status_code == 422


def test_region_key_matches_model_choices():
    # As duas listas de regiões (API e modelo) não podem divergir.
    assert sorted(get_args(RegionKey)) == sorted(Region.values)


def test_plan_photo_must_belong_to_patient(client, auth, patient):
    other = client.post("/api/patients", json={"full_name": "Outro Paciente"}, headers=auth).json()
    photo = client.post(
        f"/api/patients/{other['id']}/photos", files={"file": ("a.png", png_bytes(), "image/png")}, headers=auth
    ).json()
    r = client.post(f"/api/patients/{patient['id']}/plans", json={"photo_id": photo["id"], "points": []}, headers=auth)
    assert r.status_code == 422
