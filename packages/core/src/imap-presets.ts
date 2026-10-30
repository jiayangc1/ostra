/** Known IMAP/SMTP settings, so most custom-domain hosts need only an address and app password. */
export interface ImapPreset {
  id: string;
  name: string;
  domains: string[];
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  /** Shown next to the password field. */
  passwordHint?: string;
  /** Where the user creates the app password. */
  passwordUrl?: string;
}

export const IMAP_PRESETS: readonly ImapPreset[] = [
  {
    id: "gmail",
    name: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    passwordHint: "Turn on 2-Step Verification, then create an app password.",
    passwordUrl: "https://myaccount.google.com/apppasswords",
  },
  {
    id: "fastmail",
    name: "Fastmail",
    domains: ["fastmail.com", "fastmail.fm"],
    imap: { host: "imap.fastmail.com", port: 993, secure: true },
    smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
    passwordHint: "Use an app password from Settings → Privacy & Security.",
  },
  {
    id: "icloud",
    name: "iCloud Mail",
    domains: ["icloud.com", "me.com", "mac.com"],
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    passwordHint: "Create an app-specific password under Sign-In and Security.",
    passwordUrl: "https://account.apple.com/account/manage",
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    domains: ["zoho.com", "zohomail.com"],
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    domains: ["yahoo.com", "ymail.com"],
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    passwordHint: "Create an app password under Account security.",
    passwordUrl: "https://login.yahoo.com/account/security",
  },
  {
    id: "migadu",
    name: "Migadu",
    domains: [],
    imap: { host: "imap.migadu.com", port: 993, secure: true },
    smtp: { host: "smtp.migadu.com", port: 465, secure: true },
  },
  {
    id: "proton-bridge",
    name: "Proton Mail Bridge",
    domains: ["proton.me", "protonmail.com"],
    imap: { host: "127.0.0.1", port: 1143, secure: false },
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
    passwordHint: "Use the password shown in Proton Mail Bridge.",
  },
];

export function presetById(id: string): ImapPreset | null {
  return IMAP_PRESETS.find((p) => p.id === id) ?? null;
}

export function presetForAddress(address: string): ImapPreset | null {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return IMAP_PRESETS.find((p) => p.domains.includes(domain)) ?? null;
}

/** Best-guess settings for a custom domain: imap./smtp. on the address's domain. */
export function guessServers(address: string) {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return {
    imap: { host: domain ? `imap.${domain}` : "", port: 993, secure: true },
    smtp: { host: domain ? `smtp.${domain}` : "", port: 465, secure: true },
  };
}
