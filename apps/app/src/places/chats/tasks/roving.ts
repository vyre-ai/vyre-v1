// The roving tab stop for the Board and the Timeline: which card or row is active, the keys on it, and moving real focus to the one an arrow lands on (it may not be drawn yet, the lists draw
// only what fits, so focus waits for it). Web only; elsewhere the lists are touched, not keyed.
import { useCallback, useEffect, useRef, useState } from "react";
import { taskKey, tabStop } from "./keys.ts";
import type { Dir } from "./keys.ts";

export const CARD_ATTR = "data-tkcard";

interface El { getAttribute?(n: string): string | null; getBoundingClientRect?(): { left: number; bottom: number }; focus?(): void; blur?(): void; scrollIntoView?(o: unknown): void }
interface KeyEv { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: unknown; preventDefault(): void; stopPropagation(): void }
interface Doc { querySelector(s: string): El | null }

export interface Roving { active: string | null; tab: string | null; setActive(id: string): void; onKeyDownCapture(e: KeyEv): void; onKeyUpCapture(e: KeyEv): void }

export function useRoving(o: { cols: ReadonlyArray<readonly string[]>; step(at: string | null, dir: Dir): string | null; open(id: string): void; status(id: string, at: { x: number; y: number }): void }): Roving {
  const [active, setActiveState] = useState<string | null>(null);
  const want = useRef(false);
  const live = useRef(o);
  live.current = o;
  const setActive = useCallback((id: string): void => setActiveState(id), []);
  useEffect(() => {
    if (!want.current || active === null) return undefined;
    const doc = (globalThis as unknown as { document?: Doc }).document;
    if (!doc) return undefined;
    let tries = 0, stopped = false;
    const go = (): void => {
      if (stopped) return;
      const el = doc.querySelector(`[${CARD_ATTR}="${active}"]`);
      if (el) { el.focus?.(); el.scrollIntoView?.({ block: "nearest", inline: "nearest" }); want.current = false; return; }
      if (tries++ < 12) setTimeout(go, 16);
    };
    go();
    return () => { stopped = true; };
  }, [active]);
  const onKeyDownCapture = useCallback((e: KeyEv): void => {
    const el = e.target as El | null;
    const id = el?.getAttribute?.(CARD_ATTR);
    if (!el || !id) return;   // a key inside a card's own button is that button's
    const act = taskKey(e);
    if (!act) return;
    const L = live.current;
    if (act.t === "close") { el.blur?.(); setActiveState(null); return; }
    e.preventDefault(); e.stopPropagation();
    if (act.t === "move") { const to = L.step(id, act.dir); if (to) { want.current = true; setActiveState(to); } return; }
    if (act.t === "open") { L.open(id); return; }
    const r = el.getBoundingClientRect?.();
    L.status(id, { x: r?.left ?? 240, y: (r?.bottom ?? 160) + 4 });
  }, []);
  // the press that Space or Enter would make on release is not made: the key was taken above
  const onKeyUpCapture = useCallback((e: KeyEv): void => {
    if ((e.key === " " || e.key === "Enter") && (e.target as El | null)?.getAttribute?.(CARD_ATTR)) e.stopPropagation();
  }, []);
  return { active, tab: tabStop(o.cols, active), setActive, onKeyDownCapture, onKeyUpCapture };
}
