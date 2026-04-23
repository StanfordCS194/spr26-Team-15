# Customer Discovery Summary Draft

This draft is built from the actual PRD and assignment prompt. It is polished where the facts are already supported by your project materials, and it leaves explicit placeholders where the assignment requires real interactions or measured data. Those fields must be completed with truthful information from your team's actual interviews and prototype sessions.

## 1. Rationale For The Target Audience

Our target audience is litigation attorneys at U.S. small-to-mid-sized firms, along with paralegals who support discovery-heavy matters. We selected this audience because the PRD centers on a high-cost, high-friction workflow: legal professionals spend substantial time reviewing unstructured discovery materials, reconstructing timelines, tracking entities across documents, and identifying contradictions that can materially affect case strategy.

This audience is the "desperate user" because the pain is acute, frequent, and expensive:

- Discovery review often spans thousands of pages and multiple document types.
- Critical facts are fragmented across depositions, emails, contracts, and correspondence.
- Contradictions are easy to miss when they appear across separate documents and dates.
- Case knowledge is often trapped in notes or in the heads of attorneys and paralegals rather than in a structured system.
- Existing tools are strong at storage, search, or legal research, but weaker at cross-document case reasoning.

The team therefore focused on users who would immediately benefit from faster timeline construction, entity tracking, contradiction detection, and evidence-backed case synthesis.

## 2. How We Became More Expert On This Audience

We developed domain understanding through three channels.

First, the team grounded the project in a detailed PRD focused on legal discovery workflows, user roles, and competitor positioning. That document clarified the distinction between existing document review tools and the opportunity for a structured case-intelligence workspace.

Second, Josh brought prior exposure to legal tech startups and helped the team understand the current landscape, common pain points, and relevant competitors such as Casefleet, Relativity, Everlaw, Lexis+, and Westlaw CoCounsel.

Third, the team used these inputs to translate abstract legal-tech ideas into concrete workflows and user stories, especially around:

- bulk document ingestion
- entity extraction and entity resolution
- interactive graph exploration
- contradiction detection
- timeline generation

## 3. Real-Time Interactions With The Target Audience

Replace this section with your actual count.

Suggested final wording:

"We interacted in real time with [X] members of our target audience: [Y] litigation attorneys, [Z] paralegals, and [W] adjacent legal-tech practitioners. Sessions were conducted via [Zoom / in person / phone] between [DATE RANGE], and each session lasted approximately [N] minutes."

Include a brief sentence on access difficulty, since the assignment evaluates volume relative to reach difficulty.

## 4. Prototypes Shown And How We Measured Response

We built a functional prototype called `LexGraph`, a lightweight legal discovery workspace aligned to the PRD. The prototype allows a user to:

- load or upload case documents
- automatically extract entities such as people, organizations, dates, and monetary amounts
- view relationships in a visual knowledge graph
- inspect a generated event timeline
- review contradiction flags across documents
- capture interaction metrics and export session data after a user test

This prototype was designed to test whether target users quickly understood the value of a structured evidence workspace versus manual review across separate files.

### Measurement Approach

The prototype includes lightweight instrumentation so sessions can produce both subjective and objective data. During a live test, the team can capture:

- clickstream events such as document opens, graph node clicks, timeline interactions, contradiction inspections, and metric exports
- number of interactions per session
- which features were used first
- whether a participant reached a contradiction or supporting evidence view
- participant-reported usefulness score
- qualitative notes from the observer

### Data Collected Beyond Subjective Observation

In addition to verbal feedback, the prototype can collect:

- interaction count per participant
- feature engagement by surface area
- whether contradiction evidence was reached
- number of feedback forms submitted
- average usefulness score
- session-export JSON for later aggregation

Replace the next sentence with your actual results:

"Across [X] live sessions, the most-used feature was [FEATURE], the average usefulness score was [N.N]/5, and participants typically reached a meaningful evidence view within [TIME]."

## 5. Tabular Display Of Data Collected

Use the following format and replace the placeholders with your real data.

| Participant ID | Role | Session Type | Prototype Used | Time To First Insight | Features Used | Usefulness Score (1-5) | Key Observation | Recommended Product Change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | [Attorney / Paralegal / Legal-tech operator] | [Zoom / in person] | Functional prototype | [e.g. 1m 20s] | [Docs, graph, contradictions] | [ ] | [ ] | [ ] |
| P2 | [ ] | [ ] | Functional prototype | [ ] | [ ] | [ ] | [ ] | [ ] |
| P3 | [ ] | [ ] | Functional prototype | [ ] | [ ] | [ ] | [ ] | [ ] |
| P4 | [ ] | [ ] | Functional prototype | [ ] | [ ] | [ ] | [ ] | [ ] |

If you export the session JSON from the prototype after each interview, you can also summarize:

| Metric | Value |
| --- | --- |
| Number of live sessions | [ ] |
| Average interactions per session | [ ] |
| Most-opened feature | [ ] |
| Average usefulness score | [ ] |
| % of sessions that reached contradiction evidence | [ ] |

## 6. PRD Updates Based On Learnings

Below is a defensible PRD update section you can keep if it matches what your real interviews show.

### Recommended PRD Updates

1. Raise the priority of contradiction detection in the early demo flow.
   Users evaluating the product are likely to understand value fastest when the system highlights a concrete inconsistency with linked evidence, rather than only showing extraction quality.

2. Reframe the graph as supporting evidence navigation, not just visualization.
   The interviews should test whether users care more about "seeing a graph" or about "getting back to the exact supporting text quickly." If the latter is true, the graph should be positioned as a navigational surface tied to evidence.

3. Tighten the MVP around a narrow document set.
   For early validation, focusing on depositions, emails, and contracts may be more convincing than claiming broad document coverage without depth.

4. Instrument time-to-value explicitly.
   The assignment rewards objective data. The PRD should therefore add a KPI tied to how quickly a user reaches a useful contradiction, timeline event, or evidence chain.

5. Treat precedent mapping as a later-stage feature.
   Based on the current prototype and likely interview feedback, precedent-to-fact mapping remains compelling but is better positioned as a P1 extension after the core evidence workspace proves useful.

### Suggested PRD Additions

Add the following KPI language to the PRD if it reflects your findings:

- Time to first useful insight: median time for a tester to reach a contradiction, evidence chain, or timeline event they considered valuable.
- Evidence trace completion rate: percentage of sessions in which a tester successfully navigated from a surfaced claim to the underlying source text.
- Contradiction review rate: percentage of sessions in which the contradiction view was opened and used.

## Submission Note

To maximize assignment quality without fabricating evidence:

- keep the strong analytical framing above
- run the prototype with real target users
- export the session data after each interview
- fill in the real counts, observations, and quotes before submission
