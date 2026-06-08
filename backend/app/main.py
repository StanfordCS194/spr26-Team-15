"""FastAPI entrypoint."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import cases, contradictions, documents, graph, witness_comparison
from app.config import get_settings
from app.db import init_schema


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_schema()
    yield


def create_app() -> FastAPI:
    get_settings()  # load/validate .env at startup
    app = FastAPI(title="CS194W Legal Discovery", version="0.1.0", lifespan=lifespan)

    local_origin_pattern = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_origin_regex=local_origin_pattern.pattern,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(cases.router, prefix="/cases", tags=["cases"])
    app.include_router(documents.router, prefix="/cases", tags=["documents"])
    app.include_router(graph.router, prefix="/cases", tags=["graph"])
    app.include_router(contradictions.router, prefix="/cases", tags=["contradictions"])
    app.include_router(
        witness_comparison.router, prefix="/cases", tags=["witness-comparison"]
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
