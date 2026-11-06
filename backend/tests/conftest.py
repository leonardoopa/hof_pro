import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from api import ratelimit
from api.main import create_app
from apps.clinical.models import AnamnesisQuestion

# O banco de teste é limpo ao fim de cada teste (transaction=True), inclusive as perguntas semeadas
# pela migration; os testes que precisam de perguntas usam a fixture `questions`.
pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _reset_login_rate_limit():
    ratelimit.reset()
    yield
    ratelimit.reset()


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def questions():
    AnamnesisQuestion.objects.all().delete()  # no primeiro teste da sessão, as semeadas ainda estão no banco
    return [
        AnamnesisQuestion.objects.create(key="alergias", text="Possui alergias?", order=1),
        AnamnesisQuestion.objects.create(key="fumante", text="É fumante?", order=2),
    ]


def register(client, email="ana@clinica.com", password="Senha-forte-123"):
    r = client.post(
        "/api/auth/register",
        json={"full_name": "Ana Souza", "email": email, "password": password, "professional_title": "Dentista"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def auth(client):
    return register(client)


@pytest.fixture
def other_auth(client):
    return register(client, email="bruno@clinica.com")


@pytest.fixture
def patient(client, auth):
    r = client.post("/api/patients", json={"full_name": "Maria Paciente"}, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def png_bytes(size=(60, 80), color=(200, 160, 140)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()
