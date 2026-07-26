"use client";
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "breadcrumb:theme";
const listeners = new Set<() => void>();

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // On "system" the resolved theme can change without us touching anything, and
  // the chart reads colours in JS rather than through the cascade.
  const mq = darkQuery();
  mq.addEventListener("change", fn);
  return () => {
    listeners.delete(fn);
    mq.removeEventListener("change", fn);
  };
}

export function setTheme(theme: Theme): void {
  if (theme === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, theme);
  listeners.forEach((fn) => fn());
}

/** `theme` is what the user picked; `resolved` is what is on screen. */
function snapshot(): string {
  const theme = read();
  return `${theme}:${theme === "system" ? (darkQuery().matches ? "dark" : "light") : theme}`;
}

/**
 * The dashboard stamps `data-theme` on its own root rather than on <html>: an
 * embedded dashboard has no business relabelling the host document, which may
 * be running its own dark mode off the same attribute. Leaving the attribute
 * off means "follow the OS", which the stylesheet handles in CSS so a system
 * user never sees a flash of the wrong palette before hydration.
 *
 * Pass `controlled` to slave the dashboard to the host's own theme state.
 */
export function useTheme(controlled?: Theme): {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
} {
  const state = useSyncExternalStore(subscribe, snapshot, () => "system:light");
  const [stored, storedResolved] = state.split(":") as [Theme, "light" | "dark"];
  if (controlled === undefined) {
    return { theme: stored, resolved: storedResolved, setTheme };
  }
  const resolved = controlled === "system" ? storedResolved : controlled;
  return { theme: controlled, resolved, setTheme: () => {} };
}
