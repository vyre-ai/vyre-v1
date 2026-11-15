// One Escape closes one layer. Every popover, picker, menu, sheet, dialog and lightbox that closes on Escape registers here, and the key goes to the topmost layer only: the newest one opened.
// Before this, each layer listened on its own and called stopPropagation, which does not stop another listener on the same node, so one Escape closed a date picker and the dialog under it together.
//
// Two ways to hear the key. A layer hears it first, before anything inside the page does (the capture phase), so it closes even while a text field has focus: react-native-web's TextInput stops every keydown from
// bubbling, so a sheet listening on the way up never heard Escape typed in its own search box. The key is then stopped, so the sheet or dialog under it, and whatever React handlers sit above the field, never also see it.
// A layer that asks (`respectHandled`) hears it on the way up instead, and only when no field handled it: the popover over a text field stays while that field closes its own suggestions.
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

type KeyLike = { key?: string; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void };
type Fn = (e: KeyLike) => void;
type Doc = {
  addEventListener?: (t: string, f: Fn, capture?: boolean) => void;
  removeEventListener?: (t: string, f: Fn, capture?: boolean) => void;
};

const stack: Array<{ run: () => void; respectHandled: boolean; quiet: boolean }> = [];
const watchers = new Set<() => void>();
/** Hear every time a layer is added or removed (a card that must close when something opens above it). Answers how to stop. */
export function watchEscapeLayers(f: () => void): () => void {
  watchers.add(f);
  return () => void watchers.delete(f);
}
const changed = (): void => {
  for (const f of [...watchers]) f();
};

// Focus goes back to the control that opened a layer (NAV-2026-11-14 rule 4). The opener is the control last pressed (a press focuses it, or the key that pressed it), noted before the layer
// draws; when the layer goes and nothing else has taken focus, the opener gets it back.
type El = {
  isConnected?: boolean;
  closest?: (s: string) => El | null;
  focus?: (o?: { preventScroll?: boolean }) => void;
};
type FocusDoc = {
  activeElement?: El | null;
  body?: unknown;
  addEventListener?: (t: string, f: (e: { target?: unknown; key?: string }) => void, c?: boolean) => void;
};
const FOCUSABLE = 'button,a[href],input,textarea,select,[role="button"],[role="menuitem"],[role="tab"],[tabindex]';
let trigger: El | null = null;
const fdoc = (): FocusDoc | undefined => (globalThis as { document?: FocusDoc }).document;
function note(e: { target?: unknown; key?: string }): void {
  if (e.key !== undefined && e.key !== "Enter" && e.key !== " ") return;
  const t = e.target as El | null | undefined;
  trigger = typeof t?.closest === "function" ? t.closest(FOCUSABLE) : null;
}
if (Platform.OS === "web" && fdoc()?.addEventListener) {
  fdoc()!.addEventListener!("pointerdown", note, true);
  fdoc()!.addEventListener!("keydown", note, true);
}
function opener(): El | null {
  const d = fdoc();
  const active = d?.activeElement ?? null;
  const pick = trigger?.isConnected === true ? trigger : active !== null && active !== d?.body ? active : null;
  return pick;
}
function giveBack(el: El | null): void {
  if (el === null) return;
  setTimeout(() => {
    const d = fdoc();
    const now = d?.activeElement ?? null;
    // something else holds focus on purpose (a field in the page, another layer): leave it
    if (el.isConnected !== true || (now !== null && now !== d?.body && now.isConnected === true)) return;
    el.focus?.({ preventScroll: true });
  }, 0);
}
let installed: { doc: Doc } | null = null;

const doc = (): Doc | undefined => (globalThis as { document?: Doc }).document;

function onCapture(e: KeyLike): void {
  if (e.key !== "Escape" || stack.length === 0) return;
  const top = stack[stack.length - 1]!;
  if (top.respectHandled) return;
  e.preventDefault?.();
  e.stopPropagation?.();
  top.run();
}

function onBubble(e: KeyLike): void {
  if (e.key !== "Escape" || stack.length === 0) return;
  const top = stack[stack.length - 1]!;
  if (top.respectHandled && e.defaultPrevented !== true) top.run();
}

function install(d: Doc): void {
  if (installed !== null) {
    installed.doc.removeEventListener?.("keydown", onCapture, true);
    installed.doc.removeEventListener?.("keydown", onBubble);
  }
  d.addEventListener?.("keydown", onCapture, true);
  d.addEventListener?.("keydown", onBubble);
  installed = { doc: d };
}

/** Adds a layer (it is the top until another is added). Returns the function that removes it. */
export function pushEscapeLayer(run: () => void, o: { respectHandled?: boolean; quiet?: boolean } = {}): () => void {
  const layer = { run, respectHandled: o.respectHandled === true, quiet: o.quiet === true };
  stack.push(layer);
  changed();
  const from = opener();
  const d = doc();
  // one pair of listeners on the current document (a different document object, as a test swaps in, gets them again)
  if (d?.addEventListener && installed?.doc !== d) install(d);
  return () => {
    const at = stack.indexOf(layer);
    if (at >= 0) stack.splice(at, 1);
    changed();
    giveBack(from);
    if (stack.length === 0 && installed !== null) {
      installed.doc.removeEventListener?.("keydown", onCapture, true);
      installed.doc.removeEventListener?.("keydown", onBubble);
      installed = null;
    }
  };
}

/** For a component: while `active`, Escape runs `run` when this is the topmost layer. The latest `run` is used, and the layer keeps its place across renders. */
export function useEscapeLayer(
  active: boolean,
  run: () => void,
  o: { respectHandled?: boolean; quiet?: boolean } = {},
): void {
  const respect = o.respectHandled === true;
  const quiet = o.quiet === true;
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!active || Platform.OS !== "web") return undefined;
    return pushEscapeLayer(() => latest.current(), { respectHandled: respect, quiet });
  }, [active, respect, quiet]);
}

/** Layers that count as something opening over a card: all but the quiet ones (a one-line notice). */
export const loudLayers = (): number => stack.filter((l) => !l.quiet).length;

/** Tests: how many layers are open. */
export const escapeLayers = (): number => stack.length;
