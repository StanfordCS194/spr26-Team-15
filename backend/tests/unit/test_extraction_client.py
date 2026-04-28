"""Tests for the extraction client with mocked API responses.

We don't hit the real Claude API here — live calls live under pytest -m live.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from app.extraction.client import (
    ExtractionClient,
    ExtractionValidationError,
)
from app.models.extraction import (
    Entity,
    EntityType,
    ExtractionResult,
    Provenance,
    Relation,
    RelationType,
)


def _make_response(result: ExtractionResult, cache_read: int = 0, cache_creation: int = 0):
    """Build a mock object that quacks like anthropic's parse() response."""
    resp = MagicMock()
    resp.parsed_output = result
    resp.stop_reason = "end_turn"
    resp.usage.input_tokens = 100
    resp.usage.output_tokens = 500
    resp.usage.cache_read_input_tokens = cache_read
    resp.usage.cache_creation_input_tokens = cache_creation
    return resp


def _prov(start: int, end: int, doc_id: str = "doc1", chunk_id: str = "doc1:0") -> Provenance:
    return Provenance(source_doc_id=doc_id, chunk_id=chunk_id, char_start=start, char_end=end)


def test_happy_path() -> None:
    result = ExtractionResult(
        entities=[
            Entity(id="e1", type=EntityType.PERSON, mention_text="Alice", provenance=_prov(0, 5)),
            Entity(id="e2", type=EntityType.ORGANIZATION, mention_text="Acme", provenance=_prov(10, 14)),
        ],
        relations=[
            Relation(
                id="r1",
                type=RelationType.EMPLOYS,
                subject_id="e2",
                object_id="e1",
                provenance=_prov(0, 14),
            )
        ],
    )
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = _make_response(result, cache_read=500)

    ec = ExtractionClient(client=mock_client, model="claude-sonnet-4-6")
    outcome = ec.extract(
        chunk_text="Alice at Acme Corp.",
        source_doc_id="doc1",
        chunk_id="doc1:0",
        char_offset_in_doc=0,
    )

    assert outcome.result == result
    assert outcome.repair_attempts == 0
    assert outcome.usage.cache_read_input_tokens == 500
    assert mock_client.messages.parse.call_count == 1


def test_dangling_reference_triggers_repair() -> None:
    # First response: relation references missing entity.
    bad = ExtractionResult(
        entities=[
            Entity(id="e1", type=EntityType.PERSON, mention_text="Alice", provenance=_prov(0, 5))
        ],
        relations=[
            Relation(
                id="r1",
                type=RelationType.EMPLOYS,
                subject_id="ghost",
                object_id="e1",
                provenance=_prov(0, 5),
            )
        ],
    )
    # Second response (repair): clean.
    good = ExtractionResult(
        entities=[
            Entity(id="e1", type=EntityType.PERSON, mention_text="Alice", provenance=_prov(0, 5))
        ]
    )

    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [_make_response(bad), _make_response(good)]

    ec = ExtractionClient(client=mock_client)
    outcome = ec.extract(
        chunk_text="Alice at Acme",
        source_doc_id="doc1",
        chunk_id="doc1:0",
        char_offset_in_doc=0,
        max_repair_attempts=1,
    )

    assert outcome.result == good
    assert outcome.repair_attempts == 1
    assert mock_client.messages.parse.call_count == 2


def test_out_of_bounds_offsets_flagged() -> None:
    bad = ExtractionResult(
        entities=[
            # chunk is only 13 chars; end=99 is out of bounds
            Entity(id="e1", type=EntityType.PERSON, mention_text="X", provenance=_prov(0, 99))
        ]
    )
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = _make_response(bad)

    ec = ExtractionClient(client=mock_client)
    with pytest.raises(ExtractionValidationError, match="outside chunk"):
        ec.extract(
            chunk_text="Alice at Acme",
            source_doc_id="doc1",
            chunk_id="doc1:0",
            char_offset_in_doc=0,
            max_repair_attempts=0,
        )


def test_wrong_chunk_id_flagged() -> None:
    bad = ExtractionResult(
        entities=[
            Entity(
                id="e1",
                type=EntityType.PERSON,
                mention_text="X",
                provenance=Provenance(
                    source_doc_id="doc1", chunk_id="WRONG", char_start=0, char_end=5
                ),
            )
        ]
    )
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = _make_response(bad)

    ec = ExtractionClient(client=mock_client)
    with pytest.raises(ExtractionValidationError, match="wrong chunk_id"):
        ec.extract(
            chunk_text="Alice at Acme",
            source_doc_id="doc1",
            chunk_id="doc1:0",
            char_offset_in_doc=0,
            max_repair_attempts=0,
        )


def test_none_parsed_output_raises() -> None:
    mock_client = MagicMock()
    resp = MagicMock()
    resp.parsed_output = None
    resp.stop_reason = "refusal"
    resp.usage.input_tokens = 10
    resp.usage.output_tokens = 0
    resp.usage.cache_read_input_tokens = 0
    resp.usage.cache_creation_input_tokens = 0
    mock_client.messages.parse.return_value = resp

    ec = ExtractionClient(client=mock_client)
    with pytest.raises(ExtractionValidationError, match="refusal"):
        ec.extract(
            chunk_text="x",
            source_doc_id="doc1",
            chunk_id="doc1:0",
            char_offset_in_doc=0,
            max_repair_attempts=0,
        )


def test_schema_validation_error_triggers_repair() -> None:
    # First call raises ValidationError (parse failure); second returns valid.
    good = ExtractionResult(
        entities=[
            Entity(id="e1", type=EntityType.PERSON, mention_text="x", provenance=_prov(0, 1))
        ]
    )
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        ValidationError.from_exception_data("ExtractionResult", []),
        _make_response(good),
    ]

    ec = ExtractionClient(client=mock_client)
    outcome = ec.extract(
        chunk_text="x",
        source_doc_id="doc1",
        chunk_id="doc1:0",
        char_offset_in_doc=0,
        max_repair_attempts=1,
    )
    assert outcome.result == good
    assert outcome.repair_attempts == 1
