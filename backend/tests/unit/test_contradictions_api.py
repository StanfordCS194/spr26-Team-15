from __future__ import annotations

from app.api.contradictions import _to_claim_excerpt


def test_to_claim_excerpt_adds_display_metadata() -> None:
    excerpt = _to_claim_excerpt(
        {
            "id": "cl1",
            "value": "2001-03-15",
            "speaker_entity_id": "ent_fastow",
            "source_doc_id": "doc_b",
            "filename": "fastow_deposition_excerpt.txt",
            "chunk_id": "doc_b:0",
            "char_start": 8,
            "char_end": 18,
            "raw_text": "Before 2001-03-15 after",
        },
        {"ent_fastow": "Andrew Fastow"},
    )

    assert excerpt.speaker_entity_id == "ent_fastow"
    assert excerpt.speaker_entity_name == "Andrew Fastow"
    assert excerpt.source_doc_filename == "fastow_deposition_excerpt.txt"
    assert excerpt.excerpt == "Before 2001-03-15 after"
