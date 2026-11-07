from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import Appointment

admin.site.register(Appointment, KeepRecordsAdmin)
