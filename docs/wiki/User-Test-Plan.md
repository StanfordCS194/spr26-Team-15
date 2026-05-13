# User Test Plan

This is the handout another team should read while going through our midpoint demo. It is designed to be easy to follow without prior knowledge of the product.

## What You Are Testing

You are testing an AI-powered legal discovery prototype.

This product is meant to help a user:

- ingest legal case documents
- identify important people, organizations, claims, and events
- view a case timeline
- inspect source evidence directly in the underlying documents
- find contradictions across multiple documents

For this test, you will use a preloaded Enron / Raptor II case that already contains emails, deposition excerpts, and an internal memo.

## Time

Please plan for about `5-8 minutes`.

## Before You Begin

The team running the demo should already have the app open to the Enron demo case.

If you are starting from the home page, click:

- `Open Enron demo case →`

Once the case loads, you should see:

- a header with `Documents`, `Entities`, and `Contradictions`
- an `Ingestion` section with an `Upload documents` button
- a `Workspace` tab
- a `Contradictions` tab
- a timeline
- a source document panel
- a graph panel

## Instructions

As you go through the demo, please think out loud.

Please say:

- what you think the product is doing
- what feels easy
- what feels confusing
- whether the results feel believable

If you get stuck, try to continue on your own first. A teammate may step in if needed.

## Step-By-Step Demo Flow

### 1. Get Oriented

Start on the Enron demo case workspace.

Please do the following:

1. Look at the case title and the summary cards at the top of the page.
2. Read the `Documents`, `Entities`, and `Contradictions` counts.
3. Briefly explain what you think this product is for based only on this screen.

### 2. Explore the Timeline

Stay in the `Workspace` tab.

Please do the following:

1. Find the timeline.
2. Click on one event that looks important.
3. Watch to see what changes elsewhere on the page.
4. Explain what you think that event means.

### 3. View Source Evidence

After selecting a timeline event, look at the source document panel.

Please do the following:

1. Find the source excerpt shown in the document viewer.
2. Read the excerpt.
3. Explain what evidence this document seems to provide.

### 4. Inspect the Graph

Look at the graph panel in the workspace.

Please do the following:

1. Click on one person or organization in the graph.
2. See whether the selected node changes the context elsewhere on the page.
3. Explain who or what that node appears to represent.
4. If useful, click a second node and compare what you learn.

### 5. Review a Contradiction

Now switch to the `Contradictions` tab.

Please do the following:

1. Click the `Contradictions` tab.
2. Read the contradiction cards that appear.
3. Click `Open` on one contradiction.
4. Compare the conflicting claims shown side by side.
5. Explain, in your own words, what the contradiction is.

### 6. Jump Back to the Evidence

Stay inside the contradiction you opened.

Please do the following:

1. Click one of the claim cards or the `Open source excerpt` action.
2. Confirm that the app returns you to the relevant document evidence.
3. Read the excerpt.
4. Explain whether the contradiction feels convincing based on the source text.

### 7. Try Document Ingestion

If the team running the demo gives you a sample file, test the upload flow.

Please do the following:

1. Find the `Ingestion` section.
2. Click `Upload documents`.
3. Select the provided file.
4. Watch the progress area while the case reprocesses.
5. When processing finishes, look to see whether the workspace updates.

If no file is provided, skip this step.

### 8. Give Your Final Reaction

When you finish, please answer these questions:

1. What do you think this product does best?
2. What was the most confusing part?
3. Which view helped you the most: timeline, graph, source document, or contradictions?
4. Did the linked source evidence make the results feel trustworthy?
5. Would this be useful in a real legal review workflow? Why or why not?

## Team Notes

This section is for our team. It keeps the handout aligned with the assignment requirements.

## Product and Demo Setup

- product: AI-powered legal discovery prototype
- demo case: Enron / Raptor II seeded legal case
- supported demo document types: emails, deposition excerpts, internal memo, and upload support for PDFs/text-based files
- midpoint demo mode: `DEMO_OFFLINE_MODE=true`

This setup matches our current stable demo path and avoids dependence on live LLM calls during midpoint testing.

## OKRs and KPIs Covered by This Test

### OKRs

Objective:
Build a working AI-powered legal discovery prototype that accurately constructs a structured knowledge graph of entities and works on logically complex cases.

Current status notes:

- objective score: `0.5`
- current strength: the seeded Enron case is usable and demonstrates the intended workflow
- current risk: robustness on harder cases is still limited

Key results exercised by this test:

- KR1: ingest and process a real legal dataset across multiple document types
- KR2: extract and resolve entities with high accuracy across ingested documents
- KR3: build and display a visual knowledge graph that surfaces at least one contradiction

### KPIs

- Entity Extraction Accuracy
  Target: `>= 80%`
  Midpoint use: collect trust feedback on entities and compare visible demo behavior against known seeded examples.
- Contradiction Detection Rate
  Target: `>= 80%`
  Midpoint use: verify whether testers can find and understand surfaced contradictions.
- Document Processing Speed
  Target: batches larger than 10 documents process in under 1 minute
  Midpoint use: record upload timing and waiting friction, while noting that the seeded demo corpus is smaller than the final KPI scenario.

## Assignment Spec Coverage

This test plan covers the required assignment areas as follows:

- Basic required functionality
  Covered by the guided flow through case loading, timeline use, source evidence, graph exploration, contradictions, and document upload.
- UI comparisons
  Covered by the closing feedback question asking which primary view is most useful, plus moderator follow-up comparing timeline-first versus contradiction-first workflows.
- Core feature and benefit evaluation
  Covered by asking testers to move from an event to evidence and from a contradiction back to source text, then explain whether the result is useful and trustworthy.
- Performance testing
  Covered by observing the upload/reprocessing flow and recording whether waiting or refresh behavior is confusing.
- Simulated long-term usage
  Covered by using the preloaded Enron case as a fast-forwarded workspace that already contains accumulated legal materials.

## Feedback Mechanism

Use one consistent feedback medium:

- [Feedback-Log.md](/Users/venuchannarayappa/Desktop/spr26-Team-15/docs/wiki/Feedback-Log.md)

For each tester, record:

- tester name or identifier
- tester background
- which steps were completed
- where the tester hesitated
- exact confusion quotes when possible
- issue type
- severity
- linked OKR or KPI
- recommended next action

## Moderator Guidance

Use this short welcome:

“Thanks for testing our legal discovery prototype. Please think out loud as you use it. We are testing the product, not you, so confusion and criticism are very useful.”

Default rule:

- let the tester work independently

Intervene only if:

- they are blocked for roughly 45-60 seconds
- the app is clearly broken
- they misunderstood the task badly enough that the rest of the session would stop being useful

Minimal hints:

- `Try clicking an event in the timeline.`
- `Open one contradiction and compare the claims.`
- `Click the source excerpt to jump back to the document.`

## Midpoint Logistics

For the midpoint review, this plan should be:

- linked from the team wiki
- visible on a laptop or external display near the tester
- available in printed form if needed

Expected outputs after testing:

- a completed feedback log
- an actionable issue list or groomed backlog
- evidence about which part of the product delivers the strongest value during the demo
