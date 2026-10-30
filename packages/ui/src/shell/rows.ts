import type { Category, ThreadSummary } from "@ostra/core";

export type Row =
  | { kind: "thread"; id: string; bundle?: Category }
  | { kind: "bundle"; category: Exclude<Category, "primary">; ids: string[]; unread: number; expanded: boolean };

/**
 * Turn a time-sorted list into display rows. Primary mail stays as rows;
 * each other category collapses into one bundle row at the position of its
 * newest thread, expanding inline.
 */
export function buildRows(ids: string[], threads: Record<string, ThreadSummary>, opts: { bundle: boolean; expanded: ReadonlySet<string> }): Row[] {
  if (!opts.bundle) return ids.filter((id) => threads[id]).map((id) => ({ kind: "thread", id }));
  const groups = new Map<Category, string[]>();
  for (const id of ids) {
    const t = threads[id];
    if (!t || t.category === "primary") continue;
    const g = groups.get(t.category);
    if (g) g.push(id);
    else groups.set(t.category, [id]);
  }
  const rows: Row[] = [];
  const placed = new Set<Category>();
  for (const id of ids) {
    const t = threads[id];
    if (!t) continue;
    if (t.category === "primary") {
      rows.push({ kind: "thread", id });
      continue;
    }
    if (placed.has(t.category)) continue;
    placed.add(t.category);
    const members = groups.get(t.category)!;
    const expanded = opts.expanded.has(t.category);
    rows.push({ kind: "bundle", category: t.category, ids: members, unread: members.filter((m) => !threads[m]!.isRead).length, expanded });
    if (expanded) for (const m of members) rows.push({ kind: "thread", id: m, bundle: t.category });
  }
  return rows;
}

export const rowKey = (r: Row) => (r.kind === "thread" ? `t:${r.id}` : `b:${r.category}`);
