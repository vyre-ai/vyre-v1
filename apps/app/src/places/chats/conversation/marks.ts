// How a marked message looks (a find match, the message a thread or a link goes back to). The wash and the ring spread 8 px outside the message, so its text and face never touch the edge
// and the layout does not move when the mark comes and goes.
export const MARK_GAP = 8;
export const MARK = {
  found: { backgroundColor: "var(--accent-wash)", borderRadius: 4, boxShadow: `0 0 0 ${MARK_GAP}px var(--accent-wash)` },
  foundActive: { backgroundColor: "var(--accent-wash)", borderRadius: 4, boxShadow: `0 0 0 ${MARK_GAP}px var(--accent-wash), 0 0 0 ${MARK_GAP + 1}px var(--accent)` },
} as const;
