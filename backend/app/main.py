"""FastAPI entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import cases, contradictions, documents, graph
from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # No-op for now; reserved for connection pool warmup.
    yield


def create_app() -> FastAPI:
    get_settings()  # load/validate .env at startup
    app = FastAPI(title="CS194W Legal Discovery", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(cases.router, prefix="/cases", tags=["cases"])
    app.include_router(documents.router, prefix="/cases", tags=["documents"])
    app.include_router(graph.router, prefix="/cases", tags=["graph"])
    app.include_router(contradictions.router, prefix="/cases", tags=["contradictions"])

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
