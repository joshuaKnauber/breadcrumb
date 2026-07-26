/**
 * @breadcrumb-sh/core/kit — headless, unstyled building blocks for a custom
 * tracing UI: span-tree assembly, the trace view model, chat-message detection,
 * payload previews, and display formatters. Browser-safe; bring your own
 * components.
 */
export {
  asMessages,
  preview,
  flowRows,
  fullRows,
  hotspots,
  selfTime,
  selfIntervals,
  displayName,
  type ChatMessage,
  type FlowRow,
  type Hotspots,
} from "./tree.js";
export {
  extent,
  traceModel,
  defaultSelection,
  keyboardTarget,
  heatLevel,
  type HeatLevel,
  type TraceModel,
  type TraceRow,
  type TraceTotals,
  type TraceViewMode,
} from "./trace.js";
export {
  fmtMs,
  fmtTokens,
  fmtCompact,
  fmtCost,
  fmtMoney,
  fmtInt,
  fmtTime,
  fmtAgo,
} from "./format.js";
