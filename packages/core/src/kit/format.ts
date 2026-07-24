// Display formatters shared by the baked-in dashboard and any custom UI.
// Pure, dependency-free, and safe in the browser.

/** Duration in ms → "820ms" / "12s". */
export const fmtMs = (ms: number | null | undefined): string => {
  if (ms == null) return "–";
  return ms >= 10_000 ? `${(ms / 1000).toFixed(0)}s` : `${ms}ms`;
};

/** Input/output token pair → "1.2k→340", or "–" when both zero. */
export const fmtTokens = (input: number, output: number): string => {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  if (input === 0 && output === 0) return "–";
  return `${k(input)}→${k(output)}`;
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
