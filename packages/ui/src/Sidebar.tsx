import { useSyncExternalStore } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Tooltip } from "@base-ui/react/tooltip";
import { CurrencyDollar, Desktop, Moon, SidebarSimple, Stack, Sun } from "@phosphor-icons/react";
import { Logo } from "./ui/Logo.js";
import { ToggleGroup } from "./ui/ToggleGroup.js";
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

const TABS = [
  {
    to: "/",
    label: "Sessions",
    icon: <Stack size={ICON} />,
    match: (p: string) => p === "/" || p.startsWith("/sessions"),
  },
  {
    to: "/cost",
    label: "Cost",
    icon: <CurrencyDollar size={ICON} />,
    match: (p: string) => p.startsWith("/cost"),
  },
];

const THEMES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  { value: "system", label: "Match system", icon: <Desktop size={14} /> },
];

export function Sidebar() {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const { pathname, search } = useLocation();
  const { theme, setTheme } = useTheme();

  // Carry the environment filter across nav so switching pages keeps the scope.
  const env = new URLSearchParams(search).get("env");
  const carry = env ? `?env=${encodeURIComponent(env)}` : "";

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
          {TABS.map((t) => {
            const active = t.match(pathname);
            const link = (
              <NavLink
                to={`${t.to}${carry}`}
                aria-label={t.label}
                className={`flex items-center rounded-md text-[12.5px] ${
                  collapsed ? "w-9" : "w-full"
                } ${
                  active
                    ? "bg-raised font-medium text-fg"
                    : "text-muted hover:bg-hover hover:text-fg"
                }`}
              >
                <Slot>{t.icon}</Slot>
                {!collapsed && <span className="truncate pr-2">{t.label}</span>}
              </NavLink>
            );
            return collapsed ? (
              <Hint key={t.to} label={t.label}>
                {link}
              </Hint>
            ) : (
              <div key={t.to}>{link}</div>
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
          {!collapsed && (
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

/**
 * The icon column. Every row in the sidebar leads with one of these, so the
 * collapsed rail is exactly this column with the labels removed — icons keep
 * their position instead of sliding as the sidebar changes width.
 */
function Slot({ children }: { children: React.ReactNode }) {
  return <span className="flex h-8 w-9 flex-none items-center justify-center">{children}</span>;
}

function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className="block w-9" />}>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={8}>
          <Tooltip.Popup className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] whitespace-nowrap text-fg shadow-lg">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
