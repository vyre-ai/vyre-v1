// What a link in a chat shows in the right pane, as plain rules (ThingPane.tsx draws it).
/** A thing the pane shows: a file (or a document) or a record. */
export interface Thing {
  type: "file" | "record";
  id: string;
}

/** The kinds of thing a link in a chat shows in the pane; any other kind opens as a tab. */
export function thingOf(kind: string, id: string): Thing | null {
  if (kind === "file" || kind === "doc" || kind === "document") return { type: "file", id };
  if (kind === "record" || kind === "contact") return { type: "record", id };
  return null;
}

/** Pressing a thing in the pane: the same thing is left as it is; another replaces it and the one it replaced is kept for Back. */
export function nextTrail(trail: readonly Thing[], to: Thing): readonly Thing[] {
  const now = trail[trail.length - 1];
  if (now !== undefined && now.type === to.type && now.id === to.id) return trail;
  return [...trail, to].slice(-20);
}
