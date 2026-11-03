import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Espera o SQL Server aceitar conexões e cria o banco do projeto se ele ainda não existir."

    def add_arguments(self, parser):
        parser.add_argument("--retries", type=int, default=60)
        parser.add_argument("--delay", type=float, default=2.0)

    def handle(self, *args, retries, delay, **options):
        cfg = settings.DATABASES["default"]
        if "mssql" not in cfg["ENGINE"]:
            self.stdout.write("Banco não é SQL Server; nada a fazer.")
            return

        import pyodbc

        opts = cfg["OPTIONS"]
        conn_str = (
            f"DRIVER={{{opts['driver']}}};SERVER={cfg['HOST']},{cfg['PORT']};DATABASE=master;"
            f"UID={cfg['USER']};PWD={cfg['PASSWORD']};{opts.get('extra_params', '')}"
        )

        last_error = None
        for attempt in range(1, retries + 1):
            try:
                conn = pyodbc.connect(conn_str, autocommit=True, timeout=5)
                break
            except pyodbc.Error as exc:
                last_error = exc
                self.stdout.write(f"Aguardando SQL Server ({attempt}/{retries})…")
                time.sleep(delay)
        else:
            raise CommandError(f"SQL Server indisponível: {last_error}")

        name = cfg["NAME"]
        with conn:
            cursor = conn.cursor()
            if cursor.execute("SELECT DB_ID(?)", name).fetchval() is None:
                cursor.execute(f"CREATE DATABASE [{name.replace(']', ']]')}]")
                self.stdout.write(self.style.SUCCESS(f"Banco '{name}' criado."))
            else:
                self.stdout.write(f"Banco '{name}' já existe.")
