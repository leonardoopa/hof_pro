from django.contrib import admin

from .models import AccessLog
from .retention import KeepRecordsAdmin


@admin.register(AccessLog)
class AccessLogAdmin(KeepRecordsAdmin):
    list_display = ("created_at", "user", "action", "resource", "resource_id", "ip_address")
    list_filter = ("action", "resource")
