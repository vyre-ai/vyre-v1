// Whether the place this is drawn in is on screen (lane r42-subagents): a place kept mounted behind another has no size, and a hidden window says so. Reads that nobody is looking at wait for it. Defaults to
// shown, so a screen with no element to measure (a test, native) reads as before. It checks every few seconds and when the window's visibility changes.
import { useEffect, useState } from "react";

type Measurable = { current: { getBoundingClientRect?: () => { width: number; height: number } } | null };
type Doc = {
  visibilityState?: string;
  addEventListener?: (t: string, f: () => void) => void;
  removeEventListener?: (t: string, f: () => void) => void;
};

export function useShown(ref: Measurable): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const doc = (globalThis as { document?: Doc }).document;
    const check = (): void => {
      const b = ref.current?.getBoundingClientRect?.();
      const empty = b !== undefined && (b.width === 0 || b.height === 0);
      setShown(doc?.visibilityState !== "hidden" && !empty);
    };
    check();
    const t = setInterval(check, 3000);
    (t as { unref?: () => void }).unref?.();
    doc?.addEventListener?.("visibilitychange", check);
    return () => {
      clearInterval(t);
      doc?.removeEventListener?.("visibilitychange", check);
    };
  }, [ref]);
  return shown;
}
