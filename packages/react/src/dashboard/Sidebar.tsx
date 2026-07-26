"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  CurrencyDollar,
  Desktop,
  Moon,
  PlugsConnected,
  SidebarSimple,
  Stack,
  Sun,
} from "@phosphor-icons/react";
import { Logo } from "./ui/Logo.js";
import { ToggleGroup } from "./ui/ToggleGroup.js";
import { RouteLink, useNavigation } from "./navigation.js";
import { usePortalContainer } from "./root.js";
import { useTheme, type Theme } from "./theme.js";

const KEY = "breadcrumb:sidebar";
const listeners = new Set<() => void>();

const readCollapsed = () => localStorage.getItem(KEY) === "1";

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setCollapsed(v: boolean): void {
  if (v) localStorage.setItem(KEY, "1");
  else localStorage.removeItem(KEY);
  listeners.forEach((fn) => fn());
}

const ICON = 16;

const BUILTIN_ICONS: Record<string, ReactNode> = {
  sessions: <Stack size={ICON} />,
  cost: <CurrencyDollar size={ICON} />,
  mcp: <PlugsConnected size={ICON} />,
};

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  { value: "system", label: "Match system", icon: <Desktop size={14} /> },
];

export interface NavEntry {
  page: string;
  label: string;
  icon?: ReactNode;
}

export function Sidebar({
  entries,
  showTheme,
  theme: controlled,
}: {
  entries: NavEntry[];
  showTheme: boolean;
  theme?: Theme;
}) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const { route } = useNavigation();
  const { theme, setTheme } = useTheme(controlled);

  return (
    <Tooltip.Provider delay={300}>
      <aside
        className={`flex flex-none flex-col border-r border-line bg-canvas px-2 py-3 ${
          collapsed ? "w-[52px]" : "w-[224px]"
        }`}
      >
        <div className="flex items-center">
          <Slot>
            <Logo size={17} />
          </Slot>
          {!collapsed && <span className="text-[13.5px] font-semibold">breadcrumb</span>}
        </div>

        <nav className="mt-4 grid gap-0.5">
          {entries.map((entry) => {
            const active = isActive(route.page, entry.page);
            const link = (
              <RouteLink
                // The env filter is scope, not location, so it survives tab changes.
                to={{ page: entry.page, env: route.env }}
                aria-label={entry.label}
                aria-current={active ? "page" : undefined}
                className={`flex items-center rounded-md text-[12.5px] ${
                  collapsed ? "w-9" : "w-full"
                } ${
                  active
                    ? "bg-raised font-medium text-fg"
                    : "text-muted hover:bg-hover hover:text-fg"
                }`}
              >
                <Slot>{entry.icon ?? BUILTIN_ICONS[entry.page] ?? <Stack size={ICON} />}</Slot>
                {!collapsed && <span className="truncate pr-2">{entry.label}</span>}
              </RouteLink>
            );
            return collapsed ? (
              <Hint key={entry.page} label={entry.label}>
                {link}
              </Hint>
            ) : (
              <div key={entry.page}>{link}</div>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center">
          <Hint label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className="flex w-9 items-center rounded-md text-faint hover:bg-hover hover:text-fg"
            >
              <Slot>
                <SidebarSimple size={15} mirrored={collapsed} />
              </Slot>
            </button>
          </Hint>
          {/* A host driving the palette owns the choice; a second control would lie. */}
          {!collapsed && showTheme && controlled === undefined && (
            <ToggleGroup
              ariaLabel="Colour theme"
              value={theme}
              onChange={setTheme}
              options={THEMES}
              className="ml-auto"
            />
          )}
        </div>
      </aside>
    </Tooltip.Provider>
  );
}

/** A session and a trace are both places inside the sessions tab. */
function isActive(current: string, page: string): boolean {
  if (page !== "sessions") return current === page;
  return current === "sessions" || current === "session" || current === "trace";
}

/**
 * The icon column. Every row in the sidebar leads with one of these, so the
 * collapsed rail is exactly this column with the labels removed — icons keep
 * their position instead of sliding as the sidebar changes width.
 */
function Slot({ children }: { children: ReactNode }) {
  return <span className="flex h-8 w-9 flex-none items-center justify-center">{children}</span>;
}

function Hint({ label, children }: { label: string; children: ReactNode }) {
  const container = usePortalContainer();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className="block w-9" />}>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={container}>
        <Tooltip.Positioner side="right" sideOffset={8}>
          <Tooltip.Popup className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] whitespace-nowrap text-fg shadow-lg">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
