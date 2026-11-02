import tempfile

from .settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "test_db.sqlite3",  # noqa: F405
        "TEST": {"NAME": BASE_DIR / "test_db.sqlite3"},  # noqa: F405
    }
}
MEDIA_ROOT = tempfile.mkdtemp(prefix="hofpro-media-")
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
