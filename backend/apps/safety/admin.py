from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import AdverseEvent

admin.site.register(AdverseEvent, KeepRecordsAdmin)
