/**
 * Bounds a captured input/output payload before storage. Prompts and tool
 * results can be large; without a cap a single span could write megabytes into
 * the user's database. `maxChars <= 0` disables the cap.
 *
 * The budget is spent on the long strings inside the payload rather than on the
 * payload as a whole, so a capped message array is still an array of messages
 * with shortened text. Flattening it to one truncated string saves the same
 * bytes and costs the reader a conversation they can no longer read.
 */
export function capPayload(value: unknown, maxChars: number): unknown {
  if (value == null || maxChars <= 0) return value;
  if (typeof value === "string") return capString(value, maxChars);
  if (measure(value) <= maxChars) return value;

  // Every string gets the same allowance rather than a proportional share, so
  // one enormous field can't crowd out the short ones carrying the structure's
  // meaning — roles, keys, tool names. Halve it until the whole thing fits.
  let allowance = maxChars;
  while (allowance > MIN_ALLOWANCE) {
    allowance = Math.max(Math.floor(allowance / 2), MIN_ALLOWANCE);
    const capped = capStrings(value, allowance);
    if (measure(capped) <= maxChars) return capped;
  }

  // Structural rather than textual — thousands of tiny fields. Trimming strings
  // can't shrink that, so fall back to bounding the serialized form.
  return capString(stringify(value), maxChars);
}

const MIN_ALLOWANCE = 80;

function capString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…[breadcrumb: truncated ${value.length - maxChars} more chars]`;
}

function capStrings(value: unknown, allowance: number): unknown {
  if (typeof value === "string") return capString(value, allowance);
  if (Array.isArray(value)) return value.map((v) => capStrings(v, allowance));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = capStrings(v, allowance);
    return out;
  }
  return value;
}

function measure(value: unknown): number {
  return stringify(value).length;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
