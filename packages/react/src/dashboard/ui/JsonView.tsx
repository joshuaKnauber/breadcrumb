"use client";
import { useState } from "react";
import { CaretDown, CaretRight } from "./icons.js";

/**
 * Structured payloads as a browsable tree rather than a wall of stringified
 * JSON. Tool arguments and tool results are objects; read as one long line they
 * hide the one field you opened the span to check.
 *
 * Nesting opens down to `OPEN_TO_DEPTH` and folds below it, so a result with a
 * big nested body still lands as something you can scan.
 */
const OPEN_TO_DEPTH = 2;

export function JsonView({ value }: { value: unknown }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel px-3 py-2 font-mono text-[11.5px] leading-[1.7]">
      <Node value={value} depth={0} />
    </div>
  );
}

function Node({ value, depth }: { value: unknown; depth: number }) {
  const branch = isBranch(value);
  const [open, setOpen] = useState(depth < OPEN_TO_DEPTH);
  if (!branch) return <Leaf value={value} />;

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const [openBrace, closeBrace] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return <span className="text-faint">{openBrace + closeBrace}</span>;
  }

  return (
    <span>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 align-baseline text-faint hover:text-fg"
      >
        {open ? <CaretDown size={8} /> : <CaretRight size={8} />}
        <span>{openBrace}</span>
        {!open && (
          <span className="text-faint">
            {entries.length} {Array.isArray(value) ? "items" : "keys"}
            {closeBrace}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="border-l border-line pl-3">
            {entries.map(([key, child]) => (
              <div key={key} className="flex gap-1.5">
                <span className="flex-none text-muted">{key}:</span>
                <span className="min-w-0">
                  <Node value={child} depth={depth + 1} />
                </span>
              </div>
            ))}
          </div>
          <span className="text-faint">{closeBrace}</span>
        </>
      )}
    </span>
  );
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-faint">null</span>;
  if (value === undefined) return <span className="text-faint">undefined</span>;
  if (typeof value === "string") {
    // Multi-line strings are the payload's actual content — prompts, results —
    // so they wrap and keep their newlines instead of running off the side.
    return <span className="whitespace-pre-wrap text-fg">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-heat-mid tabular-nums">{String(value)}</span>;
  }
  return <span className="text-fg">{String(value)}</span>;
}

function isBranch(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}
