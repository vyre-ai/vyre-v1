// One drag for every pane edge on the web. The edge owns the pointer from press to release (pointer capture), so the width follows the cursor exactly, also across an iframe or a terminal, and a fast
// move never drops a step. While it holds the pointer the page cannot be selected and the cursor stays a resize cursor everywhere. Native keeps PanResponder (resize.tsx).

import { useCallback, useRef } from "react";
import { injectCss } from "../theme/css.ts";

export interface EdgeDrag {
  onStart(): void;
  /** The pointer's distance from where it was pressed, in px. */
  onMove(dx: number): void;
  onEnd(dx: number): void;
  onCancel(): void;
}

interface PointerLike { button: number; clientX: number; pointerId: number; preventDefault(): void }
interface EdgeNode {
  addEventListener(type: string, listener: (e: PointerLike) => void): void;
  removeEventListener(type: string, listener: (e: PointerLike) => void): void;
  setPointerCapture?(id: number): void;
}
interface Page { documentElement: { setAttribute(k: string, v: string): void; removeAttribute(k: string): void } ; getSelection?(): { removeAllRanges(): void } | null }

export const RESIZING_ATTR = "data-resizing";
export const RESIZING_CSS = `html[${RESIZING_ATTR}],html[${RESIZING_ATTR}] *{cursor:col-resize!important;-webkit-user-select:none!important;user-select:none!important}html[${RESIZING_ATTR}] iframe{pointer-events:none!important}`;

const pageOf = (): Page | undefined => (globalThis as { document?: Page }).document;

/** The page while an edge is dragged: nothing selectable, nothing already selected. Returns the release. */
export function holdPage(page: Page | undefined = pageOf()): () => void {
  if (page === undefined) return () => undefined;
  injectCss(page as never, "vyre-ui-resizing", RESIZING_CSS);
  page.getSelection?.()?.removeAllRanges();
  page.documentElement.setAttribute(RESIZING_ATTR, "1");
  return () => { page.documentElement.removeAttribute(RESIZING_ATTR); };
}

/** The handlers of one press on an edge. A plain function of the node, so a test drives it with a stand-in. */
export function bindEdge(node: EdgeNode, drag: () => EdgeDrag, page?: Page): () => void {
  let release: (() => void) | null = null;
  let from = 0;
  const off = (): void => {
    release?.(); release = null;
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerup", up);
    node.removeEventListener("pointercancel", cancel);
  };
  const move = (e: PointerLike): void => { drag().onMove(e.clientX - from); };
  const up = (e: PointerLike): void => { const dx = e.clientX - from; off(); drag().onEnd(dx); };
  const cancel = (): void => { off(); drag().onCancel(); };
  const down = (e: PointerLike): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    from = e.clientX;
    node.setPointerCapture?.(e.pointerId);
    release = holdPage(page);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    drag().onStart();
  };
  // a text selection starts on the mouse press, not the pointer press
  const noSelect = (e: PointerLike): void => { e.preventDefault(); };
  node.addEventListener("pointerdown", down);
  node.addEventListener("mousedown", noSelect);
  return () => { off(); node.removeEventListener("pointerdown", down); node.removeEventListener("mousedown", noSelect); };
}

/** The ref for an edge's view: it binds the drag to the node as it mounts and lets go as it leaves. */
export function useEdgeDrag(drag: EdgeDrag): (node: unknown) => void {
  const latest = useRef(drag);
  latest.current = drag;
  const bound = useRef<(() => void) | null>(null);
  return useCallback((node: unknown) => {
    bound.current?.();
    bound.current = null;
    if (node !== null && typeof node === "object" && typeof (node as EdgeNode).addEventListener === "function") bound.current = bindEdge(node as EdgeNode, () => latest.current);
  }, []);
}
