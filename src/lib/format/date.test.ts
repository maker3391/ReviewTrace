import { describe, expect, it } from "vitest";

import {
  formatCompactDateTime,
  formatDate,
  formatExactDateTime,
  formatRelativeTime,
} from "@/lib/format/date";

const VALUE = new Date("2026-09-01T10:23:41.987Z");

describe("timestamp presentation policy", () => {
  it("uses one fixed UTC meaning for exact and compact formats", () => {
    expect(formatDate(VALUE)).toBe("2026-09-01");
    expect(formatExactDateTime(VALUE)).toBe("2026-09-01 10:23:41 UTC");
    expect(formatCompactDateTime(VALUE)).toBe("09-01 10:23");
  });

  it("formats dashboard relative time in both locales", () => {
    const now = new Date("2026-09-01T12:23:41.987Z");
    expect(formatRelativeTime(VALUE, now, "ko")).toBe("2시간 전");
    expect(formatRelativeTime(VALUE, now, "en")).toBe("2h ago");
  });

  it("uses yesterday with the UTC clock time", () => {
    const now = new Date("2026-09-02T08:00:00.000Z");
    expect(formatRelativeTime(VALUE, now, "ko")).toBe("어제 10:23");
  });

  it("handles null at the component boundary and invalid values in formatters", () => {
    const invalid = new Date(Number.NaN);
    expect(formatDate(invalid)).toBe("—");
    expect(formatExactDateTime(invalid)).toBe("—");
    expect(formatCompactDateTime(invalid)).toBe("—");
    expect(formatRelativeTime(invalid, VALUE, "ko")).toBe("—");
  });
});
