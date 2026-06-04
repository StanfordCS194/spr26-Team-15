# Actionable Results and Priority Backlog

This page converts the current product evidence into a midpoint-ready action list. It should be linked from the team wiki alongside the test plan.

## Current Evidence Snapshot

- Offline demo reseed completed successfully on `2026-05-12`.
- Seeded demo output: `6` documents, `12` entity clusters, `4` events, `3` contradictions.
- Backend unit tests: passed.
- Frontend tests: passed.
- Current saved evaluation report shows:
  - entity extraction / resolution F1: `0.741`
  - contradiction detection precision: `0.000`
  - contradiction detection recall: `0.000`

## KPI and OKR Implications

- KPI risk: entity extraction accuracy is below the stated `>=80%` target.
- KPI risk: contradiction detection is currently below the stated `>=80%` target.
- OKR risk: KR2 is still the weakest area because trust in entity resolution remains fragile.
- OKR risk: KR3 demo flow works visually in the seeded case, but the evaluation evidence does not yet show reliable contradiction performance.
- Midpoint strength: the demo is stable enough to test workflow, comprehension, and perceived value without live LLM calls.

## Priority Backlog

| Priority | ID | Type | Issue | Why it matters | Recommended next step |
| --- | --- | --- | --- | --- | --- |
| P0 | MID-001 | Measurement / trust | Contradiction eval is at `0.000` precision and recall in `eval_report.md` while the seeded demo displays contradictions. | This creates a credibility gap between the demo story and the measured system behavior. | Reconcile seeded contradiction records with the evaluation harness and ground-truth subject mapping before claiming contradiction quality. |
| P0 | MID-002 | Product honesty | KPI targets in the assignment are stronger than current measured results. | Reviewers may ask whether the team is actually meeting its own standards. | State clearly in demo and wiki that midpoint testing validates workflow and value, not final KPI attainment. |
| P1 | MID-003 | UX | New users may not know whether to start with timeline, graph, document pane, or contradictions. | This is the main likely source of tester hesitation in a short midpoint session. | Add a stronger first-step cue in the workspace or guide moderators to start users on the timeline. |
| P1 | MID-004 | Trust | Entity alias resolution is not self-explanatory. | Users may not understand why “Bob Smith” and “Robert K. Smith” are linked. | Show alias/provenance context more explicitly when an entity is selected. |
| P1 | MID-005 | Workflow | Upload reprocessing may feel opaque to users during demos. | Testers need confidence that new files changed the workspace. | Keep the current progress feedback and ensure the moderator explains that each upload triggers case reprocessing. |
| P2 | MID-006 | Performance evidence | The stated processing-speed KPI is for batches larger than 10 documents, but the demo corpus is only 6 documents. | Reviewers may ask for evidence that the KPI is being tested meaningfully. | Capture directional timing now and explicitly mark the large-batch KPI as not yet validated. |
| P2 | MID-007 | Value framing | The product’s strongest current value may be contradiction review or timeline review, not graph exploration. | User testing should discover which surface actually sells the product. | Ask every tester which single view they would keep if the product had to be simplified. |

## What To Focus On During Midpoint Testing

1. Learn whether users understand and trust the seeded contradiction workflow.
2. Learn whether the timeline or contradiction tab is the strongest primary entry point.
3. Capture exact confusion around entity resolution and evidence provenance.
4. Avoid overclaiming current extraction quality; instead, demonstrate stable workflow and grounded evidence navigation.

## Recommended Talking Point For Reviewers

“For midpoint review, we intentionally run the Enron legal case in offline demo mode so we can evaluate user understanding, navigation, and perceived product value without rate-limit risk. Our current strongest evidence is around the seeded workflow and grounded source navigation. Our largest open gaps are measured contradiction accuracy and more robust entity resolution.”
