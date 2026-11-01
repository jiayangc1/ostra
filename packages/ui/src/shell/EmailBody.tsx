import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTheme } from "../theme.tsx";

/** Strict policy for message HTML: no scripts, no forms, no frames; images over https/data/cid only. */
const CSP = "default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src 'self' https: data:; media-src https:";

/** Quoted history from Gmail, Apple Mail, Yahoo, Proton and Outlook replies. */
const QUOTE = [
  ".gmail_quote",
  "blockquote[type=cite]",
  ".yahoo_quoted",
  ".protonmail_quote",
  "#appendonsend ~ *",
  "#divRplyFwdMsg",
  "#divRplyFwdMsg ~ *",
].join(",");

/**
 * Newsletters and receipts paint their own backgrounds and colors, so they keep
 * a white page. Everything else is a person typing, and takes on the app theme.
 */
function isDesigned(html: string): boolean {
  return /<style[\s>]|<table[\s>]|\bbgcolor=|background(-color)?\s*:|\sbackground=/i.test(html);
}

type Palette = { fg: string; muted: string; line: string; link: string; font: string; fontFaces: string };

/** Theme colors and the app's own @font-face rules, read from the live document. */
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const faces: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule && /Geist/.test(rule.style.getPropertyValue("font-family"))) {
        const base = sheet.href ?? location.href;
        faces.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_, q, u) => `url(${q}${new URL(u, base).href}${q})`));
      }
    }
  }
  return {
    fg: v("--o-fg"),
    muted: v("--o-fg-3"),
    line: v("--o-line-hover"),
    link: v("--o-blue"),
    font: getComputedStyle(document.body).fontFamily,
    fontFaces: faces.join("\n"),
  };
}

function frameDocument(html: string, scheme: "light" | "dark", designed: boolean, p: Palette): string {
  const themed = designed
    ? `html,body{background:#fff;color:#171717}body{padding:16px}`
    : `html,body{background:transparent;color:${p.fg}}
body *{color:inherit!important;background-color:transparent!important;border-color:${p.line}!important}
a,a *{color:${p.link}!important}
blockquote{margin:0 0 0 2px!important;padding-left:12px!important;border-left:2px solid ${p.line}!important;color:${p.muted}!important}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank"><style>
${p.fontFaces}
:root{color-scheme:${scheme}}
html,body{margin:0;padding:0;overflow:hidden;font:14px/1.7 ${p.font};overflow-wrap:anywhere}
body{display:flow-root}
img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}
body>*:first-child{margin-top:0}body>*:last-child{margin-bottom:0}
${themed}
html:not(.show-quote) :is(${QUOTE},.o-quote-gap){display:none!important}
</style></head><body>${html}</body></html>`;
}

/** True when the message has text of its own besides the quoted history (so forwards stay visible). */
function hasOwnText(doc: Document): boolean {
  const clone = doc.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(QUOTE).forEach((el) => el.remove());
  return (clone.textContent ?? "").trim().length > 0;
}

/** Line breaks left dangling above a folded quote, hidden along with it. */
function markQuoteGaps(doc: Document) {
  for (const quote of Array.from(doc.querySelectorAll(QUOTE))) {
    let prev = quote.previousSibling;
    while (prev && (prev.nodeName === "BR" || (prev.nodeType === Node.TEXT_NODE && !prev.textContent?.trim()))) {
      if (prev.nodeName === "BR") (prev as Element).classList.add("o-quote-gap"); // instanceof fails across the frame boundary
      prev = prev.previousSibling;
    }
  }
}

/**
 * HTML mail in a sandboxed iframe: scripts can't run (no allow-scripts), so
 * allow-same-origin only lets us measure height and fold quotes. Links open in a new tab.
 */
export function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const { resolved } = useTheme();
  const [height, setHeight] = useState(60);
  const [quote, setQuote] = useState<"none" | "hidden" | "shown">("none");
  const designed = isDesigned(html);
  // The frame's scheme must match the page's or the browser paints an opaque backdrop behind it.
  const scheme = designed ? "light" : resolved;

  // Rebuilt on theme change; ThemeProvider sets <html data-theme> in a layout effect, so tokens are current.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (doc?.body) setHeight(Math.ceil(doc.body.getBoundingClientRect().height));
    };
    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      const folds = !!doc.querySelector(QUOTE) && hasOwnText(doc);
      if (folds) markQuoteGaps(doc);
      else doc.documentElement.classList.add("show-quote");
      setQuote(folds ? "hidden" : "none");
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(doc.body);
    };
    frame.addEventListener("load", onLoad);
    frame.srcdoc = frameDocument(html, scheme, designed, readPalette());
    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [html, designed, scheme]);

  const toggleQuote = () => {
    const shown = ref.current?.contentDocument?.documentElement.classList.toggle("show-quote");
    setQuote(shown ? "shown" : "hidden");
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <iframe
        ref={ref}
        title="Message content"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        scrolling="no"
        style={{ height, colorScheme: scheme }}
        className={designed ? "block w-full rounded-control bg-white" : "block w-full bg-transparent"}
      />
      {quote !== "none" && <QuoteToggle shown={quote === "shown"} onClick={toggleQuote} />}
    </div>
  );
}

function QuoteToggle({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={shown}
      aria-label={shown ? "Hide quoted text" : "Show quoted text"}
      title={shown ? "Hide quoted text" : "Show quoted text"}
      className="o-press flex h-4 items-center rounded-[4px] bg-hover px-1.5 text-fg-3 hover:bg-active hover:text-fg"
    >
      <MoreHorizontal size={14} />
    </button>
  );
}

/** Plain text with quoted replies folded away, and links made clickable. */
export function TextBody({ text }: { text: string }) {
  const [showQuote, setShowQuote] = useState(false);
  const lines = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd().split("\n");
  const cut = quoteStart(lines);
  const visible = cut === -1 || showQuote ? lines : trimEnd(lines.slice(0, cut));
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="w-full whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-fg">
        {visible.map((line, i) => (
          <div key={i} className={line.startsWith(">") ? "border-l-2 border-line pl-3 text-fg-3" : undefined}>
            {linkify(line.replace(/^>\s?/, "")) || " "}
          </div>
        ))}
      </div>
      {cut !== -1 && <QuoteToggle shown={showQuote} onClick={() => setShowQuote((s) => !s)} />}
    </div>
  );
}

/** Index where trailing quoted history begins ("On … wrote:" then only "> " lines), or -1. */
function quoteStart(lines: string[]): number {
  let i = lines.length;
  while (i > 0 && (lines[i - 1]!.startsWith(">") || lines[i - 1]!.trim() === "")) i--;
  if (i === lines.length) return -1;
  if (i > 0 && /wrote:\s*$/.test(lines[i - 1]!)) i--;
  return lines.slice(0, i).some((l) => l.trim()) ? i : -1;
}

function trimEnd(lines: string[]): string[] {
  let n = lines.length;
  while (n > 0 && !lines[n - 1]!.trim()) n--;
  return lines.slice(0, n);
}

function linkify(line: string) {
  const parts = line.split(/(https?:\/\/[^\s<>()]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-blue underline decoration-blue/40 underline-offset-2 hover:decoration-blue">
        {p}
      </a>
    ) : (
      p
    ),
  );
}
