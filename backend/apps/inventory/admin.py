from django.contrib import admin

from .models import Application, Lot, Product

admin.site.register(Product)
admin.site.register(Lot)
admin.site.register(Application)
