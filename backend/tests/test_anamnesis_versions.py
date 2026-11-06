"""Cada alteração salva da anamnese vira uma versão, e nenhuma versão muda depois."""
import pytest
from django.db.models import ProtectedError

from apps.clinical.models import Anamnesis, AnamnesisVersion, AnamnesisVersionAnswer

pytestmark = pytest.mark.django_db(transaction=True)


def yes(question, detail):
    return {"question_id": question.id, "answer": True, "detail": detail}


def no(question):
    return {"question_id": question.id, "answer": False}


@pytest.fixture
def url(patient):
    return f"/api/patients/{patient['id']}/anamnesis"


def test_each_saved_change_becomes_a_version_and_older_ones_stay_as_they_were(client, auth, url, questions):
    alergia, fumante = questions
    assert client.get(f"{url}/versions", headers=auth).json() == []
    assert client.get(url, headers=auth).json()["version"] is None

    saved = client.put(url, json={"notes": "Primeira", "answers": [no(alergia), yes(fumante, "10 por dia")]}, headers=auth).json()
    assert saved["version"] == 1
    first = {
        "number": 1,
        "notes": "Primeira",
        "saved_by": "Ana Souza",
        "saved_at": saved["updated_at"],
        "answers": [
            {"question_id": alergia.id, "question_text": "Possui alergias?", "answer": False, "detail": ""},
            {"question_id": fumante.id, "question_text": "É fumante?", "answer": True, "detail": "10 por dia"},
        ],
    }
    assert client.get(f"{url}/versions", headers=auth).json() == [first]

    saved = client.put(url, json={"notes": "Segunda", "answers": [yes(alergia, "Dipirona"), no(fumante)]}, headers=auth).json()
    assert saved["version"] == 2
    latest, oldest = client.get(f"{url}/versions", headers=auth).json()
    assert oldest == first
    assert (latest["number"], latest["notes"], latest["saved_at"]) == (2, "Segunda", saved["updated_at"])
    assert [(a["answer"], a["detail"]) for a in latest["answers"]] == [(True, "Dipirona"), (False, "")]

    current = client.get(url, headers=auth).json()
    assert (current["notes"], current["version"]) == ("Segunda", 2)


def test_saving_the_same_content_creates_no_version(client, auth, url, questions):
    alergia, fumante = questions
    saved = client.put(url, json={"notes": "Obs", "answers": [yes(alergia, "Dipirona"), no(fumante)]}, headers=auth).json()

    # Outra ordem, espaços na descrição e descrição em resposta "Não" não mudam o conteúdo.
    same = [{**no(fumante), "detail": "ignorado"}, yes(alergia, "  Dipirona ")]
    assert client.put(url, json={"notes": "Obs", "answers": same}, headers=auth).json() == saved

    # Qualquer diferença real vira versão, até só uma resposta a menos.
    for number, body in enumerate(
        (
            {"notes": "Outra", "answers": same},
            {"notes": "Outra", "answers": [yes(alergia, "Penicilina"), no(fumante)]},
            {"notes": "Outra", "answers": [no(alergia), no(fumante)]},
            {"notes": "Outra", "answers": [no(alergia)]},
        ),
        start=2,
    ):
        assert client.put(url, json=body, headers=auth).json()["version"] == number


def test_first_save_creates_a_version_even_when_blank(client, auth, url, questions):
    assert client.put(url, json={"answers": []}, headers=auth).json()["version"] == 1
    assert client.put(url, json={"answers": []}, headers=auth).json()["version"] == 1


def test_version_keeps_the_question_as_it_was_asked(client, auth, url, questions):
    alergia, fumante = questions
    client.put(url, json={"answers": [no(alergia), no(fumante)]}, headers=auth)

    alergia.text = "Tem alguma alergia?"
    alergia.save()
    fumante.active = False
    fumante.save()
    client.put(url, json={"answers": [yes(alergia, "Dipirona")]}, headers=auth)

    latest, oldest = client.get(f"{url}/versions", headers=auth).json()
    assert [a["question_text"] for a in latest["answers"]] == ["Tem alguma alergia?"]
    assert [a["question_text"] for a in oldest["answers"]] == ["Possui alergias?", "É fumante?"]


def test_rejected_save_creates_no_version(client, auth, url, questions):
    alergia, _ = questions
    client.put(url, json={"notes": "Obs", "answers": [no(alergia)]}, headers=auth)
    for answers in ([{"question_id": alergia.id, "answer": True}], [{"question_id": 999999, "answer": False}]):
        assert client.put(url, json={"notes": "Outra", "answers": answers}, headers=auth).status_code == 422
    versions = client.get(f"{url}/versions", headers=auth).json()
    assert [(v["number"], v["notes"]) for v in versions] == [(1, "Obs")]
    assert client.get(url, headers=auth).json()["notes"] == "Obs"


def test_only_the_owner_reads_the_versions(client, auth, other_auth, url, questions):
    client.put(url, json={"answers": [no(questions[0])]}, headers=auth)
    assert client.get(f"{url}/versions", headers=other_auth).status_code == 404
    assert client.get(f"{url}/versions").status_code == 401


def test_versions_cannot_be_deleted(client, auth, url, questions):
    # Versão sem respostas: nenhuma FK PROTECT segura a exclusão, só a guarda de retenção.
    client.put(url, json={"answers": []}, headers=auth)
    with pytest.raises(ProtectedError):
        AnamnesisVersion.objects.all().delete()

    client.put(url, json={"answers": [no(questions[0])]}, headers=auth)
    for model in (AnamnesisVersionAnswer, Anamnesis):
        with pytest.raises(ProtectedError):
            model.objects.all().delete()
    assert (AnamnesisVersion.objects.count(), AnamnesisVersionAnswer.objects.count()) == (2, 1)


def test_demo_patient_starts_with_a_version_and_the_first_edit_keeps_it(client, auth, questions):
    assert client.post("/api/demo", headers=auth).json() == {"created": True}
    url = f"/api/patients/{client.get('/api/patients', headers=auth).json()[0]['id']}/anamnesis"
    alergia, fumante = questions

    first = client.get(f"{url}/versions", headers=auth).json()
    assert [(v["number"], v["saved_by"], len(v["answers"])) for v in first] == [(1, "Ana Souza", 2)]

    saved = client.put(url, json={"answers": [yes(alergia, "Dipirona"), no(fumante)]}, headers=auth).json()
    assert saved["version"] == 2
    assert client.get(f"{url}/versions", headers=auth).json()[1:] == first
