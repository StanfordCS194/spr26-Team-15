# Feedback Log and Groomed Issue Template

Use this page or copy its structure into the team GitHub wiki before the midpoint review. One teammate should fill this in live during each session.

## Session Summary Template

| Session | Date | Tester background | Completed steps | Overall reaction | Would use again? |
| --- | --- | --- | --- | --- | --- |
| S1 | YYYY-MM-DD | Example: student, legal-tech interested | Steps 1-6 completed; upload skipped | Example: understood value but struggled with graph | Yes / No / Maybe |

## Groomed Issue Log

| ID | Session | Type | Severity | Summary | Evidence / tester quote | Area | Linked OKR/KPI | Recommended action | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UT-001 | S1 | UX | High | Tester could not tell where to start | “I see a lot of information but I don’t know what the first move is.” | Workspace entry | KR3 | Add stronger first-step cue on timeline or contradictions tab | TBD | Open |
| UT-002 | S1 | Trust | Medium | Tester questioned entity resolution confidence | “How do I know Bob and Robert Smith are the same person?” | Graph / entity resolution | KR2, Entity Extraction Accuracy | Add clearer provenance and alias explanation | TBD | Open |
| UT-003 | S1 | Feature request | Medium | Tester wanted clearer contradiction explanation | “I can see the mismatch, but I want the app to summarize why it matters.” | Contradictions | KR3, Contradiction Detection Rate | Add plain-language conflict summary near claim cards | TBD | Open |

## Severity Definitions

- Critical: blocks the test or makes the demo fail
- High: major confusion or obvious value loss
- Medium: friction, trust gap, or missing context
- Low: cosmetic or minor improvement

## Recommended Labels

- `bug`
- `ux`
- `trust`
- `performance`
- `feature-request`
- `midpoint-demo`
- `okr-kr1`
- `okr-kr2`
- `okr-kr3`
- `kpi-entity-accuracy`
- `kpi-contradiction-rate`
- `kpi-processing-speed`

## Post-Test Grooming Checklist

- merge duplicates across sessions
- rewrite issues into actionable engineering or product work
- assign an owner
- tag each issue to the relevant OKR or KPI
- rank by demo risk first, product impact second
- identify the top 3 fixes to complete before the midpoint review demonstration
