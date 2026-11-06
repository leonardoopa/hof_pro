from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import AnamnesisQuestion, FacialPlan


@admin.register(AnamnesisQuestion)
class AnamnesisQuestionAdmin(KeepRecordsAdmin):
    list_display = ("order", "text", "active")
    list_editable = ("active",)
    ordering = ("order",)


admin.site.register(FacialPlan, KeepRecordsAdmin)
