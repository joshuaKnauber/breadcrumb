/**
 * @breadcrumb-sh/react — the Breadcrumb dashboard as a React component, plus
 * the hooks it is built on for anyone assembling their own.
 *
 *   import { BreadcrumbDashboard } from "@breadcrumb-sh/react";
 *   import "@breadcrumb-sh/react/styles.css";
 *
 *   <BreadcrumbDashboard api="/api/breadcrumb" basePath="/admin/traces" />
 */
export { BreadcrumbDashboard } from "./dashboard/Dashboard.js";
export type {
  BreadcrumbDashboardProps,
  DashboardPage,
  Hideable,
} from "./dashboard/Dashboard.js";
// Values live in ./routing, which is server-safe; only the types come from here.
export type { Page, Route } from "./dashboard/router.js";
export type { Theme } from "./dashboard/theme.js";

export * from "./hooks.js";
