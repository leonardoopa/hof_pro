import os
import tempfile

from .settings import *  # noqa: F401,F403

# Execuções paralelas (vários agentes/terminais) usam um arquivo por nome: HOFPRO_TEST_DB=meu.sqlite3
_DB_FILE = os.environ.get("HOFPRO_TEST_DB", "test_db.sqlite3")

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / _DB_FILE,  # noqa: F405
        "TEST": {"NAME": BASE_DIR / _DB_FILE},  # noqa: F405
    }
}
MEDIA_ROOT = tempfile.mkdtemp(prefix="hofpro-media-")
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
