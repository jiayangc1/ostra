import { useEffect, useState } from "react";

function reducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps a surface mounted long enough to play its exit animation.
 * `closing` is true between `open` turning false and the unmount.
 */
export function usePresence(open: boolean, exitMs = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  // Opening mounts in the same render; closing waits for the animation.
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 0 : exitMs);
    return () => clearTimeout(t);
  }, [open, mounted, exitMs]);

  return { mounted: open || mounted, closing: !open && mounted };
}
