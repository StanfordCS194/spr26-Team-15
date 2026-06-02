"""Runtime configuration pulled from env vars. Never log these values."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[".env", "backend/.env"],  # works from both repo root (scripts) and backend/ (uvicorn)
        env_file_encoding="utf-8",
        extra="ignore",
    )

    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")

    llm_provider: str = Field(default="anthropic", alias="LLM_PROVIDER")

    neo4j_uri: str = Field(default="bolt://localhost:7687", alias="NEO4J_URI")
    neo4j_user: str = Field(default="neo4j", alias="NEO4J_USER")
    neo4j_password: str = Field(default="changeme_local_only", alias="NEO4J_PASSWORD")

    database_url: str = Field(
        default="postgresql://cs194w:cs194w@localhost:5432/cs194w",
        alias="DATABASE_URL",
    )

    backend_host: str = Field(default="0.0.0.0", alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # Model selection — Anthropic
    extraction_model: str = "claude-sonnet-4-6"
    resolution_model: str = "claude-haiku-4-5-20251001"
    contradiction_explanation_model: str = "claude-haiku-4-5-20251001"

    # Max output tokens for a single extraction call. Must be large enough to hold the full
    # JSON (entities + relations + claims + events with provenance) for one chunk — too low
    # truncates the response mid-string and the repair loop can't recover.
    extraction_max_output_tokens: int = Field(
        default=8000, alias="EXTRACTION_MAX_OUTPUT_TOKENS"
    )

    # Model selection — Groq (override via GROQ_EXTRACTION_MODEL)
    groq_extraction_model: str = Field(
        default="llama-3.3-70b-versatile", alias="GROQ_EXTRACTION_MODEL"
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
