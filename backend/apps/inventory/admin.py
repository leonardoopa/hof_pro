from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import Application, Lot, LotMovement, Product

admin.site.register(Product, KeepRecordsAdmin)
admin.site.register(Lot, KeepRecordsAdmin)
admin.site.register(Application, KeepRecordsAdmin)
admin.site.register(LotMovement, KeepRecordsAdmin)
