/**
 * Loading placeholders are laid out to match the real thing they stand in for,
 * so the page doesn't reflow when data lands. Each view builds its own from
 * this block rather than sharing one generic spinner.
 */
export function Skeleton({
  w,
  h = 11,
  className = "",
}: {
  w?: number | string;
  h?: number | string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`bc-skeleton block rounded-[3px] bg-raised ${className}`}
      style={{ width: w, height: h }}
    />
  );
}

/** Wraps a skeleton tree so screen readers announce the wait, not the shapes. */
export function Loading({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      {children}
    </div>
  );
}
