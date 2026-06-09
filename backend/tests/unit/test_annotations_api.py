from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.api.annotations import AnnotationCreateRequest


def test_annotation_create_request_trims_optional_fields() -> None:
    annotation = AnnotationCreateRequest(
        target_type="document",
        target_id=" doc-1 ",
        target_label=" witness_memo.txt ",
        tag=" review ",
        title=" Follow up ",
        body=" Needs a stronger contradiction callout. ",
        author=" Nathan575 ",
    )

    assert annotation.target_id == "doc-1"
    assert annotation.target_label == "witness_memo.txt"
    assert annotation.tag == "review"
    assert annotation.title == "Follow up"
    assert annotation.body == "Needs a stronger contradiction callout."
    assert annotation.author == "Nathan575"


@pytest.mark.parametrize("field", ["target_id", "target_label", "body", "author"])
def test_annotation_create_request_rejects_empty_required_text(field: str) -> None:
    payload = {
        "target_type": "event",
        "target_id": "event-1",
        "target_label": "Board meeting",
        "tag": "",
        "title": "",
        "body": "Connect this to the CFO memo.",
        "author": "Nathan575",
    }
    payload[field] = "   "

    with pytest.raises(ValidationError):
        AnnotationCreateRequest(**payload)
