"""Nada do que o sistema registra pode ser apagado: nem pela API, nem pelo admin, nem pelo ORM."""
import pytest
from django.apps import apps
from django.contrib import admin
from django.db.models import ProtectedError
from django.db.models.signals import pre_delete
from django.test import RequestFactory

from api.main import create_app
from apps.accounts.models import User
from apps.audit.retention import NOT_PROTECTED
from apps.patients.models import Patient

pytestmark = pytest.mark.django_db(transaction=True)


def our_models():
    return [m for m in apps.get_models() if m.__module__.startswith("apps.")]


def test_api_has_no_delete_route():
    paths = create_app().openapi()["paths"]
    assert "post" in paths["/api/patients/{patient_id}/archive"]  # o esquema enxerga as rotas dos routers
    assert [path for path, methods in paths.items() if "delete" in methods] == []


def test_admin_offers_no_delete():
    request = RequestFactory().get("/")
    request.user = User(is_active=True, is_superuser=True)
    admins = [a for a in admin.site._registry.values() if a.model.__module__.startswith("apps.")]
    assert admins
    assert [a.model.__name__ for a in admins if a.has_delete_permission(request)] == []


def test_every_model_is_protected_except_the_listed_ones():
    assert {m._meta.label for m in our_models() if not pre_delete.has_listeners(m)} == NOT_PROTECTED


def test_orm_refuses_instance_bulk_and_cascade_delete(client, auth, patient):
    record = Patient.objects.get(pk=patient["id"])
    owner = record.owner
    for attempt in (record.delete, Patient.objects.all().delete, owner.delete):
        with pytest.raises(ProtectedError):
            attempt()
    assert Patient.objects.filter(pk=record.pk).exists() and User.objects.filter(pk=owner.pk).exists()
