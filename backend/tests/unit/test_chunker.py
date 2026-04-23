from __future__ import annotations

from app.ingestion.chunker import chunk_text


def test_empty_input_returns_no_chunks() -> None:
    assert chunk_text("") == []


def test_short_input_fits_in_one_chunk() -> None:
    text = "A short document."
    chunks = chunk_text(text, target_chars=200, overlap_chars=20)
    assert len(chunks) == 1
    assert chunks[0].char_start == 0
    assert chunks[0].char_end == len(text)
    assert chunks[0].text == text


def test_offsets_reconstruct_source_verbatim() -> None:
    """The load-bearing invariant: every chunk's slice equals its .text."""
    text = (
        "Paragraph one with some content.\n\n"
        "Paragraph two, which is a bit longer and contains important facts about Alice.\n\n"
        "Paragraph three. Paragraph three. Paragraph three. Paragraph three.\n\n"
        "Paragraph four goes on and on and on and on and on and on and on.\n\n"
        "Paragraph five wraps it up."
    ) * 50
    chunks = chunk_text(text, target_chars=500, overlap_chars=50)
    assert len(chunks) > 1
    for ch in chunks:
        assert text[ch.char_start : ch.char_end] == ch.text


def test_chunks_cover_entire_text_with_overlap() -> None:
    text = "x" * 10_000
    chunks = chunk_text(text, target_chars=1000, overlap_chars=100)
    # First chunk starts at 0, last chunk ends at len(text)
    assert chunks[0].char_start == 0
    assert chunks[-1].char_end == len(text)
    # Adjacent chunks overlap by the configured amount (or less if at the tail).
    for a, b in zip(chunks, chunks[1:], strict=False):
        assert b.char_start < a.char_end, "chunks must overlap"


def test_prefers_paragraph_break() -> None:
    text = "A" * 400 + "\n\n" + "B" * 400
    # Zero overlap so we can assert the first chunk ends exactly at the paragraph break.
    chunks = chunk_text(text, target_chars=300, overlap_chars=0, hard_max=1000)
    # First chunk should end right after the "\n\n" (not mid-A).
    assert chunks[0].text.endswith("\n\n")
    assert chunks[0].char_end == 402  # 400 A's + "\n\n"


def test_hard_cut_when_no_break() -> None:
    text = "NOBREAKS" * 10_000  # no whitespace/punct at all
    chunks = chunk_text(text, target_chars=1000, overlap_chars=100, hard_max=2000)
    assert len(chunks) > 1
    for ch in chunks:
        assert ch.char_end - ch.char_start <= 2000


def test_unicode_offsets_are_character_based() -> None:
    text = "Héllo wörld 🌍\n\n" * 500
    chunks = chunk_text(text, target_chars=200, overlap_chars=20)
    for ch in chunks:
        assert text[ch.char_start : ch.char_end] == ch.text
