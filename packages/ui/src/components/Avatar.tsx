import { COLORS, type Color } from "@ostra/core";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { BADGE_CLASSES } from "../lib/colors.ts";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable tint per person, from the same palette as labels (gray is kept for "unknown"). */
export function avatarColor(seed: string): Color {
  const palette = COLORS.filter((c) => c !== "gray");
  return palette[hash(seed.toLowerCase()) % palette.length]!;
}

export function initials(name: string): string {
  const clean = name.replace(/["'<>()]/g, "").replace(/@.*/, "").trim();
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]![0]!.toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * Initials on a soft tint. `badge` is a small overlay in the corner, e.g. the
 * account dot showing which address a message came to.
 */
export function Avatar({
  name,
  seed,
  size = 28,
  imageUrl,
  badge,
  className,
}: {
  name: string;
  seed?: string;
  size?: number;
  imageUrl?: string | null;
  badge?: ReactNode;
  className?: string;
}) {
  const color = avatarColor(seed ?? name);
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }} aria-hidden="true">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className={cn("flex h-full w-full select-none items-center justify-center rounded-full font-semibold tracking-tight", BADGE_CLASSES[color])}
          style={{ fontSize: Math.max(9, Math.round(size * 0.38)) }}
        >
          {initials(name)}
        </span>
      )}
      {badge && <span className="absolute -bottom-px -right-px flex rounded-full ring-2 ring-panel">{badge}</span>}
    </span>
  );
}
