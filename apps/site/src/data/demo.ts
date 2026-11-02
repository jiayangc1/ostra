/**
 * The mail shown in the landing page's hero: three addresses flowing into one
 * inbox. Shared by the server-rendered first frame and the animation script.
 */

export type Color = "blue" | "purple" | "amber" | "green" | "pink" | "teal" | "gray" | "red";

export const ACCOUNTS = {
  g: { address: "sam.rivera@gmail.com", provider: "Gmail", color: "blue" },
  n: { address: "sam@northwind.io", provider: "Outlook", color: "amber" },
  t: { address: "hello@tidepool.dev", provider: "Your domain", color: "green" },
} as const satisfies Record<string, { address: string; provider: string; color: Color }>;

export type AccountKey = keyof typeof ACCOUNTS;
export const ACCOUNT_KEYS = Object.keys(ACCOUNTS) as AccountKey[];

export type Category = "newsletters" | "notifications";
export const CATEGORY_NAMES: Record<Category, string> = { newsletters: "Newsletters", notifications: "Notifications" };

export interface Mail {
  kind: "mail";
  account: AccountKey;
  sender: string;
  tint: Color;
  subject: string;
  time: string;
  unread: boolean;
  label?: { name: string; color: Color };
}

export interface Bundle {
  kind: "bundle";
  category: Category;
  count: number;
  fresh: number;
}

/** Newsletters and notifications don't get rows of their own: they fold into their bundle. */
export interface Noise {
  kind: "noise";
  account: AccountKey;
  category: Category;
}

export const INITIAL: (Mail | Bundle)[] = [
  { kind: "mail", account: "n", sender: "Marcus Chen", tint: "teal", subject: "Q4 roadmap review moved to 3pm", time: "18m", unread: true },
  { kind: "bundle", category: "notifications", count: 11, fresh: 0 },
  { kind: "mail", account: "g", sender: "Mom", tint: "pink", subject: "Sunday dinner?", time: "41m", unread: true },
  { kind: "mail", account: "t", sender: "Jordan Blake", tint: "blue", subject: "Pilot feedback from the clinic team", time: "1h", unread: false, label: { name: "Customers", color: "blue" } },
  { kind: "bundle", category: "newsletters", count: 4, fresh: 0 },
  { kind: "mail", account: "n", sender: "Aisha Bello", tint: "amber", subject: "Interview loop for the staff engineer role", time: "2h", unread: false },
  { kind: "mail", account: "t", sender: "Hannah Okafor", tint: "green", subject: "Re: SAFE side letter", time: "3h", unread: false },
];

export const ARRIVALS: (Mail | Noise)[] = [
  { kind: "mail", account: "t", sender: "Priya Natarajan", tint: "purple", subject: "Re: Tidepool seed: next steps", time: "now", unread: true, label: { name: "Investors", color: "purple" } },
  { kind: "noise", account: "g", category: "newsletters" },
  { kind: "mail", account: "n", sender: "Dana Whitfield", tint: "pink", subject: "Contract redlines, two small changes", time: "now", unread: true, label: { name: "Legal", color: "amber" } },
  { kind: "noise", account: "t", category: "notifications" },
  { kind: "noise", account: "n", category: "notifications" },
  { kind: "mail", account: "g", sender: "Alex Rivera", tint: "teal", subject: "Flights for the 14th", time: "now", unread: true },
];

export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]![0]!.toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export const unreadCount = (rows: (Mail | Bundle)[]) => rows.filter((r) => r.kind === "mail" && r.unread).length;
