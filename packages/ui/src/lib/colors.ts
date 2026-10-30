import type { Color } from "@ostra/core";

/** Tinted background + bright text, for label badges. */
export const BADGE_CLASSES: Record<Color, string> = {
  blue: "bg-blue-bg text-blue",
  purple: "bg-purple-bg text-purple",
  amber: "bg-amber-bg text-amber",
  green: "bg-green-bg text-green",
  pink: "bg-pink-bg text-pink",
  teal: "bg-teal-bg text-teal",
  gray: "bg-gray-bg text-gray",
};

/** Solid dot, for accounts and labels in the sidebar. */
export const DOT_CLASSES: Record<Color, string> = {
  blue: "bg-blue",
  purple: "bg-purple",
  amber: "bg-amber",
  green: "bg-green",
  pink: "bg-pink",
  teal: "bg-teal",
  gray: "bg-gray",
};
