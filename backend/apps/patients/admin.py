from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import Patient, PatientPhoto

admin.site.register(Patient, KeepRecordsAdmin)
admin.site.register(PatientPhoto, KeepRecordsAdmin)
