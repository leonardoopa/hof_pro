from django.contrib import admin

from .models import Orientacao


@admin.register(Orientacao)
class OrientacaoAdmin(admin.ModelAdmin):
    list_display = ("treatment", "title", "order", "active", "updated_at")
    list_editable = ("order", "active")
    list_filter = ("treatment", "active")
    search_fields = ("title", "text")
