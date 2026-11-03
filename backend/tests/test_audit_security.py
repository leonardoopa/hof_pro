import pytest

from apps.audit.models import AccessLog
from tests.conftest import png_bytes, register

pytestmark = pytest.mark.django_db(transaction=True)


def _login(client, password, email="ana@clinica.com"):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_login_rate_limit_blocks_after_five_failures(client):
    register(client)
    for _ in range(5):
        assert _login(client, "errada").status_code == 401
    blocked = _login(client, "errada")
    assert blocked.status_code == 429
    assert "Muitas tentativas" in blocked.json()["detail"] and blocked.headers["retry-after"]
    # mesmo com a senha certa continua bloqueado; outro e-mail não é afetado
    assert _login(client, "Senha-forte-123").status_code == 429
    register(client, email="bruno@clinica.com")
    assert _login(client, "Senha-forte-123", email="bruno@clinica.com").status_code == 200


def test_login_success_resets_counter(client):
    register(client)
    for _ in range(4):
        assert _login(client, "errada").status_code == 401
    assert _login(client, "Senha-forte-123").status_code == 200
    for _ in range(5):
        assert _login(client, "errada").status_code == 401


def test_anonymized_patient_cannot_be_patched(client, auth, patient):
    pid = patient["id"]
    client.post(f"/api/patients/{pid}/photos", files={"file": ("f.png", png_bytes(), "image/png")}, headers=auth)
    r = client.post(f"/api/patients/{pid}/anonymize", headers=auth)
    assert r.status_code == 200
    out = r.json()
    assert out["anonymized_at"] and out["full_name"].startswith("Paciente anonimizado") and out["email"] == ""
    assert client.get(f"/api/patients/{pid}/photos", headers=auth).json() == []

    assert client.patch(f"/api/patients/{pid}", json={"full_name": "Fulana"}, headers=auth).status_code == 409
    assert client.get(f"/api/patients/{pid}", headers=auth).json()["full_name"].startswith("Paciente anonimizado")
    # idempotente: segunda chamada não duplica o registro de auditoria
    assert client.post(f"/api/patients/{pid}/anonymize", headers=auth).status_code == 200
    assert AccessLog.objects.filter(action="anonimizar").count() == 1


def test_audit_trail_records_sensitive_access(client, auth, other_auth, patient):
    pid = patient["id"]
    photo = client.post(f"/api/patients/{pid}/photos", files={"file": ("f.png", png_bytes(), "image/png")}, headers=auth).json()
    assert client.get(f"/api/photos/{photo['id']}/file", headers=auth).status_code == 200
    # acesso negado (de outro usuário) não gera registro
    assert client.get(f"/api/photos/{photo['id']}/file", headers=other_auth).status_code == 404
    assert client.delete(f"/api/patients/{pid}", headers=auth).status_code == 204

    logs = client.get("/api/audit", headers=auth).json()
    assert [(l["action"], l["resource"], l["resource_id"]) for l in logs] == [
        ("excluir", "paciente", pid),
        ("visualizar", "foto", photo["id"]),
    ]
    assert logs[0]["ip_address"]
    assert client.get("/api/audit", headers=other_auth).json() == []
    assert client.get("/api/audit").status_code == 401
