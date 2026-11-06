from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import Orientacao


@admin.register(Orientacao)
class OrientacaoAdmin(KeepRecordsAdmin):
    list_display = ("treatment", "title", "order", "active", "updated_at")
    list_editable = ("order", "active")
    list_filter = ("treatment", "active")
    search_fields = ("title", "text")
