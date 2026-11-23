// Live slide: a card that changed lane (someone else moved it, an Automation did, an undo) slides from where it was to where it is, instead of blinking. Scrolling never animates: only a card whose
// lane changed since the last paint does. Web only; a person who asked for less motion sees the card simply there.
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { Platform } from "react-native";

interface El {
  dataset: { cardId?: string };
  getBoundingClientRect(): { left: number; top: number };
  animate?: (frames: unknown[], opts: unknown) => unknown;
}
interface Root {
  querySelectorAll(sel: string): ArrayLike<El>;
}

export function useSlide(root: RefObject<unknown>, cellOf: { current: Record<string, string> }): void {
  const rects = useRef(new Map<string, { x: number; y: number }>());
  const cells = useRef(new Map<string, string>());
  // every paint: compare with the last one
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const el = root.current as Root | null;
    if (!el?.querySelectorAll) return;
    const calm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    const nodes = el.querySelectorAll("[data-card-id]");
    const nextRects = new Map<string, { x: number; y: number }>();
    const nextCells = new Map<string, string>();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const id = n.dataset.cardId;
      if (!id) continue;
      const r = n.getBoundingClientRect();
      const cell = cellOf.current[id] ?? "";
      nextRects.set(id, { x: r.left, y: r.top });
      nextCells.set(id, cell);
      const was = rects.current.get(id);
      const wasCell = cells.current.get(id);
      if (!calm && was && wasCell !== undefined && wasCell !== cell && n.animate)
        n.animate([{ transform: `translate(${was.x - r.left}px, ${was.y - r.top}px)` }, { transform: "none" }], {
          duration: 320,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
    }
    rects.current = nextRects;
    cells.current = nextCells;
  });
}
