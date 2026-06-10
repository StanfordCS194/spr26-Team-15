import { describe, expect, it } from "vitest";

import { formatCaseDate, parseCaseDate } from "@/lib/date";

describe("parseCaseDate", () => {
  it("treats plain ISO dates as local calendar dates", () => {
    const parsed = parseCaseDate("2001-03-12");

    expect(parsed).toBeTruthy();
    expect(parsed?.getFullYear()).toBe(2001);
    expect(parsed?.getMonth()).toBe(2);
    expect(parsed?.getDate()).toBe(12);
  });

  it("returns null for invalid input", () => {
    expect(parseCaseDate("not-a-date")).toBeNull();
  });
});

describe("formatCaseDate", () => {
  it("formats ISO date-only values without shifting them backwards", () => {
    expect(formatCaseDate("2001-03-09", "en-US")).toBe("Mar 9, 2001");
    expect(formatCaseDate("2001-03-12", "en-US")).toBe("Mar 12, 2001");
  });
});
