// ui/Overlay: the one top-level layer for menus, popovers and sheets. On web it is a single element at the end of the document body, so no lane, card, row, sticky header
// or transform in the app can cover what is drawn inside it (a stacking context never reaches outside its own subtree). The layer has no size of its own, so it never
// blocks a click on the app; what is drawn in it is position fixed and takes its own events. Skin tokens are CSS variables on the document root, so they reach it unchanged.
// Server render and native draw the children in place (there is no body to portal into), so tests render the plain tree.

import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform } from "react-native";

export const OVERLAY_ROOT_ID = "vyre-overlay-root";

/** The few document members the layer needs, so it can be tested with a fake. */
export interface OverlayElement {
  id: string;
  style: { cssText: string };
  setAttribute(name: string, value: string): void;
}
export interface OverlayDocument {
  getElementById(id: string): OverlayElement | null;
  createElement(tag: string): OverlayElement;
  body: { appendChild(el: OverlayElement): unknown } | null;
}

/** Zero size and fixed: it takes no room and blocks nothing, and its zIndex sits above any app layer. */
export const OVERLAY_ROOT_CSS = "position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483000";

/** The layer's element: found, or made once and put at the end of the body. Null where there is no document. */
export function ensureOverlayRoot(doc: OverlayDocument | undefined = (globalThis as { document?: OverlayDocument }).document): OverlayElement | null {
  if (!doc || !doc.body) return null;
  const found = doc.getElementById(OVERLAY_ROOT_ID);
  if (found) return found;
  const el = doc.createElement("div");
  el.id = OVERLAY_ROOT_ID;
  el.setAttribute("data-testid", "overlay-root");
  el.style.cssText = OVERLAY_ROOT_CSS;
  doc.body.appendChild(el);
  return el;
}

const subscribe = (): (() => void) => () => {};
const onClient = (): boolean => Platform.OS === "web" && (globalThis as { document?: unknown }).document !== undefined;
const onServer = (): boolean => false;

/** Draws its children in the root overlay layer. Anchor rectangles stay the caller's job: the children are fixed to the window, as the menu already is. */
export function Overlay({ children }: { children: ReactNode }): ReactElement | null {
  // false during the server render and the hydrating pass, so the first client render matches the markup; true after, when the layer can be reached
  const ready = useSyncExternalStore(subscribe, onClient, onServer);
  if (!ready) return Platform.OS === "web" && (globalThis as { document?: unknown }).document === undefined ? <>{children}</> : null;
  const root = ensureOverlayRoot();
  if (!root) return <>{children}</>;
  return createPortal(children, root as unknown as Parameters<typeof createPortal>[1]);
}
