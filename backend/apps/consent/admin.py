from django.contrib import admin, messages

from apps.audit.retention import KeepRecordsAdmin

from .models import Signature, Term


@admin.register(Term)
class TermAdmin(KeepRecordsAdmin):
    list_display = ("kind", "version", "title", "active", "created_at")
    list_filter = ("kind", "active")
    actions = ["new_version"]

    def get_readonly_fields(self, request, obj=None):
        # Versão já assinada é imutável: o texto assinado precisa continuar o mesmo.
        if obj and obj.signatures.exists():
            return ("kind", "version", "title", "content")
        return ()

    @admin.action(description="Criar nova versão (copia o texto e desativa a anterior)")
    def new_version(self, request, queryset):
        for term in queryset:
            last = Term.objects.filter(kind=term.kind).order_by("-version").first()
            Term.objects.create(kind=term.kind, version=last.version + 1, title=term.title, content=term.content)
            Term.objects.filter(kind=term.kind, version__lte=last.version).update(active=False)
        self.message_user(request, "Nova versão criada. Edite o texto dela.", messages.SUCCESS)


@admin.register(Signature)
class SignatureAdmin(KeepRecordsAdmin):
    list_display = ("patient", "term", "signer_name", "signed_at", "revoked_at")
    readonly_fields = [f.name for f in Signature._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
