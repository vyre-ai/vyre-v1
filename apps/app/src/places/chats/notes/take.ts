// Take a note, the pure part: the bar opens in place, takes a title, text, a colour, labels, a pin, who sees it, a pasted or picked image and a pasted link (read into a card); Esc, Close
// or a press outside saves it and an empty one is dropped. What a paste is (an image, a lone link, text) is decided here. The bar at the foot of the page (a note deleted, with Undo) is the
// small reducer at the end. No React here.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { NoteColor } from "./model.ts";

export type ImageType = NonNullable<CapMap["notes.create"]["in"]["image"]>["contentType"];
export const IMAGE_TYPES: readonly ImageType[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** An image held before it is saved: the bytes as base64, their type, and the data address the page draws it from. */
export interface TakeImage { data: string; contentType: ImageType; uri: string }
/** A pasted link once it is read: what the card shows. */
/** A link card. `image` is only ever a data address the server fetched (read_link with preview, or notes.image part link): a browser never loads another site's picture. */
export interface LinkPreview { url: string; title?: string; siteName?: string; image?: string; description?: string; preview?: "image" | "icon" }
/** Who sees a new note: only you, a person (the share sheet opens once it is saved), or the Space. */
export type TakeShare = "private" | "person" | "space";

export interface Take {
  open: boolean;
  title: string;
  body: string;
  image: TakeImage | null;
  link: LinkPreview | null;
  /** The link being read, shown as "Reading <url>" until its card arrives. */
  reading: string | null;
  color: NoteColor;
  pinned: boolean;
  labels: string[];
  share: TakeShare;
}

export const CLOSED: Take = { open: false, title: "", body: "", image: null, link: null, reading: null, color: "", pinned: false, labels: [], share: "private" };

export type TakeAct =
  | { t: "open" }
  | { t: "title"; v: string }
  | { t: "body"; v: string }
  | { t: "image"; image: TakeImage }
  | { t: "rm-image" }
  /** A lone link was pasted: the bar opens and says it is reading it. */
  | { t: "reading"; url: string }
  /** The link was read (or could not be: then the card has its address and host only). A late answer for a link no longer being read is dropped. */
  | { t: "read"; link: LinkPreview }
  | { t: "rm-link" }
  /** Text pasted on the grid with nothing focused: the bar opens holding it. */
  | { t: "paste-text"; text: string }
  | { t: "color"; c: NoteColor }
  | { t: "pin" }
  | { t: "label"; name: string }
  | { t: "share"; v: TakeShare }
  | { t: "reset" };

export function takeStep(s: Take, a: TakeAct): Take {
  switch (a.t) {
    case "open": return s.open ? s : { ...s, open: true };
    case "title": return { ...s, title: a.v };
    case "body": return { ...s, body: a.v };
    case "image": return { ...s, open: true, image: a.image };
    case "rm-image": return { ...s, image: null };
    case "reading": return { ...s, open: true, reading: a.url, link: null };
    case "read": return s.reading !== null && sameLink(s.reading, a.link.url) ? { ...s, reading: null, link: a.link } : s;
    case "rm-link": return { ...s, link: null, reading: null };
    case "paste-text": return { ...s, open: true, body: s.body ? `${s.body}\n${a.text}` : a.text };
    case "color": return { ...s, color: a.c };
    case "pin": return { ...s, pinned: !s.pinned };
    case "label": return { ...s, labels: s.labels.includes(a.name) ? s.labels.filter((l) => l !== a.name) : [...s.labels, a.name] };
    case "share": return { ...s, share: a.v };
    case "reset": return CLOSED;
  }
}

const bare = (u: string): string => u.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
const sameLink = (a: string, b: string): boolean => bare(a) === bare(b);

/** Nothing typed, no image and no link: closing drops it. */
export function takeIsEmpty(s: Take): boolean {
  return s.title.trim() === "" && s.body.trim() === "" && s.image === null && s.link === null && s.reading === null;
}

/** What notes.create is sent for the bar, or null when there is nothing to keep. */
export function createInput(s: Take, idempotencyKey: string): CapMap["notes.create"]["in"] | null {
  if (takeIsEmpty(s)) return null;
  const link = s.link?.url ?? s.reading;
  return {
    idempotencyKey,
    ...(s.title.trim() ? { title: s.title.trim() } : {}),
    ...(s.body.trim() ? { body: s.body.replace(/\s+$/, "") } : {}),
    ...(s.color ? { color: s.color } : {}),
    ...(s.pinned ? { pinned: true } : {}),
    ...(s.labels.length ? { labels: s.labels } : {}),
    ...(s.image ? { image: { data: s.image.data, contentType: s.image.contentType } } : {}),
    ...(link ? { link: /^https?:\/\//i.test(link) ? link : `https://${link}` } : {}),
  };
}

/** A paste is a lone link when the whole text is one web address and nothing else. */
export function loneLink(text: string): string | null {
  const t = text.trim();
  return /^https?:\/\/[^\s]+$/i.test(t) ? t : null;
}

export interface PasteLike { files: readonly { type: string }[]; text: string }
export type PasteKind = { kind: "image"; index: number } | { kind: "link"; url: string } | { kind: "text"; text: string } | null;

/**
 * What a paste becomes. An image (of a kind a note keeps) becomes the note's picture; a lone link becomes a card; other text stays text. `inField` is true when the paste lands in a field
 * other than the bar's own (a search box, a sheet): text is left to that field, and only an image or a link is taken. Null leaves the paste alone.
 */
export function pasteKind(p: PasteLike, inField: boolean): PasteKind {
  const index = p.files.findIndex((f) => (IMAGE_TYPES as readonly string[]).includes(f.type));
  if (index >= 0) return inField ? null : { kind: "image", index };
  const url = loneLink(p.text);
  if (url) return inField ? null : { kind: "link", url };
  const text = p.text.trim();
  return !inField && text ? { kind: "text", text } : null;
}

/** A data address (data:image/png;base64,...) split into what notes.create takes. Null for anything a note does not keep. */
export function fromDataUri(uri: string): TakeImage | null {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  return m ? { contentType: m[1] as ImageType, data: m[2]!, uri } : null;
}

export function toDataUri(contentType: string, data: string): string {
  return `data:${contentType};base64,${data}`;
}

/* ---------- the bar at the foot of the page ---------- */

export interface Bar { text: string; /** the note a delete took away: Undo restores it */ undo?: string; /** the note Open goes to */ open?: string }
export type BarAct = { t: "say"; text: string } | { t: "deleted"; noteId: string; mine: boolean } | { t: "saved"; noteId: string; text: string } | { t: "dismiss" } | { t: "undone" };

/** One line at a time. Undo stays until the next action replaces or dismisses the line. */
export function barStep(s: Bar | null, a: BarAct): Bar | null {
  switch (a.t) {
    case "say": return { text: a.text };
    case "deleted": return { text: a.mine ? "Note deleted" : "Removed from your notes", undo: a.noteId };
    case "saved": return { text: a.text, open: a.noteId };
    case "dismiss": return null;
    case "undone": return s?.undo ? null : s;
  }
}
