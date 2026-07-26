"use client";
import { createContext, useContext, type RefObject } from "react";

/**
 * Every rule in the stylesheet is scoped under `.bc-root`, so anything that
 * portals to `document.body` would render unstyled. Popups are portalled into
 * this element instead: still out of the layout flow for stacking, still inside
 * the scope. They position fixed, so the dashboard's own overflow can't clip
 * them.
 */
const PortalContext = createContext<RefObject<HTMLElement | null> | null>(null);

export const PortalProvider = PortalContext.Provider;

export function usePortalContainer(): RefObject<HTMLElement | null> | undefined {
  return useContext(PortalContext) ?? undefined;
}
