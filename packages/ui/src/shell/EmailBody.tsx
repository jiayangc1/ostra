import { useEffect, useRef, useState } from "react";

/** Strict policy for message HTML: no scripts, no forms, no frames; images over https/data/cid only. */
const CSP = "default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:; media-src https:";

function document(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank"><style>
html,body{margin:0;padding:0;background:#fff;color:#171717;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
body{padding:16px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}
</style></head><body>${html}</body></html>`;
}

/**
 * HTML mail in a sandboxed iframe: scripts can't run (no allow-scripts), so
 * allow-same-origin only lets us measure height. Links open in a new tab.
 */
export function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (doc?.body) setHeight(Math.max(60, doc.documentElement.scrollHeight));
    };
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body) {
        ro = new ResizeObserver(measure);
        ro.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Message content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={document(html)}
      style={{ height }}
      className="block w-full rounded-control border border-line bg-white"
    />
  );
}

/** Plain text with quoted replies dimmed and links made clickable. */
export function TextBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd().split("\n");
  return (
    <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-fg">
      {lines.map((line, i) => (
        <div key={i} className={line.startsWith(">") ? "border-l-2 border-line pl-3 text-fg-3" : undefined}>
          {linkify(line.replace(/^>\s?/, "")) || " "}
        </div>
      ))}
    </div>
  );
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
