from django.contrib import admin

from .models import AccessLog


@admin.register(AccessLog)
class AccessLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "action", "resource", "resource_id", "ip_address")
    list_filter = ("action", "resource")
