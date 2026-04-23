const STORAGE_KEY = "lexgraph-prototype-session";

const state = {
  caseTitle: "",
  documents: [],
  graph: { nodes: [], edges: [] },
  timeline: [],
  contradictions: [],
  metrics: loadMetrics(),
};

const els = {
  loadSampleBtn: document.querySelector("#loadSampleBtn"),
  fileInput: document.querySelector("#fileInput"),
  reprocessBtn: document.querySelector("#reprocessBtn"),
  statusBadge: document.querySelector("#statusBadge"),
  dashboardStats: document.querySelector("#dashboardStats"),
  documentsList: document.querySelector("#documentsList"),
  graphCanvas: document.querySelector("#graphCanvas"),
  entitySearch: document.querySelector("#entitySearch"),
  timelineFilter: document.querySelector("#timelineFilter"),
  timelineList: document.querySelector("#timelineList"),
  contradictionsList: document.querySelector("#contradictionsList"),
  contradictionCount: document.querySelector("#contradictionCount"),
  detailPane: document.querySelector("#detailPane"),
  detailHint: document.querySelector("#detailHint"),
  metricsSummary: document.querySelector("#metricsSummary"),
  feedbackForm: document.querySelector("#feedbackForm"),
  exportMetricsBtn: document.querySelector("#exportMetricsBtn"),
};

const PERSON_ALIASES = new Map([
  ["ava chen", "Ava Chen"],
  ["robert smith", "Robert Smith"],
  ["bob smith", "Robert Smith"],
  ["dana lopez", "Dana Lopez"],
  ["marcus hill", "Marcus Hill"],
  ["priya patel", "Priya Patel"],
]);

const ORGS = ["Acme Robotics", "Northstar Logistics", "Raven warehouse", "San Jose", "Raven site"];
const RELATION_PATTERNS = [
  { regex: /([A-Z][a-z]+ [A-Z][a-z]+).*signed.*with ([A-Z][a-z]+ [A-Z][a-z]+)/i, label: "signed agreement with" },
  { regex: /From:\s*([A-Z][a-z]+ [A-Z][a-z]+)\s*[\s\S]*?To:\s*([A-Z][a-z]+ [A-Z][a-z]+)/i, label: "emailed" },
  { regex: /([A-Z][a-z]+ [A-Z][a-z]+).*approved.*invoice/i, label: "approved invoice for" },
  { regex: /([A-Z][a-z]+ [A-Z][a-z]+).*told me/i, label: "stated to witness" },
];

init();

function init() {
  els.loadSampleBtn.addEventListener("click", loadSampleCase);
  els.fileInput.addEventListener("change", handleFiles);
  els.reprocessBtn.addEventListener("click", () => {
    processDocuments(state.documents);
    logEvent("reprocess");
  });
  els.entitySearch.addEventListener("input", renderGraph);
  els.timelineFilter.addEventListener("change", () => {
    renderTimeline();
    logEvent("timeline_filter", { filter: els.timelineFilter.value });
  });
  els.feedbackForm.addEventListener("submit", saveFeedback);
  els.exportMetricsBtn.addEventListener("click", exportSessionData);
  renderMetrics();
}

async function loadSampleCase() {
  const response = await fetch("./data/sample-case.json");
  const payload = await response.json();
  state.caseTitle = payload.caseTitle;
  state.documents = payload.documents;
  processDocuments(state.documents);
  logEvent("sample_case_loaded", { documents: payload.documents.length });
}

async function handleFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }

  const docs = await Promise.all(
    files.map(async (file, index) => ({
      id: `upload-${Date.now()}-${index}`,
      title: file.name,
      type: inferType(file.name),
      source: "local upload",
      content: await file.text(),
    })),
  );

  state.caseTitle = "Uploaded Case Materials";
  state.documents = docs;
  processDocuments(docs);
  logEvent("files_uploaded", { documents: docs.length });
}

function processDocuments(documents) {
  const entities = new Map();
  const edges = [];
  const timeline = [];
  const claims = [];

  documents.forEach((doc) => {
    const docEntities = extractEntities(doc.content);
    const docClaims = extractClaims(doc);

    docEntities.forEach((entity) => {
      if (!entities.has(entity.id)) {
        entities.set(entity.id, entity);
      } else {
        const existing = entities.get(entity.id);
        existing.evidence.push(...entity.evidence);
      }
    });

    docClaims.forEach((claim) => {
      claims.push(claim);
      timeline.push({
        id: claim.id,
        type: "claim",
        date: claim.date || "Undated",
        label: claim.label,
        detail: claim.text,
        documentId: doc.id,
      });
    });

    extractDocumentDates(doc).forEach((dateEntity) => {
      if (!entities.has(dateEntity.id)) {
        entities.set(dateEntity.id, dateEntity);
      }
      timeline.push({
        id: `${doc.id}-${dateEntity.value}`,
        type: "document",
        date: dateEntity.value,
        label: `${doc.title} references ${dateEntity.value}`,
        detail: doc.content,
        documentId: doc.id,
      });
    });

    buildRelationships(doc, docEntities).forEach((edge) => edges.push(edge));
  });

  state.graph = { nodes: Array.from(entities.values()), edges };
  state.timeline = sortTimeline(timeline);
  state.contradictions = detectContradictions(claims, documents);

  els.reprocessBtn.disabled = !documents.length;
  renderAll();
}

function extractEntities(text) {
  const found = [];
  const lower = text.toLowerCase();

  for (const [alias, canonical] of PERSON_ALIASES.entries()) {
    if (lower.includes(alias)) {
      found.push(makeEntity(canonical, "person", text));
    }
  }

  ORGS.forEach((org) => {
    if (text.includes(org)) {
      found.push(makeEntity(org, isLikelyLocation(org) ? "organization" : "organization", text));
    }
  });

  const moneyMatches = text.match(/\$\d[\d,]*/g) || [];
  moneyMatches.forEach((amount) => found.push(makeEntity(amount, "money", text)));

  const dateRegex =
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g;
  const dateMatches = text.match(dateRegex) || [];
  dateMatches.forEach((date) => found.push(makeEntity(date, "date", text)));

  return dedupeEntities(found);
}

function makeEntity(value, type, evidenceText) {
  return {
    id: `${type}:${normalize(value)}`,
    label: value,
    type,
    value,
    evidence: [truncate(evidenceText, 260)],
  };
}

function dedupeEntities(entities) {
  const deduped = new Map();
  entities.forEach((entity) => {
    if (!deduped.has(entity.id)) {
      deduped.set(entity.id, entity);
      return;
    }
    deduped.get(entity.id).evidence.push(...entity.evidence);
  });
  return Array.from(deduped.values());
}

function extractDocumentDates(doc) {
  return extractEntities(doc.content).filter((entity) => entity.type === "date");
}

function buildRelationships(doc, entities) {
  const edges = [];
  const people = entities.filter((entity) => entity.type === "person");
  const orgs = entities.filter((entity) => entity.type === "organization");

  RELATION_PATTERNS.forEach((pattern) => {
    const match = doc.content.match(pattern.regex);
    if (!match) {
      return;
    }
    const from = canonicalPerson(match[1]);
    if (!from) {
      return;
    }
    if (match[2]) {
      const to = canonicalPerson(match[2]) || match[2];
      edges.push(makeEdge(`person:${normalize(from)}`, edgeTargetId(to), pattern.label, doc.id));
      return;
    }
    if (orgs[0]) {
      edges.push(makeEdge(`person:${normalize(from)}`, orgs[0].id, pattern.label, doc.id));
    }
  });

  people.forEach((person) => {
    orgs.forEach((org) => edges.push(makeEdge(person.id, org.id, "mentioned with", doc.id)));
  });

  return dedupeEdges(edges);
}

function makeEdge(source, target, label, documentId) {
  return { id: `${source}|${target}|${label}`, source, target, label, documentId };
}

function dedupeEdges(edges) {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}

function extractClaims(doc) {
  const claims = [];
  const lines = doc.content.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  lines.forEach((line, index) => {
    const deliveryMatch = line.match(/arriv(?:e|ed)|deliver(?:ed|y)/i);
    const approvalMatch = line.match(/approved.*invoice|release.*advance/i);
    const dateMatch = line.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/,
    );

    if (deliveryMatch) {
      claims.push({
        id: `${doc.id}-claim-${index}-delivery`,
        topic: "shipment_delivery_date",
        label: "Shipment delivery timing",
        value: dateMatch ? dateMatch[0] : line,
        date: dateMatch ? dateMatch[0] : "",
        text: line,
        documentId: doc.id,
        documentTitle: doc.title,
      });
    }

    if (approvalMatch) {
      claims.push({
        id: `${doc.id}-claim-${index}-approval`,
        topic: "invoice_approval",
        label: "Invoice approval responsibility",
        value: extractApprovalActor(line),
        date: dateMatch ? dateMatch[0] : "",
        text: line,
        documentId: doc.id,
        documentTitle: doc.title,
      });
    }
  });

  return claims;
}

function extractApprovalActor(line) {
  const actorMatch = line.match(/([A-Z][a-z]+(?: [A-Z][a-z]+)+).*approved/i);
  if (actorMatch) {
    return canonicalPerson(actorMatch[1]) || actorMatch[1];
  }
  if (/Bob Smith/i.test(line)) {
    return "Robert Smith";
  }
  if (/Ava Chen/i.test(line)) {
    return "Ava Chen";
  }
  return line;
}

function detectContradictions(claims, documents) {
  const contradictions = [];
  const grouped = claims.reduce((acc, claim) => {
    acc[claim.topic] = acc[claim.topic] || [];
    acc[claim.topic].push(claim);
    return acc;
  }, {});

  Object.values(grouped).forEach((items) => {
    for (let index = 0; index < items.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < items.length; compareIndex += 1) {
        const a = items[index];
        const b = items[compareIndex];
        if (a.value !== b.value) {
          contradictions.push({
            id: `${a.id}|${b.id}`,
            topic: a.topic,
            severity: a.topic === "shipment_delivery_date" ? "high" : "medium",
            summary:
              a.topic === "shipment_delivery_date"
                ? `Conflicting delivery dates: ${a.value} vs ${b.value}`
                : `Conflicting invoice approvers: ${a.value} vs ${b.value}`,
            evidence: [
              formatEvidence(a, documents),
              formatEvidence(b, documents),
            ],
          });
        }
      }
    }
  });

  return contradictions;
}

function formatEvidence(claim, documents) {
  const doc = documents.find((item) => item.id === claim.documentId);
  return {
    title: claim.documentTitle,
    excerpt: claim.text,
    source: doc?.type || "document",
  };
}

function sortTimeline(items) {
  return [...items].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function renderAll() {
  renderStatus();
  renderDashboard();
  renderDocuments();
  renderGraph();
  renderTimeline();
  renderContradictions();
  renderMetrics();
}

function renderStatus() {
  els.statusBadge.textContent = state.documents.length
    ? `${state.caseTitle} loaded`
    : "No case loaded";
  els.statusBadge.classList.toggle("muted", !state.documents.length);
}

function renderDashboard() {
  if (!state.documents.length) {
    els.dashboardStats.className = "stats empty-state";
    els.dashboardStats.textContent = "Load the sample case or upload documents to build the graph.";
    return;
  }

  const stats = [
    { label: "Documents", value: state.documents.length },
    { label: "Entities", value: state.graph.nodes.length },
    { label: "Relationships", value: state.graph.edges.length },
    { label: "Contradictions", value: state.contradictions.length },
    { label: "Timeline Events", value: state.timeline.length },
  ];

  els.dashboardStats.className = "stats";
  els.dashboardStats.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card">
          <span>${stat.label}</span>
          <strong>${stat.value}</strong>
        </article>
      `,
    )
    .join("");
}

function renderDocuments() {
  if (!state.documents.length) {
    els.documentsList.className = "documents empty-state";
    els.documentsList.textContent = "No documents loaded yet.";
    return;
  }

  els.documentsList.className = "documents";
  els.documentsList.innerHTML = state.documents
    .map(
      (doc) => `
        <article class="doc-card">
          <h3>${doc.title}</h3>
          <p class="doc-meta">${doc.type} · ${doc.source}</p>
          <p>${truncate(doc.content, 180)}</p>
          <button data-doc-id="${doc.id}" class="secondary inspect-doc">Inspect Evidence</button>
        </article>
      `,
    )
    .join("");

  els.documentsList.querySelectorAll(".inspect-doc").forEach((button) => {
    button.addEventListener("click", () => {
      const doc = state.documents.find((item) => item.id === button.dataset.docId);
      showDetail(doc.title, doc.content);
      logEvent("document_opened", { documentId: doc.id });
    });
  });
}

function renderGraph() {
  const term = normalize(els.entitySearch.value);
  const nodes = state.graph.nodes.filter((node) => !term || normalize(node.label).includes(term));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = state.graph.edges.filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );

  if (!nodes.length) {
    els.graphCanvas.innerHTML = "";
    return;
  }

  const width = 920;
  const height = 420;
  const radius = Math.min(width, height) * 0.34;
  const centerX = width / 2;
  const centerY = height / 2;
  const positions = new Map();

  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  const edgeMarkup = edges
    .map((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      return `<line class="edge" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"></line>`;
    })
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const position = positions.get(node.id);
      return `
        <g class="graph-node" data-node-id="${node.id}">
          <circle class="node ${node.type}" cx="${position.x}" cy="${position.y}" r="20"></circle>
          <text class="node-label" x="${position.x}" y="${position.y + 38}" text-anchor="middle">${node.label}</text>
        </g>
      `;
    })
    .join("");

  els.graphCanvas.innerHTML = `${edgeMarkup}${nodeMarkup}`;
  els.graphCanvas.querySelectorAll(".graph-node").forEach((nodeGroup) => {
    nodeGroup.addEventListener("click", () => {
      const entity = state.graph.nodes.find((node) => node.id === nodeGroup.dataset.nodeId);
      showDetail(entity.label, entity.evidence.join("\n\n"));
      logEvent("node_clicked", { entity: entity.label, type: entity.type });
    });
  });
}

function renderTimeline() {
  const filter = els.timelineFilter.value;
  const items = state.timeline.filter((item) => filter === "all" || item.type === filter);

  if (!items.length) {
    els.timelineList.className = "timeline empty-state";
    els.timelineList.textContent = "Timeline will appear after processing.";
    return;
  }

  els.timelineList.className = "timeline";
  els.timelineList.innerHTML = items
    .map(
      (item) => `
        <article class="timeline-item">
          <time>${item.date}</time>
          <h3>${item.label}</h3>
          <p>${truncate(item.detail, 140)}</p>
          <button data-item-id="${item.id}" class="secondary inspect-timeline">Open Evidence</button>
        </article>
      `,
    )
    .join("");

  els.timelineList.querySelectorAll(".inspect-timeline").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.itemId);
      showDetail(item.label, item.detail);
      logEvent("timeline_item_opened", { itemId: item.id, type: item.type });
    });
  });
}

function renderContradictions() {
  els.contradictionCount.textContent = `${state.contradictions.length} flags`;

  if (!state.contradictions.length) {
    els.contradictionsList.className = "contradictions empty-state";
    els.contradictionsList.textContent = "Contradictions will appear after processing.";
    return;
  }

  els.contradictionsList.className = "contradictions";
  els.contradictionsList.innerHTML = state.contradictions
    .map(
      (entry) => `
        <article class="contradiction-card">
          <h3>${entry.summary}</h3>
          <p class="doc-meta">Severity: ${entry.severity}</p>
          <button data-contradiction-id="${entry.id}" class="secondary inspect-contradiction">View Side-by-Side Evidence</button>
        </article>
      `,
    )
    .join("");

  els.contradictionsList.querySelectorAll(".inspect-contradiction").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.contradictions.find((item) => item.id === button.dataset.contradictionId);
      const detail = entry.evidence
        .map((evidence) => `${evidence.title} (${evidence.source})\n${evidence.excerpt}`)
        .join("\n\n---\n\n");
      showDetail(entry.summary, detail);
      logEvent("contradiction_opened", { contradiction: entry.summary });
    });
  });
}

function showDetail(title, text) {
  els.detailHint.textContent = title;
  els.detailPane.className = "detail";
  els.detailPane.innerHTML = `
    <article class="detail-card">
      <h3>${title}</h3>
      <pre>${escapeHtml(text)}</pre>
    </article>
  `;
}

function saveFeedback(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const feedback = Object.fromEntries(formData.entries());
  feedback.timestamp = new Date().toISOString();
  state.metrics.feedback.push(feedback);
  persistMetrics();
  renderMetrics();
  event.currentTarget.reset();
  logEvent("feedback_saved", { role: feedback.role, score: feedback.score });
}

function renderMetrics() {
  const interactions = state.metrics.events.length;
  const feedbackCount = state.metrics.feedback.length;
  const lastEvent = state.metrics.events.at(-1);

  if (!interactions && !feedbackCount) {
    els.metricsSummary.className = "metrics-summary empty-state";
    els.metricsSummary.textContent = "No interaction data yet.";
    return;
  }

  const averageScore =
    feedbackCount > 0
      ? (
          state.metrics.feedback.reduce((sum, item) => sum + Number(item.score || 0), 0) /
          feedbackCount
        ).toFixed(1)
      : "N/A";

  els.metricsSummary.className = "metrics-summary";
  els.metricsSummary.innerHTML = `
    <article class="metric-card">
      <h3>${interactions}</h3>
      <p>Total tracked interactions</p>
    </article>
    <article class="metric-card">
      <h3>${feedbackCount}</h3>
      <p>Feedback records captured</p>
    </article>
    <article class="metric-card">
      <h3>${averageScore}</h3>
      <p>Average usefulness score</p>
    </article>
    <article class="metric-card">
      <h3>${lastEvent ? lastEvent.type : "N/A"}</h3>
      <p>Most recent event</p>
    </article>
  `;
}

function exportSessionData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    caseTitle: state.caseTitle,
    metrics: state.metrics,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lexgraph-session-data.json";
  link.click();
  URL.revokeObjectURL(url);
  logEvent("metrics_exported", { feedbackCount: state.metrics.feedback.length });
}

function logEvent(type, detail = {}) {
  state.metrics.events.push({
    type,
    detail,
    timestamp: new Date().toISOString(),
  });
  persistMetrics();
  renderMetrics();
}

function loadMetrics() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { events: [], feedback: [] };
  } catch {
    return { events: [], feedback: [] };
  }
}

function persistMetrics() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.metrics));
}

function inferType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".eml")) return "email";
  if (lower.includes("depo")) return "deposition";
  if (lower.includes("contract")) return "contract";
  if (lower.endsWith(".json")) return "json";
  return "text";
}

function edgeTargetId(label) {
  const canonical = canonicalPerson(label);
  if (canonical) {
    return `person:${normalize(canonical)}`;
  }
  return `organization:${normalize(label)}`;
}

function canonicalPerson(name) {
  return PERSON_ALIASES.get(normalize(name)) || null;
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function truncate(text, maxLength) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trim()}...`;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isLikelyLocation(value) {
  return value === "San Jose";
}
