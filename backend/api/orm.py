"""Ponte FastAPI <-> Django ORM.

Toda chamada ao ORM roda via sync_to_async (thread_sensitive), ou seja, sempre na mesma
thread. Assim close_old_connections() no início/fim de cada request age na mesma conexão
que os endpoints usam, como acontece no handler ASGI do próprio Django.
"""

from functools import wraps

from asgiref.sync import sync_to_async
from django.db import close_old_connections

run = sync_to_async


def orm(fn):
    """Transforma uma função síncrona (que usa ORM) em endpoint async, mantendo a assinatura."""

    @wraps(fn)
    async def wrapper(*args, **kwargs):
        return await sync_to_async(fn)(*args, **kwargs)

    return wrapper


class DbConnectionMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        await sync_to_async(close_old_connections)()
        try:
            await self.app(scope, receive, send)
        finally:
            await sync_to_async(close_old_connections)()
