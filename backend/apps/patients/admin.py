from django.contrib import admin

from .models import Patient, PatientPhoto

admin.site.register(Patient)
admin.site.register(PatientPhoto)
