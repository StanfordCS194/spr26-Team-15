import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  getGraph: vi.fn(),
}));

// ReactFlow needs browser layout APIs jsdom doesn't have. We don't render it
// in these tests — we only care about the legend chips above it.
vi.mock("reactflow", () => ({
  default: () => null,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
}));

import { getGraph } from "@/lib/api";
import { GraphView } from "../GraphView";

const mockGraph = {
  entities: [
    { id: "e1", type: "Person", name: "Alice" },
    { id: "e2", type: "Person", name: "Bob" },
    { id: "e3", type: "Person", name: "Carol" },
    { id: "e4", type: "Organization", name: "Acme" },
    { id: "e5", type: "Organization", name: "Globex" },
  ],
  relations: [],
  events: [],
};

describe("GraphView type-legend chips", () => {
  beforeEach(() => {
    vi.mocked(getGraph).mockResolvedValue(mockGraph as never);
  });

  it("renders one chip per type that has entities, with counts", async () => {
    render(<GraphView caseId="demo" selectedId={null} onSelect={() => {}} />);

    const personChip = await screen.findByRole("button", { name: /Person/ });
    expect(personChip.textContent).toContain("Person");
    expect(personChip.textContent).toContain("3");

    const orgChip = screen.getByRole("button", { name: /Organization/ });
    expect(orgChip.textContent).toContain("Organization");
    expect(orgChip.textContent).toContain("2");
  });

  it("does not render chips for types that have zero entities", async () => {
    render(<GraphView caseId="demo" selectedId={null} onSelect={() => {}} />);

    await screen.findByRole("button", { name: /Person/ });
    expect(screen.queryByRole("button", { name: /Date/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Money/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Document/ })).toBeNull();
  });

  it("toggles aria-pressed when a chip is clicked twice", async () => {
    render(<GraphView caseId="demo" selectedId={null} onSelect={() => {}} />);

    const personChip = await screen.findByRole("button", { name: /Person/ });
    expect(personChip.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(personChip);
    expect(personChip.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(personChip);
    expect(personChip.getAttribute("aria-pressed")).toBe("false");
  });

  it("only one chip can be active at a time", async () => {
    render(<GraphView caseId="demo" selectedId={null} onSelect={() => {}} />);

    const personChip = await screen.findByRole("button", { name: /Person/ });
    const orgChip = screen.getByRole("button", { name: /Organization/ });

    fireEvent.click(personChip);
    expect(personChip.getAttribute("aria-pressed")).toBe("true");
    expect(orgChip.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(orgChip);
    expect(personChip.getAttribute("aria-pressed")).toBe("false");
    expect(orgChip.getAttribute("aria-pressed")).toBe("true");
  });
});
