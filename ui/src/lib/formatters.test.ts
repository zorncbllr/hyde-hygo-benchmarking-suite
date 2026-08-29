import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatDuration,
  formatMs,
  formatSci,
} from "./formatters";

describe("formatCompact", () => {
  it("leaves small numbers untouched", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(999)).toBe("999");
  });

  it("scales thousands and millions", () => {
    expect(formatCompact(1000)).toBe("1.0k");
    expect(formatCompact(50_000)).toBe("50.0k");
    expect(formatCompact(4_000_000)).toBe("4.0M");
  });
});

describe("formatSci", () => {
  it("formats exponential notation", () => {
    expect(formatSci(0.000123, 2)).toBe("1.23e-4");
  });

  it("handles zero and non-finite", () => {
    expect(formatSci(0)).toBe("0");
    expect(formatSci(Number.NaN)).toBe("n/a");
    expect(formatSci(Number.POSITIVE_INFINITY)).toBe("n/a");
  });
});

describe("formatDuration", () => {
  it("formats hours, minutes and seconds", () => {
    expect(formatDuration(3661)).toBe("1h 1m 1s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(42)).toBe("42s");
  });

  it("handles invalid input", () => {
    expect(formatDuration(Number.NaN)).toBe("n/a");
    expect(formatDuration(-5)).toBe("n/a");
  });
});

describe("formatMs", () => {
  it("formats sub-millisecond, milliseconds and seconds", () => {
    expect(formatMs(0.5)).toBe("500us");
    expect(formatMs(12.34)).toBe("12.3ms");
    expect(formatMs(1500)).toBe("1.50s");
  });

  it("handles invalid input", () => {
    expect(formatMs(Number.NaN)).toBe("n/a");
  });
});
