from django.core.management.base import BaseCommand, CommandError

from apps.accounts.demo import seed_demo
from apps.accounts.models import User


class Command(BaseCommand):
    help = "Cria dados de demonstração (marcados '(Demo)') para um usuário. Idempotente."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="E-mail do profissional que receberá os dados.")

    def handle(self, *args, email, **options):
        user = User.objects.filter(email__iexact=email.strip()).first()
        if user is None:
            raise CommandError(f"Usuário não encontrado: {email}")
        if seed_demo(user):
            self.stdout.write(self.style.SUCCESS(f"Dados de demonstração criados para {user.email}."))
        else:
            self.stdout.write("Dados de demonstração já existem; nada a fazer.")
