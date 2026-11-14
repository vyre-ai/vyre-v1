// The artifact viewer's frame in the Mac and Windows app. WebKit never keeps a cookie that a cross-site frame sets, and tauri://localhost is cross-site to every Space (proven on the macOS runner,
// test/artifact-frame.browser.test.ts), so the desktop app does not frame the artifact host. The shell opens it as a child webview over this element (apps/desktop/src-tauri/src/artifact_view.rs):
// a top-level page of the host, with a cookie of its own. This element is the placeholder: it reports where it is and how big, and the shell puts the page there. A native view draws above
// the page, so `covered` (a menu or the Share sheet is open) takes it away until the space is free again. In a browser, or when the shell has no such command, `available()` is false and the
// viewer keeps its frame.
import { createElement, useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";

export type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The shell's invoke when this page runs inside the desktop app; undefined in a browser. */
export const shellInvoke = (
  g: { __TAURI__?: { core?: { invoke?: Invoke } } } = globalThis as never,
): Invoke | undefined => g.__TAURI__?.core?.invoke;

/** True when the desktop app can open the artifact as a page of its own (the shell has the command). */
export const available = (g?: Parameters<typeof shellInvoke>[0]): boolean => shellInvoke(g) !== undefined;

/** A rectangle the shell can place a webview at: whole logical pixels, never empty. Null for an element that is not drawn. */
export function rectOf(r: { left: number; top: number; width: number; height: number }): Rect | null {
  if (![r.left, r.top, r.width, r.height].every(Number.isFinite) || r.width < 1 || r.height < 1) return null;
  return {
    x: Math.max(0, Math.round(r.left)),
    y: Math.max(0, Math.round(r.top)),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

export const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

export interface FrameProps {
  /** The artifact host's one-time address (https://<host>/x/<code>), without ?embed. */
  url: string;
  title: string;
  /** A menu or a sheet is open over the viewer: the page steps aside. */
  covered?: boolean;
  /** Called when the shell refuses or fails, with its words. */
  onError?(message: string): void;
  /** Called once the shell has placed the page (it is loading or loaded there): the viewer's own loading state can end. */
  onPlaced?(): void;
  /** The shell no longer has the page (it was closed, the app restarted): the address it was opened at is spent, so the viewer asks for a new one. */
  onGone?(): void;
  invoke?: Invoke;
  style?: CSSProperties;
}

/** What artifact_view_bounds answers when the shell has no page to move (src-tauri artifact_view.rs GONE). */
export const VIEW_GONE = "The viewer is gone.";

/**
 * What the frame says to the shell: the page once, then only moves. A hide steps the page off-screen (the shell keeps it, with its place and state) and the next place brings the same page back, never a new load;
 * a close ends it. When the shell says the page is gone, the viewer is told (onGone) and the next place shows again.
 */
export function createPlacer(
  call: Invoke,
  url: string,
  onError?: (message: string) => void,
  onShown?: () => void,
  onGone?: () => void,
): { place(rect: Rect | null): void; hide(): void; close(): void } {
  let shown = false;
  let said: Rect | null = null;
  const fail = (e: unknown): void =>
    onError?.(typeof e === "string" ? e : e instanceof Error ? e.message : "This page couldn't load here.");
  return {
    place(rect) {
      if (!rect || sameRect(rect, said)) return;
      said = rect;
      const first = !shown;
      shown = true;
      void call(first ? "artifact_view_show" : "artifact_view_bounds", first ? { url, ...rect } : { ...rect }).then(
        () => {
          if (first) onShown?.();
        },
        (e) => {
          if (e === VIEW_GONE || (e instanceof Error && e.message === VIEW_GONE)) {
            shown = false;
            said = null;
            onGone?.();
            return;
          }
          if (first) {
            shown = false;
            said = null;
          }
          fail(e);
        },
      );
    },
    hide() {
      shown = false;
      said = null;
      void call("artifact_view_hide").catch(() => undefined);
    },
    close() {
      shown = false;
      said = null;
      void call("artifact_view_close").catch(() => undefined);
    },
  };
}

/** The placeholder the shell's child webview sits over. */
export function DesktopArtifactFrame({
  url,
  title,
  covered = false,
  onError,
  onPlaced,
  onGone,
  invoke,
  style,
}: FrameProps): ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const call = invoke ?? shellInvoke();
  const placer = useRef<ReturnType<typeof createPlacer> | null>(null);
  const cover = useRef(covered);
  cover.current = covered;
  const rectNow = (): Rect | null => {
    const el = box.current;
    return el && typeof el.getBoundingClientRect === "function" ? rectOf(el.getBoundingClientRect()) : null;
  };

  // the page of one address: made once, moved with the frame, closed when the address changes or the viewer goes
  useEffect(() => {
    const el = box.current;
    if (!call) return undefined;
    const p = createPlacer(call, url, onError, onPlaced, onGone);
    placer.current = p;
    if (!el || typeof el.getBoundingClientRect !== "function")
      return () => {
        p.close();
        placer.current = null;
      };
    const place = (): void => {
      if (!cover.current) p.place(rectOf(el.getBoundingClientRect()));
    };
    place();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(el);
    const g = globalThis as {
      addEventListener?: (t: string, f: () => void, o?: boolean) => void;
      removeEventListener?: (t: string, f: () => void, o?: boolean) => void;
    };
    g.addEventListener?.("resize", place);
    g.addEventListener?.("scroll", place, true);
    return () => {
      ro?.disconnect();
      g.removeEventListener?.("resize", place);
      g.removeEventListener?.("scroll", place, true);
      p.close(); // a new address or leaving the viewer: the page goes for good
      placer.current = null;
    };
  }, [url, call]); // eslint-disable-line react-hooks/exhaustive-deps

  // a menu or the Share sheet: the page steps aside and keeps its place, then comes back as it was
  const first = useRef(true);
  useEffect(() => {
    const p = placer.current;
    if (first.current) {
      first.current = false;
      if (!covered) return;
    }
    if (!p) return;
    if (covered) p.hide();
    else p.place(rectNow());
  }, [covered]); // eslint-disable-line react-hooks/exhaustive-deps

  return createElement("div", {
    ref: box,
    role: "region",
    "aria-label": title,
    "data-testid": "artifact-desktop-frame",
    style: { width: "100%", height: "100%", minHeight: 240, background: "transparent", ...style },
  });
}
