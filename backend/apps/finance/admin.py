from django.contrib import admin

from apps.audit.retention import KeepRecordsAdmin

from .models import Budget, BudgetItem, Payment, PriceItem

admin.site.register(PriceItem, KeepRecordsAdmin)
admin.site.register(Budget, KeepRecordsAdmin)
admin.site.register(BudgetItem, KeepRecordsAdmin)
admin.site.register(Payment, KeepRecordsAdmin)
