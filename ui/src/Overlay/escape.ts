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
type Doc = { addEventListener?: (t: string, f: Fn, capture?: boolean) => void; removeEventListener?: (t: string, f: Fn, capture?: boolean) => void };

const stack: Array<{ run: () => void; respectHandled: boolean }> = [];
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
  if (installed !== null) { installed.doc.removeEventListener?.("keydown", onCapture, true); installed.doc.removeEventListener?.("keydown", onBubble); }
  d.addEventListener?.("keydown", onCapture, true);
  d.addEventListener?.("keydown", onBubble);
  installed = { doc: d };
}

/** Adds a layer (it is the top until another is added). Returns the function that removes it. */
export function pushEscapeLayer(run: () => void, o: { respectHandled?: boolean } = {}): () => void {
  const layer = { run, respectHandled: o.respectHandled === true };
  stack.push(layer);
  const d = doc();
  // one pair of listeners on the current document (a different document object, as a test swaps in, gets them again)
  if (d?.addEventListener && installed?.doc !== d) install(d);
  return () => {
    const at = stack.indexOf(layer);
    if (at >= 0) stack.splice(at, 1);
    if (stack.length === 0 && installed !== null) {
      installed.doc.removeEventListener?.("keydown", onCapture, true);
      installed.doc.removeEventListener?.("keydown", onBubble);
      installed = null;
    }
  };
}

/** For a component: while `active`, Escape runs `run` when this is the topmost layer. The latest `run` is used, and the layer keeps its place across renders. */
export function useEscapeLayer(active: boolean, run: () => void, o: { respectHandled?: boolean } = {}): void {
  const respect = o.respectHandled === true;
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!active || Platform.OS !== "web") return undefined;
    return pushEscapeLayer(() => latest.current(), { respectHandled: respect });
  }, [active, respect]);
}

/** Tests: how many layers are open. */
export const escapeLayers = (): number => stack.length;
