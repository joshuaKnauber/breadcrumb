import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "breadcrumb:theme";
const listeners = new Set<() => void>();

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** Stamps `data-theme` so the CSS override wins over the OS preference. */
function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
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
  apply(theme);
  listeners.forEach((fn) => fn());
}

/** Applied before React mounts so the first paint is already correct. */
export function initTheme(): void {
  apply(read());
}

/** `theme` is what the user picked; `resolved` is what is on screen. */
function snapshot(): string {
  const theme = read();
  return `${theme}:${theme === "system" ? (darkQuery().matches ? "dark" : "light") : theme}`;
}

export function useTheme(): {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
} {
  const state = useSyncExternalStore(subscribe, snapshot, () => "system:light");
  const [theme, resolved] = state.split(":") as [Theme, "light" | "dark"];
  return { theme, resolved, setTheme };
}
