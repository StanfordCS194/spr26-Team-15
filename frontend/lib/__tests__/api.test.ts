import { describe, expect, it } from "vitest";

import { parseProvenance } from "@/lib/api";

describe("parseProvenance", () => {
  it("parses a standard provenance string", () => {
    const p = parseProvenance("abc-123:abc-123:0:10-25");
    expect(p).toEqual({ docId: "abc-123", chunkId: "abc-123:0", start: 10, end: 25 });
  });

  it("returns null for malformed input", () => {
    expect(parseProvenance("not-a-provenance")).toBeNull();
  });

  it("handles multi-colon chunk IDs", () => {
    const p = parseProvenance("doc:X:chunk:Y:5-30");
    expect(p?.start).toBe(5);
    expect(p?.end).toBe(30);
  });
});
