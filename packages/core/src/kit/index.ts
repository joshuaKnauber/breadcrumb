/**
 * @breadcrumb-sh/core/kit — headless, unstyled building blocks for a custom
 * tracing UI: span-tree assembly, chat-message detection, payload previews,
 * and display formatters. Pure and browser-safe; bring your own components.
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
export { fmtMs, fmtTokens, fmtCost, fmtMoney, fmtInt, fmtTime } from "./format.js";
