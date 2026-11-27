// The React side of surface.ts: one reconnecting surface per `key`, that goes away with the component and tries again when the window comes back online or visible (rc.44).
import { useEffect, useRef, useState } from "react";
import { createSurface } from "./surface.ts";
import type { Surface, SurfaceState } from "./surface.ts";

export interface UseSurface<T> {
  state: SurfaceState;
  /** The address the surface last opened; replaced by a new one on every reconnect. */
  value: T | null;
  /** Tell it the connection was made, lost, or that the person pressed Try again. */
  connected(): void;
  lost(why?: string): void;
  retry(): void;
}

/** `ttlMs`: how long an address lives if nobody connects with it (the ticket's 60 s); the surface asks for a new one before that. */
export function useSurface<T>(open: () => Promise<T>, key: string, ttlMs?: number, giveUpMs?: number): UseSurface<T> {
  const [state, setState] = useState<SurfaceState>({ kind: "idle" });
  const [value, setValue] = useState<T | null>(null);
  const ctl = useRef<Surface | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    setValue(null);
    const s = createSurface<T>({
      open: () => openRef.current(),
      onOpened: setValue,
      onState: setState,
      ...(giveUpMs !== undefined ? { giveUpMs } : {}),
      ...(ttlMs !== undefined ? { expiresAt: () => Date.now() + ttlMs } : {}),
    });
    ctl.current = s;
    s.start();
    const g = globalThis as {
      addEventListener?: (n: string, f: () => void) => void;
      removeEventListener?: (n: string, f: () => void) => void;
      document?: { visibilityState?: string };
    };
    const back = (): void => {
      if (g.document?.visibilityState !== "hidden") s.resume();
    };
    g.addEventListener?.("online", back);
    g.addEventListener?.("visibilitychange", back);
    return () => {
      g.removeEventListener?.("online", back);
      g.removeEventListener?.("visibilitychange", back);
      s.dispose();
      if (ctl.current === s) ctl.current = null;
    };
  }, [key, ttlMs, giveUpMs]);
  return {
    state,
    value,
    connected: () => ctl.current?.connected(),
    lost: (why) => ctl.current?.lost(why),
    retry: () => ctl.current?.retry(),
  };
}
