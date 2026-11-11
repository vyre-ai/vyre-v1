// One Escape closes one layer. Every popover, picker, sheet, dialog and lightbox that closes on Escape from the document registers here, and the key goes to the topmost layer only: the newest one opened.
// Before this, each layer listened on its own and called stopPropagation, which does not stop another listener on the same node, so one Escape closed a date picker and the dialog under it together.
// A key an inner field already handled (defaultPrevented) is left alone, so an open suggestion list closes before the dialog around it does.
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

type KeyLike = { key?: string; defaultPrevented?: boolean };
type Doc = { addEventListener?: (t: string, f: (e: KeyLike) => void) => void; removeEventListener?: (t: string, f: (e: KeyLike) => void) => void };

const stack: Array<{ run: () => void }> = [];
let installed: { doc: Doc; fn: (e: KeyLike) => void } | null = null;

const doc = (): Doc | undefined => (globalThis as { document?: Doc }).document;

function onKey(e: KeyLike): void {
  if (e.key !== "Escape" || e.defaultPrevented === true || stack.length === 0) return;
  stack[stack.length - 1]!.run();
}

/** Adds a layer (it is the top until another is added). Returns the function that removes it. */
export function pushEscapeLayer(run: () => void): () => void {
  const layer = { run };
  stack.push(layer);
  const d = doc();
  // one listener on the current document (a different document object, as a test swaps in, gets it again)
  if (d?.addEventListener && installed?.doc !== d) { installed?.doc.removeEventListener?.("keydown", installed.fn); d.addEventListener("keydown", onKey); installed = { doc: d, fn: onKey }; }
  return () => {
    const at = stack.indexOf(layer);
    if (at >= 0) stack.splice(at, 1);
    if (stack.length === 0 && installed !== null) { installed.doc.removeEventListener?.("keydown", installed.fn); installed = null; }
  };
}

/** For a component: while `active`, Escape runs `run` when this is the topmost layer. The latest `run` is used, and the layer keeps its place across renders. */
export function useEscapeLayer(active: boolean, run: () => void): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!active || Platform.OS !== "web") return undefined;
    return pushEscapeLayer(() => latest.current());
  }, [active]);
}

/** Tests: how many layers are open. */
export const escapeLayers = (): number => stack.length;
