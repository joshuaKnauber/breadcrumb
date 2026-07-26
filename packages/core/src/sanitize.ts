/**
 * Bounds a captured input/output payload before storage. Prompts and tool
 * results can be large; without a cap a single span could write megabytes into
 * the user's database. Returns the value unchanged when small, or a truncated
 * marker string when it exceeds `maxChars`. `maxChars <= 0` disables the cap.
 */
export function capPayload(value: unknown, maxChars: number): unknown {
  if (value == null || maxChars <= 0) return value;
  const s = typeof value === "string" ? value : safeStringify(value);
  if (s.length <= maxChars) return value;
  return `${s.slice(0, maxChars)}…[breadcrumb: truncated ${s.length - maxChars} more chars]`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
