from django.contrib import admin

from .models import AnamnesisQuestion, FacialPlan


@admin.register(AnamnesisQuestion)
class AnamnesisQuestionAdmin(admin.ModelAdmin):
    list_display = ("order", "text", "active")
    list_editable = ("active",)
    ordering = ("order",)


admin.site.register(FacialPlan)
