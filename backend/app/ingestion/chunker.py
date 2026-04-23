"""Deterministic chunker that preserves exact character offsets.

The critical invariant is: for every returned Chunk, text[char_start:char_end] == chunk.text,
where `text` is the original input. Downstream extraction relies on offsets to highlight in the UI.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    char_start: int
    char_end: int
    text: str


def chunk_text(
    text: str,
    target_chars: int = 1500,
    overlap_chars: int = 100,
    hard_max: int = 3000,
) -> list[Chunk]:
    """Chunk `text` into windows of ~target_chars, trying to break on paragraph boundaries.

    - Adjacent chunks overlap by `overlap_chars` so entities spanning a boundary still get seen twice.
    - If no paragraph break can be found within `hard_max`, force-cut at target_chars to avoid runaway chunks.
    """
    if not text:
        return []

    if target_chars <= 0:
        raise ValueError("target_chars must be positive")
    if overlap_chars < 0 or overlap_chars >= target_chars:
        raise ValueError("overlap_chars must be in [0, target_chars)")

    chunks: list[Chunk] = []
    n = len(text)
    start = 0
    ordinal = 0

    while start < n:
        ideal_end = min(start + target_chars, n)
        end = _find_break(text, ideal_end, hard_end=min(start + hard_max, n))
        if end <= start:
            end = ideal_end  # hard fallback
        chunk_str = text[start:end]
        chunks.append(Chunk(ordinal=ordinal, char_start=start, char_end=end, text=chunk_str))
        ordinal += 1
        if end >= n:
            break
        start = max(end - overlap_chars, start + 1)

    return chunks


def _find_break(text: str, ideal_end: int, hard_end: int) -> int:
    """Scan forward from ideal_end up to hard_end looking for a paragraph, sentence, or line break."""
    if ideal_end >= len(text):
        return len(text)
    # Prefer a blank line (paragraph break); then sentence end; then newline.
    for pattern in ("\n\n", ". ", "\n"):
        idx = text.find(pattern, ideal_end, hard_end)
        if idx != -1:
            return idx + len(pattern)
    return ideal_end
