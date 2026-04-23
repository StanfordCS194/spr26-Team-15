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
import type { Entity, Relation } from "@/lib/types";

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
  onSelect: (id: string, entity: Entity | null) => void;
}

export function GraphView({ caseId, selectedId, onSelect }: Props) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
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
        // Backend returns {id, type, name, ...} — mirror onto our Entity shape for local use.
        setEntities(
          g.entities.map((e: unknown) => {
            const raw = e as Record<string, unknown>;
            return {
              id: String(raw.id),
              type: raw.type as Entity["type"],
              mention_text: String(raw.name ?? ""),
              canonical_name: String(raw.name ?? ""),
              provenance: { source_doc_id: "", chunk_id: "", char_start: 0, char_end: 0 },
              confidence: 1,
            };
          }),
        );
        setRelations(
          g.relations.map((r: unknown) => {
            const raw = r as Record<string, unknown>;
            return {
              id: `${raw.subject_id}-${raw.type}-${raw.object_id}`,
              type: raw.type as Relation["type"],
              subject_id: String(raw.subject_id),
              object_id: String(raw.object_id),
              provenance: { source_doc_id: "", chunk_id: "", char_start: 0, char_end: 0 },
              confidence: 1,
            };
          }),
        );
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const { nodes, edges } = useMemo(() => {
    const filtered = entities.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (search && !(e.canonical_name ?? e.mention_text).toLowerCase().includes(search.toLowerCase()))
        return false;
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
        data: { label: e.canonical_name ?? e.mention_text },
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
        id: r.id,
        source: r.subject_id,
        target: r.object_id,
        label: r.type,
        style: { stroke: "#777", strokeWidth: 1 },
        labelStyle: { fontSize: 10, fill: "#555" },
      }));
    return { nodes, edges };
  }, [entities, relations, typeFilter, search, selectedId]);

  if (loading) return <div className="p-4 text-sm text-neutral-500">Loading graph…</div>;
  if (error) return <div className="p-4 text-sm text-red-600">Graph error: {error}</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b border-neutral-200 bg-white p-2 text-xs">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border px-2 py-1"
        >
          <option value="all">All types</option>
          {Object.keys(TYPE_COLORS).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded border px-2 py-1"
        />
        <span className="self-center text-neutral-500">
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>
      <div className="flex-1 bg-white">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={(_, node) =>
            onSelect(node.id, entities.find((e) => e.id === node.id) ?? null)
          }
          fitView
        >
          <Background gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
