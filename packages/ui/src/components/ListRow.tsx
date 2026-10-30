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

/** A dense, keyboard-addressable row. Used by the message list and bundles. */
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
        "group relative flex cursor-default select-none gap-3 border-b border-line px-4 py-2.5 outline-none",
        "transition-colors duration-[var(--motion-fast)] ease-out",
        "hover:bg-hover",
        selected && "bg-active hover:bg-active",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-center before:scale-y-0 before:bg-fg before:transition-transform before:duration-[var(--motion-normal)] before:ease-spring",
        active && "before:scale-y-100",
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
