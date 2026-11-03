from django.conf import settings
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .orm import DbConnectionMiddleware
from .routers import anamnesis, auth, consent, guidance, inventory, patients, plans


def create_app(django_app=None) -> FastAPI:
    app = FastAPI(title="HOF PRO API", version="0.1.0")

    # O último middleware adicionado fica mais externo: CORS responde antes de tudo.
    app.add_middleware(DbConnectionMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api = APIRouter(prefix="/api")
    for module in (auth, patients, anamnesis, plans, guidance, inventory, consent):
        api.include_router(module.router)

    @api.get("/health", tags=["infra"])
    async def health():
        return {"status": "ok"}

    app.include_router(api)

    if django_app is not None:
        app.mount("/", django_app)  # admin e estáticos do Django; precisa ser o último
    return app
