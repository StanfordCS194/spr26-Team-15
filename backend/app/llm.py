"""LLM provider abstraction.

Supports Anthropic (default) and Groq. Set LLM_PROVIDER=groq in .env to switch.
Add a provider by implementing parse() + retry_exceptions + model, then register in make_provider().
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, TypeVar

from pydantic import BaseModel

if TYPE_CHECKING:
    from app.config import Settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_FENCE_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)


@dataclass(frozen=True)
class LLMUsage:
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


class LLMParseError(RuntimeError):
    """LLM returned no parseable output (refusal, empty response, etc.)."""


def _strip_fences(text: str) -> str:
    m = _FENCE_RE.match(text.strip())
    return m.group(1) if m else text


class AnthropicProvider:
    def __init__(self, api_key: str, model: str, *, _client=None) -> None:
        import anthropic as _lib

        self._lib = _lib
        self._client = _client if _client is not None else _lib.Anthropic(api_key=api_key)
        self.model = model

    @property
    def retry_exceptions(self) -> tuple[type[Exception], ...]:
        return (
            self._lib.APIConnectionError,
            self._lib.InternalServerError,
            self._lib.RateLimitError,
        )

    def parse(
        self,
        messages: list[dict],
        system: str,
        output_format: type[T],
        max_tokens: int,
    ) -> tuple[T, LLMUsage]:
        response = self._client.messages.parse(
            model=self.model,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
            output_format=output_format,
        )
        if response.stop_reason == "max_tokens":
            raise LLMParseError(
                f"response truncated at max_tokens={max_tokens}; raise "
                "EXTRACTION_MAX_OUTPUT_TOKENS — the JSON did not fit in the output budget"
            )
        parsed = response.parsed_output
        if parsed is None:
            raise LLMParseError(
                f"model returned no parsed output; stop_reason={response.stop_reason}"
            )
        return (
            parsed,  # type: ignore[return-value]
            LLMUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                cache_read_input_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
                cache_creation_input_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
            ),
        )


class GroqProvider:
    def __init__(self, api_key: str, model: str) -> None:
        try:
            import groq as _lib
        except ImportError as e:
            raise ImportError(
                "groq package is required for LLM_PROVIDER=groq. "
                "Install it with: pip install 'cs194w-backend[groq]'"
            ) from e
        self._lib = _lib
        self._client = _lib.Groq(api_key=api_key)
        self.model = model
        self._use_json_schema: bool | None = None  # discovered on first call

    @property
    def retry_exceptions(self) -> tuple[type[Exception], ...]:
        return (
            self._lib.APIConnectionError,
            self._lib.InternalServerError,
            self._lib.RateLimitError,
        )

    def _call(self, messages: list[dict], output_format: type[T], max_tokens: int):
        """Try json_schema mode; fall back to json_object if the model doesn't support it."""
        if self._use_json_schema is not False:
            try:
                resp = self._client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    max_tokens=max_tokens,
                    response_format={
                        "type": "json_schema",
                        "json_schema": {
                            "name": output_format.__name__,
                            "schema": output_format.model_json_schema(),
                        },
                    },
                )
                self._use_json_schema = True
                return resp
            except self._lib.BadRequestError as e:
                if "json_schema" not in str(e):
                    raise
                logger.info("model %s does not support json_schema; falling back to json_object", self.model)
                self._use_json_schema = False

        return self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )

    def parse(
        self,
        messages: list[dict],
        system: str,
        output_format: type[T],
        max_tokens: int,
    ) -> tuple[T, LLMUsage]:
        full_messages = [{"role": "system", "content": system}, *messages]
        response = self._call(full_messages, output_format, max_tokens)
        content = response.choices[0].message.content or ""
        content = _strip_fences(content)
        parsed = output_format.model_validate_json(content)
        return (
            parsed,  # type: ignore[return-value]
            LLMUsage(
                input_tokens=response.usage.prompt_tokens,
                output_tokens=response.usage.completion_tokens,
            ),
        )


def make_provider(settings: Settings) -> AnthropicProvider | GroqProvider:
    provider = settings.llm_provider.lower()
    if provider == "groq":
        if not settings.groq_api_key:
            raise ValueError("GROQ_API_KEY must be set when LLM_PROVIDER=groq")
        return GroqProvider(api_key=settings.groq_api_key, model=settings.groq_extraction_model)
    if provider == "anthropic":
        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY must be set when LLM_PROVIDER=anthropic")
        return AnthropicProvider(api_key=settings.anthropic_api_key, model=settings.extraction_model)
    raise ValueError(f"Unknown LLM_PROVIDER {settings.llm_provider!r}. Choose 'anthropic' or 'groq'.")
