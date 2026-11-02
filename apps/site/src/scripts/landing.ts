/**
 * Motion for the landing page: the hero's converging mail, the four feature
 * demos, scroll reveals, the navigation backdrop and the waitlist forms.
 * Every demo only runs while it is on screen, and none run with reduced motion.
 */
import { ACCOUNTS, ACCOUNT_KEYS, ARRIVALS, initials, type AccountKey, type Mail, type Noise } from "../data/demo.ts";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const q = <T extends Element = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

/** Restart a CSS animation that is keyed to a class. */
function retrigger(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** Collapse a list row out, then drop it. */
function leave(el: HTMLElement) {
  el.classList.add("is-leaving");
  setTimeout(() => el.remove(), 520);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeIn = (t: number) => t * t;

/* ---------- Scenes: loops that stop cleanly when they leave the screen ---------- */

const STOP = Symbol("stop");

interface Ctx {
  wait(ms: number): Promise<void>;
  frames(ms: number, step: (t: number) => void): Promise<void>;
}

function context(alive: () => boolean): Ctx {
  return {
    wait: (ms) => new Promise((resolve, reject) => setTimeout(() => (alive() ? resolve() : reject(STOP)), ms)),
    frames: (ms, step) =>
      new Promise((resolve, reject) => {
        const start = performance.now();
        const tick = (now: number) => {
          if (!alive()) return reject(STOP);
          const t = Math.min(1, (now - start) / ms);
          step(t);
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
  };
}

/** Run `scene` on repeat while `el` is visible and the tab is in front. Each pass must reset its own state. */
function play(el: Element, scene: (c: Ctx) => Promise<void>, onStop?: () => void) {
  let visible = false;
  let running = false;
  let generation = 0;
  const update = () => {
    const should = visible && !document.hidden;
    if (should && !running) {
      running = true;
      const mine = ++generation;
      const c = context(() => running && generation === mine);
      void (async () => {
        try {
          for (;;) await scene(c);
        } catch (err) {
          if (err !== STOP) throw err;
        }
      })();
    } else if (!should && running) {
      running = false;
      onStop?.();
    }
  };
  new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      update();
    },
    { threshold: 0.25 },
  ).observe(el);
  document.addEventListener("visibilitychange", update);
}

/* ---------- Hero: three addresses, one inbox ---------- */

function hero() {
  const stage = document.querySelector<HTMLElement>("[data-stage]");
  if (!stage) return;
  const list = q(stage, "[data-list]");
  const count = q(stage, "[data-count]");
  const panel = q(stage, "[data-panel]");
  const svg = q<SVGSVGElement>(stage, "[data-lines]");
  const merge = q<SVGPathElement>(svg, "[data-merge]");
  const node = q(stage, "[data-node]");
  const template = q<HTMLTemplateElement>(stage, "[data-tpl=row]");
  const chips = {} as Record<AccountKey, HTMLElement>;
  const paths = {} as Record<AccountKey, SVGPathElement>;
  const gradients = {} as Record<AccountKey, SVGLinearGradientElement>;
  for (const k of ACCOUNT_KEYS) {
    chips[k] = q(stage, `[data-account="${k}"]`);
    paths[k] = q<SVGPathElement>(svg, `[data-path="${k}"]`);
    gradients[k] = q<SVGLinearGradientElement>(svg, `[data-gradient="${k}"]`);
  }
  const wide = matchMedia("(min-width: 1024px)");

  // The logo's geometry at full size: three strokes meet at a dot, then one line runs into the inbox.
  // Offsets rather than bounding boxes, so the entrance transforms don't skew the anchors.
  const layout = () => {
    if (!wide.matches) return;
    svg.setAttribute("viewBox", `0 0 ${stage.offsetWidth} ${stage.offsetHeight}`);
    const x0 = Math.max(...ACCOUNT_KEYS.map((k) => chips[k].offsetLeft + chips[k].offsetWidth)) + 14;
    const xp = panel.offsetLeft;
    const yn = chips.n.offsetTop + chips.n.offsetHeight / 2;
    const xn = x0 + (xp - x0) * 0.56;
    const cx = x0 + (xn - x0) * 0.58;
    for (const k of ACCOUNT_KEYS) {
      const y = chips[k].offsetTop + chips[k].offsetHeight / 2;
      paths[k].setAttribute("d", `M${x0} ${y} C${cx} ${y} ${cx} ${yn} ${xn} ${yn}`);
      gradients[k].setAttribute("x1", String(x0));
      gradients[k].setAttribute("x2", String(xn));
    }
    merge.setAttribute("d", `M${xn} ${yn} H${xp}`);
    node.style.left = `${xn}px`;
    node.style.top = `${yn}px`;
  };
  layout();
  new ResizeObserver(layout).observe(stage);
  wide.addEventListener("change", layout);
  void document.fonts?.ready.then(layout);

  if (reduced) return;

  const firstFrame = list.innerHTML;
  const firstCount = count.textContent;
  let dirty = false;
  let first = true;

  const slot = (row: Element, name: string) => q(row, `[data-slot="${name}"]`);
  const live = () => [...list.children].filter((el) => !el.classList.contains("is-leaving")) as HTMLElement[];

  const makeRow = (m: Mail) => {
    const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const lab = m.label ? ` --lab: var(--o-${m.label.color}); --lab-bg: var(--o-${m.label.color}-bg);` : "";
    row.style.cssText = `--tint: var(--o-${m.tint}); --tint-bg: var(--o-${m.tint}-bg); --acct: var(--o-${ACCOUNTS[m.account].color});${lab}`;
    row.toggleAttribute("data-unread", m.unread);
    slot(row, "initials").textContent = initials(m.sender);
    slot(row, "sender").textContent = m.sender;
    slot(row, "time").textContent = m.time;
    slot(row, "subject").textContent = m.subject;
    slot(row, "label").textContent = m.label?.name ?? "";
    return row;
  };

  const land = (a: Mail | Noise) => {
    if (a.kind === "mail") {
      const row = makeRow(a);
      row.classList.add("is-entering");
      list.prepend(row);
      count.textContent = String(Number(count.textContent) + 1);
    } else {
      // Noise never gets a row of its own: its bundle takes the new count and its place in time.
      const old = list.querySelector<HTMLElement>(`[data-bundle="${a.category}"]:not(.is-leaving)`);
      if (!old) return;
      const next = old.cloneNode(true) as HTMLElement;
      next.classList.remove("is-entering", "is-flash");
      const total = slot(next, "count");
      const fresh = slot(next, "fresh");
      total.textContent = String(Number(total.textContent) + 1);
      fresh.textContent = `${Number.parseInt(fresh.textContent ?? "0", 10) + 1} new`;
      next.setAttribute("data-unread", "");
      if (live()[0] === old) {
        old.replaceWith(next);
        retrigger(next, "is-flash");
      } else {
        leave(old);
        next.classList.add("is-entering");
        list.prepend(next);
      }
    }
    for (const extra of live().slice(9)) extra.remove();
  };

  const deliver = async (a: Mail | Noise, c: Ctx) => {
    retrigger(q(chips[a.account], ".chip-dot"), "is-ping");
    if (wide.matches) {
      const dot = document.createElement("span");
      dot.className = "mail-dot";
      dot.style.setProperty("--c", `var(--o-${ACCOUNTS[a.account].color})`);
      stage.append(dot);
      const along = (path: SVGPathElement) => {
        const length = path.getTotalLength();
        return (t: number) => {
          const p = path.getPointAtLength(length * t);
          dot.style.transform = `translate(${p.x}px, ${p.y}px)`;
        };
      };
      try {
        const toNode = along(paths[a.account]);
        await c.frames(1150, (t) => toNode(easeInOut(t)));
        retrigger(node, "is-ping");
        const toInbox = along(merge);
        await c.frames(460, (t) => {
          toInbox(easeIn(t));
          dot.style.opacity = String(Math.min(1, (1 - t) / 0.35));
        });
      } finally {
        dot.remove();
      }
    } else {
      await c.wait(450);
    }
    land(a);
  };

  play(
    stage,
    async (c) => {
      if (dirty) {
        list.style.opacity = "0";
        await c.wait(420);
        list.innerHTML = firstFrame;
        count.textContent = firstCount;
        list.style.opacity = "";
        dirty = false;
        await c.wait(700);
      }
      // The first pass waits for the lines to finish drawing.
      await c.wait(first ? 2300 : 600);
      first = false;
      for (const a of ARRIVALS) {
        dirty = true;
        await deliver(a, c);
        await c.wait(a.kind === "mail" ? 1500 : 1000);
      }
      await c.wait(2600);
    },
    () => {
      for (const dot of stage.querySelectorAll(".mail-dot")) dot.remove();
      list.style.opacity = "";
    },
  );
}

/* ---------- Feature demos ---------- */

interface Demo {
  run: (c: Ctx) => Promise<void>;
  /** The single frame shown when motion is reduced, if it differs from the server-rendered one. */
  still?: () => void;
}

async function press(el: Element, c: Ctx, action?: () => void) {
  el.setAttribute("data-down", "");
  action?.();
  await c.wait(170);
  el.removeAttribute("data-down");
}

function fromDemo(root: HTMLElement): Demo {
  const to = q(root, "[data-to]");
  const from = q(root, "[data-from]");
  const subject = q(root, "[data-subject]");
  const why = q(root, "[data-why]");
  const scenes: { to: string; account: AccountKey; subject: string; why: string }[] = [
    { to: "priya@foundry.vc", account: "t", subject: "Updated model", why: "last used with Priya" },
    { to: "mom@hey.com", account: "g", subject: "Sunday", why: "last used with Mom" },
    { to: "marcus@northwind.io", account: "n", subject: "Q4 roadmap", why: "last used with Marcus" },
  ];
  const swap = (el: HTMLElement, text: string) => {
    el.textContent = text;
    retrigger(el, "swap-in");
  };
  const swapChip = (account: AccountKey) => {
    const chips = from.querySelectorAll<HTMLElement>("[data-chip]:not(.swap-out)");
    const current = chips[chips.length - 1]!;
    const next = current.cloneNode(true) as HTMLElement;
    next.classList.remove("swap-in");
    q(next, "[data-chip-dot]").style.background = `var(--o-${ACCOUNTS[account].color})`;
    q(next, "[data-chip-text]").textContent = ACCOUNTS[account].address;
    current.classList.add("swap-out");
    setTimeout(() => current.remove(), 320);
    next.classList.add("swap-in");
    from.append(next);
  };
  return {
    run: async (c) => {
      for (const s of scenes) {
        to.textContent = "";
        subject.textContent = "";
        why.textContent = "";
        await c.wait(600);
        for (const ch of s.to) {
          to.textContent += ch;
          await c.wait(30 + Math.random() * 45);
        }
        await c.wait(320);
        swapChip(s.account);
        swap(why, s.why);
        swap(subject, s.subject);
        await c.wait(2800);
      }
    },
  };
}

function draftDemo(root: HTMLElement): Demo {
  const draft = q(root, "[data-draft]");
  const thinking = q(root, "[data-thinking]");
  const original = draft.textContent ?? "";
  const tones: { tone: string | null; text: string }[] = [
    { tone: "shorter", text: "Hi Priya, the updated model will be with you by Wednesday." },
    { tone: "warmer", text: "Hi Priya, so glad the demo landed with the partners! I'll have the updated model and hiring plan to you by Wednesday." },
    { tone: "formal", text: "Dear Priya, thank you for your note. I will send the updated financial model, together with the revised hiring plan, by Wednesday evening." },
    { tone: null, text: original },
  ];
  const chips = [...root.querySelectorAll<HTMLElement>("[data-tone]")];
  const showThinking = (on: boolean) => {
    thinking.classList.toggle("hidden", !on);
    thinking.classList.toggle("inline-flex", on);
  };
  const stream = async (text: string, c: Ctx) => {
    draft.replaceChildren();
    for (const word of text.split(" ")) {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = `${word} `;
      draft.append(span);
      await c.wait(32);
    }
  };
  return {
    run: async (c) => {
      draft.classList.remove("is-fading");
      showThinking(false);
      for (const step of tones) {
        await c.wait(step.tone === "shorter" ? 1500 : 2800);
        const chip = chips.find((el) => el.dataset.tone === step.tone);
        for (const el of chips) el.toggleAttribute("data-active", el === chip);
        if (chip) await press(chip, c);
        draft.classList.add("is-fading");
        showThinking(true);
        await c.wait(750);
        draft.classList.remove("is-fading");
        showThinking(false);
        await stream(step.text, c);
      }
    },
  };
}

function checkDemo(root: HTMLElement): Demo {
  const send = q(root, "[data-send]");
  const warn = q(root, "[data-warn]");
  const attach = q(root, "[data-attach]");
  const attachButton = q(root, "[data-attach-btn]");
  return {
    run: async (c) => {
      warn.dataset.open = "false";
      attach.dataset.open = "false";
      send.removeAttribute("data-sent");
      await c.wait(1300);
      await press(send, c);
      warn.dataset.open = "true";
      await c.wait(2000);
      await press(attachButton, c);
      warn.dataset.open = "false";
      await c.wait(200);
      attach.dataset.open = "true";
      await c.wait(1100);
      await press(send, c);
      send.setAttribute("data-sent", "");
      await c.wait(2400);
    },
    still: () => {
      warn.dataset.open = "true";
    },
  };
}

function keysDemo(root: HTMLElement): Demo {
  const list = q(root, "[data-klist]");
  const palette = q(root, "[data-palette]");
  const typed = q(root, "[data-ptext]");
  const firstFrame = list.innerHTML;
  const caps = Object.fromEntries([...root.querySelectorAll<HTMLElement>("[data-key]")].map((el) => [el.dataset.key!, el]));
  const rows = () => [...list.querySelectorAll<HTMLElement>(".inbox-row:not(.is-leaving)")];
  let selected = 0;
  let dirty = false;
  const place = () => {
    const row = rows()[selected];
    if (row) q(list, "[data-khl]").style.transform = `translateY(${row.offsetTop}px)`;
  };
  const key = (name: string, c: Ctx, action: () => void) => press(caps[name]!, c, action);
  list.style.transition = "opacity 300ms ease";
  return {
    run: async (c) => {
      palette.removeAttribute("data-open");
      if (dirty) {
        list.style.opacity = "0";
        await c.wait(320);
        list.innerHTML = firstFrame;
        list.style.opacity = "1";
      }
      dirty = true;
      selected = 0;
      place();
      await c.wait(1100);
      await key("j", c, () => {
        selected = 1;
        place();
      });
      await c.wait(650);
      await key("j", c, () => {
        selected = 2;
        place();
      });
      await c.wait(1000);
      await key("e", c, () => leave(rows()[2]!));
      await c.wait(400);
      place();
      await c.wait(900);
      await key("k", c, () => {
        selected = 1;
        place();
      });
      await c.wait(1000);
      typed.textContent = "";
      await key("cmdk", c, () => palette.setAttribute("data-open", ""));
      await c.wait(300);
      for (const ch of "label inv") {
        typed.textContent += ch;
        await c.wait(65);
      }
      await c.wait(750);
      palette.removeAttribute("data-open");
      const label = q(rows()[1]!, "[data-klabel]");
      label.textContent = "Investors";
      retrigger(label, "swap-in");
      await c.wait(2600);
    },
  };
}

const DEMOS: Record<string, (root: HTMLElement) => Demo> = { from: fromDemo, draft: draftDemo, check: checkDemo, keys: keysDemo };

function demos() {
  for (const root of document.querySelectorAll<HTMLElement>("[data-vignette]")) {
    const demo = DEMOS[root.dataset.vignette ?? ""]?.(root);
    if (!demo) continue;
    if (reduced) demo.still?.();
    else play(root, demo.run);
  }
}

/* ---------- Page chrome ---------- */

function reveal() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of document.querySelectorAll("[data-reveal]")) io.observe(el);
}

function nav() {
  const header = document.querySelector("[data-nav]");
  if (!header) return;
  const update = () => header.toggleAttribute("data-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", update, { passive: true });
  update();
}

const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="o-check-draw" d="M20 6 9 17l-5-5" pathLength="24"></path></svg>';

function waitlist() {
  for (const form of document.querySelectorAll<HTMLFormElement>("form[data-waitlist]")) {
    const input = form.elements.namedItem("email") as HTMLInputElement;
    const button = q<HTMLButtonElement>(form, "button");
    const status = q(form, "[role=status]");
    const say = (state: "busy" | "ok" | "error", text: string) => {
      status.dataset.state = state;
      status.innerHTML = state === "ok" ? CHECK : "";
      status.append(text);
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!input.checkValidity()) {
        say("error", "Enter a valid email address.");
        input.focus();
        return;
      }
      button.disabled = true;
      say("busy", "Joining…");
      try {
        const res = await fetch(`${form.dataset.api}/public/waitlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: input.value, source: "site" }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Something went wrong. Try again.");
        }
        form.reset();
        say("ok", "You're on the list. We'll write when it's your turn.");
      } catch (err) {
        say("error", err instanceof TypeError ? "Couldn't reach Ostra. Check your connection and try again." : err instanceof Error ? err.message : "Something went wrong. Try again.");
      } finally {
        button.disabled = false;
      }
    });
  }
}

nav();
reveal();
waitlist();
hero();
demos();
