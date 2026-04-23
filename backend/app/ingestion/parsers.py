"""Parse raw bytes of supported doc formats into plain text.

Contract: the returned text is the authoritative character-offset space that all downstream
extractions reference. Whatever we hand back here is what the UI highlights against, so we
must be careful not to collapse whitespace in ways that would shift offsets.
"""

from __future__ import annotations

from io import BytesIO

SUPPORTED_TEXT = {"text/plain", "text/markdown", "text/csv"}
SUPPORTED_PDF = {"application/pdf"}
SUPPORTED_EML = {"message/rfc822", "application/vnd.ms-outlook"}


def detect_and_extract(
    filename: str, content_type: str | None, data: bytes
) -> tuple[str, str]:
    """Return (text, normalized_mime_type). Raises ValueError on unsupported types."""
    mime = (content_type or "").lower()
    lower = filename.lower()

    if mime in SUPPORTED_PDF or lower.endswith(".pdf"):
        return _extract_pdf(data), "application/pdf"
    if mime in SUPPORTED_EML or lower.endswith(".eml"):
        return _extract_eml(data), "message/rfc822"
    if mime in SUPPORTED_TEXT or lower.endswith((".txt", ".md", ".csv")):
        return data.decode("utf-8", errors="replace"), "text/plain"

    raise ValueError(f"unsupported document type: filename={filename!r} mime={mime!r}")


def _extract_pdf(data: bytes) -> str:
    import pdfplumber

    pages: list[str] = []
    with pdfplumber.open(BytesIO(data)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    # Separate pages with a form-feed marker so offsets stay stable and pages are findable.
    return "\n\f\n".join(pages)


def _extract_eml(data: bytes) -> str:
    # mail-parser's rich extraction sometimes raises on malformed input; fall back to stdlib.
    try:
        from mailparser import parse_from_bytes

        mail = parse_from_bytes(data)
        headers = (
            f"From: {mail.from_}\n"
            f"To: {mail.to}\n"
            f"Cc: {mail.cc}\n"
            f"Date: {mail.date}\n"
            f"Subject: {mail.subject}\n"
        )
        body = mail.body or ""
        return f"{headers}\n{body}"
    except Exception:
        import email
        from email import policy

        msg = email.message_from_bytes(data, policy=policy.default)
        headers = (
            f"From: {msg.get('From', '')}\n"
            f"To: {msg.get('To', '')}\n"
            f"Cc: {msg.get('Cc', '')}\n"
            f"Date: {msg.get('Date', '')}\n"
            f"Subject: {msg.get('Subject', '')}\n"
        )
        body_part = msg.get_body(preferencelist=("plain", "html"))
        body = body_part.get_content() if body_part else ""
        return f"{headers}\n{body}"
