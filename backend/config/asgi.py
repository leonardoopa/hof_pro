"""Entrada ASGI: FastAPI atende /api e /docs; o resto (admin, static) cai no Django."""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.conf import settings  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402

django_app = get_asgi_application()  # chama django.setup()

if settings.DEBUG:
    from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler

    django_app = ASGIStaticFilesHandler(django_app)

from api.main import create_app  # noqa: E402  (precisa do Django já configurado)

application = create_app(django_app)
