from __future__ import annotations

import pytest

from app.ingestion.parsers import detect_and_extract


def test_plain_text_passthrough() -> None:
    data = b"hello world\nthis is a test"
    text, mime = detect_and_extract("case.txt", "text/plain", data)
    assert text == "hello world\nthis is a test"
    assert mime == "text/plain"


def test_unicode_preserved_in_text() -> None:
    original = "Héllo wörld 🌍\nSecond line"
    text, _ = detect_and_extract("x.txt", "text/plain", original.encode("utf-8"))
    assert text == original


def test_unsupported_type_raises() -> None:
    with pytest.raises(ValueError):
        detect_and_extract("weird.xyz", "application/octet-stream", b"\x00\x01\x02")


def test_filename_extension_fallback_when_no_mime() -> None:
    data = b"just some text"
    text, mime = detect_and_extract("notes.md", None, data)
    assert text == "just some text"
    assert mime == "text/plain"


def test_eml_parses_headers_and_body() -> None:
    raw = (
        b"From: alice@example.com\r\n"
        b"To: bob@example.com\r\n"
        b"Subject: Test\r\n"
        b"Date: Mon, 1 Jan 2024 00:00:00 +0000\r\n"
        b"Content-Type: text/plain; charset=utf-8\r\n"
        b"\r\n"
        b"Hello Bob,\r\nThis is the body.\r\n"
    )
    text, mime = detect_and_extract("msg.eml", "message/rfc822", raw)
    assert mime == "message/rfc822"
    assert "alice@example.com" in text
    assert "Hello Bob" in text
