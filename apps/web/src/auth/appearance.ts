/**
 * Clerk appearance built from the Geist tokens, so sign-in, sign-up and
 * profile screens are indistinguishable from the rest of Ostra.
 */
const TOKENS = {
  dark: { bg: "#0a0a0a", canvas: "#000000", fg: "#ededed", fg2: "#a1a1a1", fg3: "#878787", line: "#1f1f1f", lineHover: "#2e2e2e", primary: "#ededed", primaryFg: "#0a0a0a", danger: "#ff6166", focus: "#52a8ff", hover: "#111111" },
  light: { bg: "#ffffff", canvas: "#ffffff", fg: "#171717", fg2: "#666666", fg3: "#8f8f8f", line: "#eaeaea", lineHover: "#d4d4d4", primary: "#171717", primaryFg: "#ffffff", danger: "#da2f35", focus: "#0070f3", hover: "#f5f5f5" },
} as const;

export function clerkAppearance(theme: "dark" | "light") {
  const t = TOKENS[theme];
  return {
    variables: {
      colorPrimary: t.primary,
      colorPrimaryForeground: t.primaryFg,
      colorDanger: t.danger,
      colorBackground: t.bg,
      colorForeground: t.fg,
      colorMutedForeground: t.fg2,
      colorMuted: t.hover,
      colorInput: t.canvas,
      colorInputForeground: t.fg,
      colorBorder: t.line,
      colorRing: t.focus,
      colorShadow: "transparent",
      colorNeutral: t.fg,
      colorModalBackdrop: theme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.2)",
      fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
      fontFamilyButtons: "Geist, ui-sans-serif, system-ui, sans-serif",
      fontFamilyMono: "'Geist Mono', ui-monospace, monospace",
      fontSize: "14px",
      borderRadius: "6px",
    },
    // Core 3 renamed `layout` to `options`. AuthLayout draws the Ostra mark above the card.
    options: {
      socialButtonsVariant: "blockButton" as const,
      unsafe_disableDevelopmentModeWarnings: true,
    },
    elements: {
      card: { boxShadow: "none", border: `1px solid ${t.line}`, borderRadius: "12px" },
      cardBox: { boxShadow: "none", borderRadius: "12px" },
      headerTitle: { letterSpacing: "-0.02em", fontWeight: 600 },
      // Clerk outlines controls with a box-shadow ring from more specific selectors; ours must win.
      formButtonPrimary: { boxShadow: "none !important", fontWeight: 500 },
      socialButtonsBlockButton: {
        boxShadow: `inset 0 0 0 1px ${t.line} !important`,
        "&:hover": { boxShadow: `inset 0 0 0 1px ${t.lineHover} !important`, background: t.hover },
      },
      formFieldInput: {
        boxShadow: `inset 0 0 0 1px ${t.line} !important`,
        "&:hover": { boxShadow: `inset 0 0 0 1px ${t.lineHover} !important` },
        "&:focus": { boxShadow: `inset 0 0 0 1px ${t.focus}, 0 0 0 3px ${t.focus}33 !important` },
      },
      footer: { background: "transparent" },
      footerActionLink: { color: t.fg, fontWeight: 500 },
    },
  };
}
