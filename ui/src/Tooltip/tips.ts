// One tooltip, ours: quick, placed by the thing, gone the moment you press. Every `title` in the app comes through here, so a browser's slow grey box never shows. It reads title once, keeps it as data-tt so
// the screen reader's label stays where it is, and draws one small inverted label 350 ms after the pointer rests or the keyboard focuses the thing; Escape, blur, scroll and a press put it away. Pure placement below, so it is tested without a window.
export const TIP_DELAY_MS = 350;

/** Above the element when there is room, else below; kept inside the window. */
export function tipPlace(
  box: { left: number; top: number; bottom: number; width: number },
  tip: { width: number; height: number },
  windowWidth: number,
): { left: number; top: number } {
  const left = Math.max(6, Math.min(box.left + box.width / 2 - tip.width / 2, windowWidth - tip.width - 6));
  const above = box.top - tip.height - 7;
  return { left, top: above < 4 ? box.bottom + 7 : above };
}

export interface TipEl {
  title?: string;
  isConnected?: boolean;
  getAttribute?(k: string): string | null;
  dataset: Record<string, string | undefined>;
  scrollWidth?: number;
  clientWidth?: number;
  removeAttribute(k: string): void;
  setAttribute?(k: string, v: string): void;
  matches?(q: string): boolean;
  closest?(q: string): TipEl | null;
  getBoundingClientRect(): { left: number; top: number; bottom: number; width: number; height: number };
  firstElementChild?: TipEl | null;
}
interface TipLabel {
  style: Record<string, string>;
  textContent: string | null;
  offsetWidth: number;
  offsetHeight: number;
  setAttribute(k: string, v: string): void;
}
export interface TipEnv {
  /** Where the tip is drawn: the app's one overlay layer, so it sits above every dialog, sheet and menu. Absent: the body. */
  layer?: () => { appendChild(n: never): void } | null;
  document: { createElement(t: string): TipLabel; body: { appendChild(n: never): void } };
  innerWidth?: number | undefined;
  addEventListener(t: string, f: (e: never) => void, o?: unknown): void;
}

/** What the thing is that the label sits by: a Tooltip wrapper has no box of its own, so its first child is. */
const boxOf = (n: TipEl): TipEl => (n.getBoundingClientRect().width === 0 ? (n.firstElementChild ?? n) : n);
/** Text cut by an ellipsis: more content than room. */
const isCut = (n: TipEl): boolean => {
  const t = boxOf(n);
  return (t.scrollWidth ?? 0) > (t.clientWidth ?? 0);
};

/** The one tooltip. `show` and `hide` are for a list whose cursor is a row (aria-activedescendant): it asks for the tip itself. */
export function createTips(g: TipEnv): { show(el: TipEl, text: string): void; hide(): void; hideFor(el: TipEl): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cur: TipEl | null = null;
  let label: TipLabel | null = null;
  let described: TipEl | null = null;
  let watcher: ReturnType<typeof setInterval> | null = null;
  const hide = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (watcher) clearInterval(watcher);
    watcher = null;
    cur = null;
    if (label) label.style["display"] = "none";
    if (described) described.removeAttribute("aria-describedby");
    described = null;
  };
  const put = (n: TipEl, text: string): void => {
    if (!label) {
      label = g.document.createElement("div");
      label.setAttribute("role", "tooltip");
      label.setAttribute("id", "vyre-tip");
      label.setAttribute("data-testid", "tip");
      label.setAttribute(
        "style",
        "position:fixed;z-index:2147483647;display:none;background:var(--ink);color:var(--win);font-size:12px;line-height:16px;padding:4px 8px;border-radius:7px;pointer-events:none;white-space:pre;max-width:320px",
      );
      (g.layer?.() ?? g.document.body).appendChild(label as never);
    }
    label.textContent = text;
    label.style["display"] = "block";
    label.style["whiteSpace"] = "pre";
    const at = tipPlace(
      boxOf(n).getBoundingClientRect(),
      { width: label.offsetWidth, height: label.offsetHeight },
      g.innerWidth ?? 1024,
    );
    label.style["left"] = `${at.left}px`;
    label.style["top"] = `${at.top}px`;
    // a screen reader reads the label as the element's description, and an element that only had a title keeps its name
    n.setAttribute?.("aria-describedby", "vyre-tip");
    described = n;
    // the element leaves the page (a row deleted, a route change) while its tip is up: the tip goes with it
    if (watcher) clearInterval(watcher);
    watcher = setInterval(() => {
      if (n.isConnected === false) hide();
    }, 120);
    (watcher as { unref?: () => void }).unref?.();
  };
  const arm = (n: TipEl): void => {
    if (n.title) {
      n.dataset["tt"] = n.title;
      // the title was the accessible name of an icon-only button: it moves to aria-label, never leaves the element without one
      if (!n.getAttribute?.("aria-label")) n.setAttribute?.("aria-label", n.title);
      n.removeAttribute("title");
    }
    if (n === cur) return;
    hide();
    cur = n;
    timer = setTimeout(() => {
      const text = n.dataset["tt"];
      if (!text) return;
      if (n.dataset["ttCut"] !== undefined && !isCut(n)) return;
      put(n, text);
    }, TIP_DELAY_MS);
  };
  g.addEventListener(
    "mouseover",
    ((ev: { target?: TipEl }) => {
      const n = ev.target?.closest?.("[title],[data-tt]") ?? null;
      if (n) arm(n);
      else hide();
    }) as never,
    true,
  );
  // keyboard focus only: a click that focuses a thing is a press, and a press puts the tip away
  g.addEventListener(
    "focusin",
    ((ev: { target?: TipEl }) => {
      const n = ev.target?.closest?.("[title],[data-tt]") ?? null;
      if (n && n.matches?.(":focus-visible") !== false) arm(n);
    }) as never,
    true,
  );
  g.addEventListener("focusout", hide as never, true);
  g.addEventListener("keydown", ((ev: { key?: string }) => ev.key === "Escape" && hide()) as never, true);
  g.addEventListener("mousedown", hide as never, true);
  g.addEventListener("scroll", hide as never, true);
  return {
    show(n, text) {
      hide();
      cur = n;
      put(n, text);
    },
    hide,
    hideFor(n) {
      if (cur === n || described === n) hide();
    },
  };
}

let tips: ReturnType<typeof createTips> | null = null;
let overlayRoot: (() => unknown) | null = null;

/** Installs the one tooltip once. Web only; a page without a document does nothing. */
export function installTips(): void {
  const g = globalThis as unknown as Partial<TipEnv>;
  if (tips || !g.document || !g.addEventListener) return;
  const win = g as { addEventListener: TipEnv["addEventListener"]; innerWidth?: number };
  tips = createTips({
    document: g.document,
    get innerWidth() {
      return win.innerWidth;
    },
    addEventListener: (t, f, o) => win.addEventListener(t, f, o),
    layer: () => (overlayRoot ? (overlayRoot() as unknown as { appendChild(n: never): void } | null) : null),
  });
  // the overlay layer is loaded when the first tip is installed (kept out of the static imports so this file stays plain TypeScript)
  void import("../Overlay/index.tsx").then((m) => {
    overlayRoot = m.ensureOverlayRoot;
  });
}

/** Show the tip for a thing now (a list cursor on a row); `hideTip` puts it away. Nothing before the tooltip is installed. */
export const showTip = (el: TipEl, text: string): void => tips?.show(el, text);
export const hideTip = (): void => tips?.hide();
/** Put away the tip if it is for this element (a Tooltip that unmounts). */
export const hideTipFor = (el: TipEl): void => tips?.hideFor(el);
