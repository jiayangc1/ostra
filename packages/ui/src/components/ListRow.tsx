import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "prefix"> {
  selected?: boolean;
  /** Keyboard cursor position (j/k), distinct from the open thread. */
  active?: boolean;
  unread?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

/**
 * A dense, keyboard-addressable row inset from the list edges. Hover and the
 * keyboard cursor share a soft fill; the open thread gets a stronger one.
 */
export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { selected, active, unread, leading, trailing, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected || false}
      data-active={active || undefined}
      data-unread={unread || undefined}
      data-focus-inset
      tabIndex={active ? 0 : -1}
      className={cn(
        "group/row relative mx-2 flex cursor-default select-none gap-3 rounded-card px-3 py-2.5 outline-none",
        "transition-[background-color,box-shadow] duration-[var(--motion-fast)] ease-out",
        selected ? "bg-active" : active ? "bg-hover" : "hover:bg-hover",
        active && "shadow-[inset_0_0_0_1px_var(--o-line-hover)]",
        className,
      )}
      {...rest}
    >
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
    </div>
  );
});
