// The keys of the per-person layout store (state.layout.*): how a person arranged one screen. A key is registered here with the biggest value it may hold; anything else is refused, so the store
// never becomes a place for content. A value is JSON, kept as text, and is the person's alone: it is sent only to them (the event is private) and never read by anyone else.
export interface LayoutKey {
  /** the most bytes of the value as JSON */
  max: number;
  /** what a value of this key looks like, so it is a layout and not a note */
  shape: (value: unknown) => boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** `{ "<short key>": true | false }`: which sections are folded */
const folds = (v: unknown): boolean =>
  isObject(v) && Object.entries(v).every(([k, x]) => /^[a-z0-9_.:-]{1,48}$/i.test(k) && typeof x === "boolean");
/** a short name of a tab */
const tab = (v: unknown): boolean => typeof v === "string" && /^[a-z0-9_-]{1,32}$/i.test(v);

export const LAYOUT_KEYS: Readonly<Record<string, LayoutKey>> = {
  /** which sections of the Chats sidebar are folded: `{ "<section>": true }` */
  "chats.sidebar.folds": { max: 2_000, shape: folds },
  /** the tab the Notes place was last on */
  "chats.notes_tab": { max: 200, shape: tab },
  /** which sections of the Files sidebar are folded */
  "files.sidebar.folds": { max: 2_000, shape: folds },
};

/** The most keys one person can have set. */
export const LAYOUT_MAX_KEYS = 64;

/** Why a value cannot be stored under a key, or null when it can. */
export function layoutRefusal(key: string, value: unknown): string | null {
  const k = LAYOUT_KEYS[key];
  if (!k) return `${key} is not a layout key.`;
  const text = JSON.stringify(value);
  if (text === undefined) return "The value must be JSON.";
  if (new TextEncoder().encode(text).length > k.max) return `The value for ${key} may be at most ${k.max} bytes.`;
  if (!k.shape(value))
    return `The value for ${key} is not the shape of a layout (a short name, or on/off for each section), so it is not kept.`;
  return null;
}
