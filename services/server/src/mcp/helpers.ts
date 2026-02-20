/**
 * Pure helper functions for the MCP server.
 * Extracted to a separate module so they can be unit tested.
 */

// Return wall-clock duration in ms, or null if end time is missing/invalid.
export function calcDuration(startTime: string, endTime: string | null): number | null {
  if (!endTime) return null;
  const d = new Date(endTime).getTime() - new Date(startTime).getTime();
  return d > 0 ? d : null;
}

// Metadata comes back as a parsed JS object from the ClickHouse JSON client.
// String() would give "[object Object]", so keep it as-is.
export function normMetadata(v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v || null; }
  }
  return v; // already an object
}
