// Which question cards are on screen. The question island docks a question once its own card has scrolled out of the list, and goes again when the card comes back into view, so the same question never
// shows twice at once. Web only (it reads the cards' boxes); elsewhere nothing is known to be in view and the island shows.
import { useEffect, useRef, useState } from "react";

/** A card counts as in view when more than `slack` px of it is inside the list's box. */
export function rectsOverlap(card: { top: number; bottom: number }, feed: { top: number; bottom: number }, slack = 8): boolean {
  return card.bottom > feed.top + slack && card.top < feed.bottom - slack;
}

interface Box { getBoundingClientRect(): { top: number; bottom: number }; closest?(sel: string): Box | null }
interface Doc { querySelector(sel: string): Box | null; addEventListener(t: string, f: () => void, c?: boolean): void; removeEventListener(t: string, f: () => void, c?: boolean): void }

/** The ids (of `ids`) whose card is in view in its conversation list now. */
export function useCardsInView(ids: readonly string[]): ReadonlySet<string> {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const measure = (): void => {
    const doc = (globalThis as { document?: Doc }).document;
    if (!doc || typeof doc.querySelector !== "function") return;
    const now = new Set<string>();
    for (const id of idsRef.current) {
      // the question's own card: the native question block, or the card the list draws for it
      const card = doc.querySelector(`[data-testid="blk-question-${id}"]`) ?? doc.querySelector(`[data-testid="card-${id}"]`);
      const feed = card?.closest?.('[data-testid="conversation-feed"]');
      if (card && feed && rectsOverlap(card.getBoundingClientRect(), feed.getBoundingClientRect())) now.add(id);
    }
    setSeen((cur) => (cur.size === now.size && [...now].every((x) => cur.has(x)) ? cur : now));
  };
  useEffect(() => {
    const doc = (globalThis as { document?: Doc }).document;
    if (!doc || typeof doc.addEventListener !== "function") return undefined;
    // scroll does not bubble: a capturing listener on the document hears every list's scroll
    doc.addEventListener("scroll", measure, true);
    (globalThis as { addEventListener?: (t: string, f: () => void) => void }).addEventListener?.("resize", measure);
    return () => { doc.removeEventListener("scroll", measure, true); (globalThis as { removeEventListener?: (t: string, f: () => void) => void }).removeEventListener?.("resize", measure); };
  }, []);
  // a new message, a card that opened or closed: measure again after every draw
  useEffect(measure);
  return seen;
}
