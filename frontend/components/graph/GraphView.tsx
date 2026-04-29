"use client";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
} from "reactflow";
import { useEffect, useMemo, useState } from "react";

import { getGraph } from "@/lib/api";
import type { GraphEntity, GraphRelation } from "@/lib/types";

const TYPE_COLORS: Record<string, string> = {
  Person: "#c65d3a",
  Organization: "#1a5c8a",
  Date: "#4b7c4a",
  Location: "#7a5c9b",
  Money: "#a08a2e",
  Document: "#555555",
  Event: "#b4644d",
};

interface Props {
  caseId: string;
  selectedId: string | null;
  refreshToken?: number;
  onSelect: (id: string, entity: GraphEntity | null) => void;
}

export function GraphView({ caseId, selectedId, refreshToken = 0, onSelect }: Props) {
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [relations, setRelations] = useState<GraphRelation[]>([]);
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGraph(caseId)
      .then((g) => {
        if (cancelled) return;
        setEntities(g.entities);
        setRelations(g.relations);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entities) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return counts;
  }, [entities]);

  const { nodes, edges } = useMemo(() => {
    const filtered = entities.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    // Simple deterministic circular layout so the graph is stable across renders.
    const nodes: Node[] = filtered.map((e, i) => {
      const angle = (i / Math.max(filtered.length, 1)) * Math.PI * 2;
      const radius = 260 + (filtered.length > 30 ? filtered.length * 2 : 0);
      const x = Math.cos(angle) * radius + 400;
      const y = Math.sin(angle) * radius + 300;
      const selected = e.id === selectedId;
      return {
        id: e.id,
        data: { label: e.name },
        position: { x, y },
        style: {
          background: TYPE_COLORS[e.type] ?? "#333",
          color: "#fff",
          border: selected ? "3px solid #000" : "1px solid #222",
          borderRadius: 6,
          padding: 8,
          fontSize: 12,
          maxWidth: 200,
        },
      };
    });
    const visibleIds = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = relations
      .filter((r) => visibleIds.has(r.subject_id) && visibleIds.has(r.object_id))
      .map((r) => ({
        id: `${r.subject_id}-${r.type}-${r.object_id}`,
        source: r.subject_id,
        target: r.object_id,
        label: r.type,
        style: { stroke: "#777", strokeWidth: 1 },
        labelStyle: { fontSize: 10, fill: "#555" },
      }));
    return { nodes, edges };
  }, [entities, relations, typeFilter, search, selectedId]);

  const filteredEntities = useMemo(
    () =>
      entities
        .filter((e) => {
          if (typeFilter !== "all" && e.type !== typeFilter) return false;
          if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entities, typeFilter, search],
  );

  if (loading) return <div className="p-5 text-sm text-[color:var(--muted)]">Loading graph…</div>;
  if (error) return <div className="p-5 text-sm text-red-600">Graph error: {error}</div>;

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(255,253,250,0.95),rgba(248,242,235,0.88))]">
      <div className="border-b border-[color:var(--line)] px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="panel-title">Relationship Graph</div>
            <h2 className="mt-2 text-xl font-semibold">Entity map</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-[color:var(--muted)]">
              Use the graph to pivot between people, organizations, and other extracted entities.
            </p>
          </div>
          <span className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1 text-xs text-[color:var(--muted)]">
            {nodes.length} nodes · {edges.length} edges
          </span>
        </div>
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter by entity type"
        >
          {Object.entries(TYPE_COLORS)
            .filter(([type]) => (typeCounts[type] ?? 0) > 0)
            .map(([type, color]) => {
              const active = typeFilter === type;
              const count = typeCounts[type] ?? 0;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    setTypeFilter((prev) => (prev === type ? "all" : type))
                  }
                  aria-pressed={active}
                  className={
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors " +
                    (active
                      ? "border-[color:var(--text)] bg-[color:var(--text)] text-white"
                      : "border-[color:var(--line)] bg-white text-[color:var(--muted)] hover:bg-white/80")
                  }
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="font-medium">{type}</span>
                  <span className={active ? "text-white/65" : "text-[color:var(--muted)]"}>
                    {count}
                  </span>
                </button>
              );
            })}
        </div>
        <input
          type="search"
          placeholder="Search by entity name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-3 w-full rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[270px_1fr]">
        <aside className="border-b border-[color:var(--line)] bg-[#f7efe4] lg:border-b-0 lg:border-r">
          <div className="border-b border-[color:var(--line)] px-4 py-3">
            <div className="panel-title">Entity Navigator</div>
            <div className="mt-2 text-sm text-[color:var(--muted)]">
              Browse extracted entities directly and use the graph for relationship context.
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto lg:max-h-none lg:h-full">
            {filteredEntities.length === 0 ? (
              <div className="p-4 text-sm text-[color:var(--muted)]">
                No entities match the current filter.
              </div>
            ) : (
              <ul className="divide-y divide-[color:var(--line)]">
                {filteredEntities.map((entity) => {
                  const isSelected = entity.id === selectedId;
                  return (
                    <li key={entity.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(entity.id, entity)}
                        className={
                          isSelected
                            ? "w-full bg-[linear-gradient(135deg,#2d2520,#1f1a16)] px-4 py-3 text-left text-white"
                            : "w-full px-4 py-3 text-left hover:bg-white/70"
                        }
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{entity.name}</div>
                            <div className={isSelected ? "mt-1 text-xs text-white/65" : "mt-1 text-xs text-[color:var(--muted)]"}>
                              {entity.type}
                            </div>
                          </div>
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: TYPE_COLORS[entity.type] ?? "#333" }}
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
        <div className="relative min-h-[340px] bg-white/80">
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-sm rounded-2xl border border-[color:var(--line)] bg-white/92 px-4 py-3 text-sm text-[color:var(--muted)] shadow-sm">
            No entities are visible yet. Process a case or broaden the filter to populate the graph.
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={(_, node) => onSelect(node.id, entities.find((e) => e.id === node.id) ?? null)}
          fitView
        >
          <Background gap={20} color="rgba(128, 107, 88, 0.16)" />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        </div>
      </div>
    </div>
  );
}
