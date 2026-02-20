import { describe, it, expect } from "vitest";
import { generateTraceId, generateSpanId } from "../ids.js";

describe("generateTraceId", () => {
  it("returns 32-char lowercase hex", () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 200 }, generateTraceId));
    expect(ids.size).toBe(200);
  });
});

describe("generateSpanId", () => {
  it("returns 16-char lowercase hex", () => {
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 200 }, generateSpanId));
    expect(ids.size).toBe(200);
  });

  it("is half the length of a trace ID", () => {
    expect(generateSpanId().length).toBe(generateTraceId().length / 2);
  });
});
