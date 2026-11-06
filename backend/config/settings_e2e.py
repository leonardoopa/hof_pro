"""Testes de navegador (frontend/e2e): banco e fotos descartáveis, nunca os de desenvolvimento."""

import os
from pathlib import Path

from .settings import *  # noqa: F401,F403

_data = Path(os.environ["E2E_DATA_DIR"])

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": _data / "db.sqlite3",
    }
}
MEDIA_ROOT = _data / "media"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
