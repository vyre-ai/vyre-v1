// One tooltip, ours: quick, placed by the thing, gone the moment you press. Every `title` in the app comes through here, so a browser's slow grey box never shows. It reads title once, keeps it as data-tt so
// the screen reader's label stays where it is, and draws one small inverted label 450 ms after the pointer rests. Pure placement below, so it is tested without a window.
export const TIP_DELAY_MS = 450;

/** Above the element when there is room, else below; kept inside the window. */
export function tipPlace(box: { left: number; top: number; bottom: number; width: number }, tip: { width: number; height: number }, windowWidth: number): { left: number; top: number } {
  const left = Math.max(6, Math.min(box.left + box.width / 2 - tip.width / 2, windowWidth - tip.width - 6));
  const above = box.top - tip.height - 7;
  return { left, top: above < 4 ? box.bottom + 7 : above };
}

interface TipEl { title?: string; dataset: Record<string, string | undefined>; removeAttribute(k: string): void; closest?(q: string): TipEl | null; getBoundingClientRect(): { left: number; top: number; bottom: number; width: number; height: number }; firstElementChild?: TipEl | null }

let installed = false;

/** Installs the one tooltip once. Web only; a page without a document does nothing. */
export function installTips(): void {
  const g = globalThis as unknown as { document?: Document; addEventListener?: (t: string, f: (e: never) => void, o?: unknown) => void; innerWidth?: number };
  const doc = g.document;
  if (installed || !doc || !g.addEventListener) return;
  installed = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cur: TipEl | null = null;
  let el: HTMLElement | null = null;
  const hide = (): void => { if (timer) clearTimeout(timer); timer = null; cur = null; if (el) el.style.display = "none"; };
  g.addEventListener("mouseover", ((ev: { target?: TipEl }) => {
    const n = ev.target?.closest?.("[title],[data-tt]") ?? null;
    if (!n) { hide(); return; }
    if (n.title) { n.dataset["tt"] = n.title; n.removeAttribute("title"); }
    if (n === cur) return;
    hide();
    cur = n;
    timer = setTimeout(() => {
      const text = n.dataset["tt"];
      if (!text) return;
      if (!el) {
        el = doc.createElement("div");
        el.setAttribute("data-testid", "tip");
        el.setAttribute("style", "position:fixed;z-index:80;display:none;background:var(--ink);color:var(--win);font-size:12px;line-height:16px;padding:4px 8px;border-radius:7px;pointer-events:none;white-space:nowrap");
        doc.body.appendChild(el);
      }
      el.textContent = text;
      el.style.display = "block";
      // a Tooltip wrapper has no box of its own: the thing it wraps is what the label sits by
      const box = n.getBoundingClientRect().width === 0 ? (n.firstElementChild ?? n).getBoundingClientRect() : n.getBoundingClientRect();
      const at = tipPlace(box, { width: el.offsetWidth, height: el.offsetHeight }, g.innerWidth ?? 1024);
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
    }, TIP_DELAY_MS);
  }) as never, true);
  g.addEventListener("mousedown", hide as never, true);
  g.addEventListener("scroll", hide as never, true);
}
