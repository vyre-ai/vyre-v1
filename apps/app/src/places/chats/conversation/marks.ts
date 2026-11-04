// How a marked message looks (a find match, the message a thread or a link goes back to). The wash and the ring spread 8 px outside the message, so its text and face never touch the edge
// and the layout does not move when the mark comes and goes.
export const MARK_GAP = 8;
export const MARK = {
  found: { backgroundColor: "var(--accent-wash)", borderRadius: 4, boxShadow: `0 0 0 ${MARK_GAP}px var(--accent-wash)` },
  // the message a thread, a link or a search result went back to: the app's subtle selected tint, no ring
  selected: { backgroundColor: "var(--accent-wash)", borderRadius: 4, boxShadow: `0 0 0 ${MARK_GAP}px var(--accent-wash)` },
  // a translucent wash under a ring shadow lets the ring show through the whole spread, so the ring is an outline drawn MARK_GAP outside the message
  foundActive: { backgroundColor: "var(--accent-wash)", borderRadius: 4, boxShadow: `0 0 0 ${MARK_GAP}px var(--accent-wash)`, outlineStyle: "solid", outlineWidth: 1, outlineColor: "var(--accent)", outlineOffset: MARK_GAP },
} as const;
