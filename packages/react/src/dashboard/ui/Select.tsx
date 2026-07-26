"use client";
import type { ReactNode } from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { CaretDown, Check } from "@phosphor-icons/react";
import { usePortalContainer } from "../root.js";

export interface SelectItem {
  value: string;
  label: string;
}

/**
 * The one dropdown primitive the dashboard uses. Base UI handles positioning,
 * focus and keyboard behaviour; everything visual comes from the theme tokens.
 */
export function Select({
  value,
  onChange,
  items,
  label,
  icon,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  items: SelectItem[];
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const container = usePortalContainer();
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => onChange(String(v))}
      items={items}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={`flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12.5px] text-muted hover:border-line-strong hover:text-fg disabled:opacity-50 ${className}`}
      >
        {icon}
        <BaseSelect.Value className="truncate" />
        <BaseSelect.Icon className="ml-auto pl-1 text-faint">
          <CaretDown size={11} weight="bold" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner sideOffset={4} align="start">
          <BaseSelect.Popup className="min-w-[var(--anchor-width)] rounded-md border border-line bg-panel py-1 shadow-lg">
            <BaseSelect.List>
              {items.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[12.5px] text-muted select-none data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[selected]:text-fg"
                >
                  <span className="flex w-3 flex-none justify-center">
                    <BaseSelect.ItemIndicator>
                      <Check size={11} weight="bold" />
                    </BaseSelect.ItemIndicator>
                  </span>
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
