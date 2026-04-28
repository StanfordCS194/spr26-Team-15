"""Accuracy metrics for the extraction/resolution/contradiction pipeline.

Kept simple and explicit so you can trace a failed metric back to a specific labeled fact.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from rapidfuzz import fuzz

from app.models.extraction import EntityType
from app.resolution.resolver import normalize_name


@dataclass(frozen=True)
class PRF:
    precision: float
    recall: float
    f1: float
    true_positives: int
    false_positives: int
    false_negatives: int

    def to_dict(self) -> dict:
        return asdict(self)


def _prf(tp: int, fp: int, fn: int) -> PRF:
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f = (2 * p * r / (p + r)) if (p + r) else 0.0
    return PRF(
        precision=round(p, 4),
        recall=round(r, 4),
        f1=round(f, 4),
        true_positives=tp,
        false_positives=fp,
        false_negatives=fn,
    )


def score_entity_extraction(
    predicted_clusters: list[dict],
    ground_truth: list[dict],
    fuzzy_threshold: float = 85.0,
) -> PRF:
    """Score resolved entity clusters against labeled ground truth.

    A predicted cluster matches a ground-truth entity if they share the same type AND the
    predicted canonical_name is fuzzy-equal to any surface form in the truth (or to the
    truth's canonical_name). Many-to-one is handled: each truth entity matches at most once.
    """
    unmatched_truth = list(ground_truth)
    tp = 0
    fp = 0
    for pred in predicted_clusters:
        pred_type = pred["type"]
        pred_name = pred.get("canonical_name") or pred.get("name") or ""
        best_idx = -1
        best_score = 0.0
        for i, truth in enumerate(unmatched_truth):
            if truth["type"] != pred_type:
                continue
            candidates = [truth["canonical_name"], *truth.get("surface_forms", [])]
            try:
                etype = EntityType(truth["type"])
                pred_norm = normalize_name(pred_name, etype)
                candidate_norms = [normalize_name(c, etype) for c in candidates]
            except ValueError:
                pred_norm = pred_name.lower()
                candidate_norms = [c.lower() for c in candidates]

            score = max(fuzz.token_set_ratio(pred_norm, c) for c in candidate_norms if c) if candidate_norms else 0
            if score > best_score:
                best_score = score
                best_idx = i
        if best_score >= fuzzy_threshold and best_idx >= 0:
            tp += 1
            unmatched_truth.pop(best_idx)
        else:
            fp += 1
    fn = len(unmatched_truth)
    return _prf(tp, fp, fn)


def score_contradiction_detection(
    predicted: list[dict],
    ground_truth: list[dict],
    predicted_entity_name_by_id: dict[str, str] | None = None,
) -> PRF:
    """Score detected contradictions against labeled ones.

    A prediction matches a ground-truth contradiction if the predicted subject (via
    predicted_entity_name_by_id lookup, if provided) fuzzy-matches the truth's
    subject_canonical AND the predicates are equal (case-insensitive).
    """
    mapping = predicted_entity_name_by_id or {}
    unmatched = list(ground_truth)
    tp = 0
    fp = 0
    for pred in predicted:
        subject_name = mapping.get(pred["subject_entity_id"], pred["subject_entity_id"])
        pred_pred = pred["predicate"].strip().lower()
        hit = -1
        for i, truth in enumerate(unmatched):
            if pred_pred != truth["predicate"].strip().lower():
                continue
            score = fuzz.token_set_ratio(subject_name.lower(), truth["subject_canonical"].lower())
            if score >= 80:
                hit = i
                break
        if hit >= 0:
            tp += 1
            unmatched.pop(hit)
        else:
            fp += 1
    fn = len(unmatched)
    return _prf(tp, fp, fn)
