"""Anthropic client for entity/relation/claim/event extraction.

Design choices:
- Uses `client.messages.parse(output_format=ExtractionResult)` for native Pydantic validation.
  This is more reliable than post-hoc JSON parsing — if the response doesn't match the schema,
  the SDK raises. We still layer our own semantic validation (dangling references, offsets).
- Prompt caching is on. System prompt, schema (implicit via output_format), and few-shot
  examples sit before the last cache_control breakpoint. The per-chunk user message goes after.
- Retries: SDK handles 429/5xx automatically. We add our own bounded retry for validation
  failures (dangling entity references, bad offsets).
- Model: defaults to Sonnet 4.6 per app config. Switchable for cost experimentation.

See claude-api skill (shared/prompt-caching.md, python/claude-api/tool-use.md §Structured Outputs).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import anthropic
from anthropic import Anthropic
from pydantic import ValidationError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings
from app.extraction.prompts import FEW_SHOT_EXAMPLES, SYSTEM_PROMPT, build_user_message
from app.models.extraction import ExtractionResult

logger = logging.getLogger(__name__)

MAX_OUTPUT_TOKENS = 8000


@dataclass(frozen=True)
class ExtractionUsage:
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int


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
    def __init__(self, client: Anthropic | None = None, model: str | None = None):
        s = get_settings()
        self._client = client or Anthropic(api_key=s.anthropic_api_key)
        self._model = model or s.extraction_model

    def extract(
        self,
        *,
        chunk_text: str,
        source_doc_id: str,
        chunk_id: str,
        char_offset_in_doc: int,
        max_repair_attempts: int = 1,
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
                # Schema validation failed. Feed the error back and try again.
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

        # Should be unreachable
        raise ExtractionValidationError("extraction failed after all repair attempts")

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type(
            (anthropic.APIConnectionError, anthropic.InternalServerError, anthropic.RateLimitError)
        ),
    )
    def _call_api(self, messages: list[dict]) -> tuple[ExtractionResult, ExtractionUsage]:
        """One API call with SDK-native Pydantic parsing. Tenacity handles transient errors
        beyond what the SDK's built-in retries cover."""
        response = self._client.messages.parse(
            model=self._model,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=messages,
            output_format=ExtractionResult,
        )

        parsed = response.parsed_output
        if parsed is None:
            # Could be a refusal; surface it clearly.
            raise ExtractionValidationError(
                f"model returned no parsed output; stop_reason={response.stop_reason}"
            )

        usage = ExtractionUsage(
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cache_read_input_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            cache_creation_input_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
        )
        return parsed, usage

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
