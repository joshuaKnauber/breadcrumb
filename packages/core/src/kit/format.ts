// Display formatters shared by the dashboard component and any custom UI.
// Pure, dependency-free, and safe in the browser.

/** Duration in ms → "820ms" / "12s". */
export const fmtMs = (ms: number | null | undefined): string => {
  if (ms == null) return "–";
  return ms >= 10_000 ? `${(ms / 1000).toFixed(0)}s` : `${ms}ms`;
};

/** Counts at a glance: "1.2k" past a thousand, exact below. */
export const fmtCompact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/** Input/output token pair → "1.2k→340", or "–" when both zero. */
export const fmtTokens = (input: number, output: number): string => {
  if (input === 0 && output === 0) return "–";
  return `${fmtCompact(input)}→${fmtCompact(output)}`;
};

/** Cost with 4 decimals for per-span/run figures; "–" when unknown. */
export const fmtCost = (cost: number | null | undefined): string =>
  cost == null ? "–" : `$${cost.toFixed(4)}`;

/** Compact money: 2 decimals at/above $1, 4 below — for tiles and totals. */
export const fmtMoney = (n: number | null | undefined): string => {
  if (n == null) return "$0";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
};

/** Integer with thousands separators. */
export const fmtInt = (n: number): string => n.toLocaleString();

/** Epoch ms → local "01:03 PM". */
export const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Epoch ms → "3m ago", falling back to a date past a month. `now` is a
 * parameter so callers can render a stable value and tests stay deterministic.
 */
export const fmtAgo = (ms: number, now: number = Date.now()): string => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
};
