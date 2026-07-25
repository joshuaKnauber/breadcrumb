import type { ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";

export interface ToggleOption<T extends string> {
  value: T;
  /** Always the accessible name; shown as text unless `icon` replaces it. */
  label: string;
  icon?: ReactNode;
}

/**
 * The one segmented control in the dashboard. Every mutually exclusive choice
 * that fits in a row uses it — theme, trace view, cost window — so a group of
 * options always looks and behaves the same wherever it turns up.
 */
export function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  vertical = false,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: ToggleOption<T>[];
  ariaLabel: string;
  vertical?: boolean;
  className?: string;
}) {
  return (
    <Tooltip.Provider delay={400}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={`flex w-max gap-0.5 rounded-md border border-line bg-panel p-0.5 ${
          vertical ? "flex-col" : ""
        } ${className}`}
      >
        {options.map((o) => {
          const active = o.value === value;
          const button = (
            <button
              role="radio"
              aria-checked={active}
              aria-label={o.icon ? o.label : undefined}
              onClick={() => onChange(o.value)}
              className={`flex items-center justify-center gap-1.5 rounded text-[11.5px] ${
                o.icon ? "px-1.5 py-1" : "px-2 py-0.5"
              } ${active ? "bg-raised text-fg" : "text-faint hover:text-muted"}`}
            >
              {o.icon ?? o.label}
            </button>
          );
          if (!o.icon) return <div key={o.value}>{button}</div>;
          return (
            <Tooltip.Root key={o.value}>
              <Tooltip.Trigger render={<span className="flex" />}>{button}</Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner side={vertical ? "right" : "top"} sideOffset={6}>
                  <Tooltip.Popup className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] whitespace-nowrap text-fg shadow-lg">
                    {o.label}
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </div>
    </Tooltip.Provider>
  );
}
