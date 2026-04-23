"""LLM client for entity/relation/claim/event extraction.

Provider is selected via LLM_PROVIDER in .env (anthropic | groq). See app/llm.py.

Design choices:
- Each provider's parse() does schema validation natively (Anthropic via messages.parse,
  Groq via model_validate_json). If the response doesn't match the schema, a Pydantic
  ValidationError is raised and the repair loop re-prompts once.
- Prompt caching is on for Anthropic. Groq ignores cache_control silently.
- Retries: SDK handles 429/5xx automatically. Tenacity adds bounded retries for transient
  provider errors (APIConnectionError, InternalServerError, RateLimitError).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from pydantic import ValidationError
from tenacity import Retrying, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import get_settings
from app.extraction.prompts import FEW_SHOT_EXAMPLES, SYSTEM_PROMPT, build_user_message
from app.llm import LLMParseError, LLMUsage, AnthropicProvider, GroqProvider, make_provider
from app.models.extraction import ExtractionResult

logger = logging.getLogger(__name__)

MAX_OUTPUT_TOKENS = 2000

# Alias kept so pipeline.py and tests can import ExtractionUsage from here unchanged.
ExtractionUsage = LLMUsage


@dataclass(frozen=True)
class ExtractionOutcome:
    result: ExtractionResult
    usage: ExtractionUsage
    model: str
    repair_attempts: int


class ExtractionValidationError(RuntimeError):
    """Raised when the model's output passes schema validation but fails semantic checks
    (dangling entity references, offsets outside the chunk, etc.)."""


class ExtractionClient:
    def __init__(
        self,
        client=None,
        model: str | None = None,
        provider: AnthropicProvider | GroqProvider | None = None,
    ) -> None:
        s = get_settings()
        if provider is not None:
            self._provider = provider
        elif client is not None:
            # Legacy injection path used by tests: wrap a bare Anthropic client.
            self._provider = AnthropicProvider(
                api_key="", model=model or s.extraction_model, _client=client
            )
        else:
            self._provider = make_provider(s)
            if model:
                self._provider.model = model
        self._model = self._provider.model

    def extract(
        self,
        *,
        chunk_text: str,
        source_doc_id: str,
        chunk_id: str,
        char_offset_in_doc: int,
        max_repair_attempts: int = 2,
    ) -> ExtractionOutcome:
        """Extract structured facts from a single chunk.

        On semantic validation failure (dangling refs, bad offsets), we re-prompt once with a
        repair message pointing at the specific problem. That usually fixes it.
        """
        user_message = build_user_message(chunk_text, source_doc_id, chunk_id, char_offset_in_doc)
        conversation: list[dict] = [
            *FEW_SHOT_EXAMPLES,
            {"role": "user", "content": user_message},
        ]

        for attempt in range(max_repair_attempts + 1):
            try:
                result, usage = self._call_api(conversation)
            except ValidationError as e:
                logger.warning("extraction schema validation failed on attempt %d: %s", attempt, e)
                if attempt >= max_repair_attempts:
                    raise
                conversation = conversation + [
                    {
                        "role": "user",
                        "content": (
                            "Your previous response did not match the required schema. "
                            f"Error: {e}. Produce a new response that strictly matches the schema. "
                            "Do not include any text outside the JSON object."
                        ),
                    }
                ]
                continue

            semantic_errors = self._validate_semantics(result, chunk_text, source_doc_id, chunk_id)
            if not semantic_errors:
                return ExtractionOutcome(
                    result=result, usage=usage, model=self._model, repair_attempts=attempt
                )

            logger.warning(
                "extraction semantic validation failed on attempt %d: %s",
                attempt,
                semantic_errors,
            )
            if attempt >= max_repair_attempts:
                raise ExtractionValidationError("; ".join(semantic_errors))

            conversation = conversation + [
                {
                    "role": "user",
                    "content": (
                        "Your previous extraction had the following problems:\n"
                        + "\n".join(f"- {e}" for e in semantic_errors)
                        + "\nEmit a corrected extraction. Every referenced entity must be declared, "
                        "and every provenance char_start/char_end must fall within [0, "
                        f"{len(chunk_text)}] of the chunk."
                    ),
                }
            ]

        raise ExtractionValidationError("extraction failed after all repair attempts")

    def _call_api(self, messages: list[dict]) -> tuple[ExtractionResult, ExtractionUsage]:
        def _once() -> tuple[ExtractionResult, ExtractionUsage]:
            try:
                parsed, usage = self._provider.parse(
                    messages, SYSTEM_PROMPT, ExtractionResult, MAX_OUTPUT_TOKENS
                )
            except LLMParseError as e:
                raise ExtractionValidationError(str(e)) from e
            return parsed, ExtractionUsage(
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_read_input_tokens=usage.cache_read_input_tokens,
                cache_creation_input_tokens=usage.cache_creation_input_tokens,
            )

        return Retrying(
            reraise=True,
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=2, max=30),
            retry=retry_if_exception_type(self._provider.retry_exceptions),
        )(_once)

    @staticmethod
    def _validate_semantics(
        result: ExtractionResult, chunk_text: str, source_doc_id: str, chunk_id: str
    ) -> list[str]:
        """Catch issues Pydantic can't: dangling refs, offsets outside the chunk, wrong doc IDs."""
        errors: list[str] = result.validate_references()
        n = len(chunk_text)

        def _check_prov(label: str, prov) -> None:
            if prov.source_doc_id != source_doc_id:
                errors.append(f"{label} has wrong source_doc_id {prov.source_doc_id!r}")
            if prov.chunk_id != chunk_id:
                errors.append(f"{label} has wrong chunk_id {prov.chunk_id!r}")
            if prov.char_start < 0 or prov.char_end > n:
                errors.append(
                    f"{label} provenance [{prov.char_start}, {prov.char_end}] "
                    f"outside chunk of length {n}"
                )

        for e in result.entities:
            _check_prov(f"entity {e.id}", e.provenance)
        for r in result.relations:
            _check_prov(f"relation {r.id}", r.provenance)
        for c in result.claims:
            _check_prov(f"claim {c.id}", c.provenance)
        for ev in result.events:
            _check_prov(f"event {ev.id}", ev.provenance)
        return errors
