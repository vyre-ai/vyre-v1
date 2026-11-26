// The client's half of terminal.stream (rc.44): the screen built from the numbered messages the Space sends (modules/terminal/watch.ts). A `screen` replaces everything, a `diff` changes the screen it was made
// against (its `base` is the number the viewer must have), `ok` says the viewer is current. A diff that does not follow the number the viewer has is never applied: the viewer asks for the whole screen and waits.
import type { Capture } from "./TmuxScreen.tsx";

export interface Feed {
  /** The number of the last change applied; none before the first screen. */
  rev: number | undefined;
  lines: string[];
  meta: Pick<Capture, "cols" | "rows" | "cursor" | "history" | "hidden"> | null;
}
export const EMPTY_FEED: Feed = { rev: undefined, lines: [], meta: null };

type Meta = Pick<Capture, "cols" | "rows" | "cursor" | "history" | "hidden">;
export type FeedMessage =
  | ({ t: "screen"; rev: number; text: string } & Meta)
  | ({ t: "diff"; rev: number; base: number; top: number; at: number; drop: number; ins: string[] } & Meta)
  | { t: "ok"; rev: number }
  | { t: "pong"; seq?: number }
  | { t: "refused"; reason?: string };

export interface Applied {
  feed: Feed;
  /** The screen to draw, when this message changed it. */
  capture?: Capture;
  /** The viewer fell behind (a diff that does not follow what it has): ask for the whole screen. */
  resync?: boolean;
  /** The Space refused the view. */
  refused?: string;
}

const capture = (f: Feed): Capture => ({ text: f.lines.join("\n"), ...(f.meta as Meta) });

/** Read one text frame; null when it is not a message of the stream. */
export function parseFeed(text: string): FeedMessage | null {
  try {
    const m = JSON.parse(text) as { t?: unknown };
    return m !== null && typeof m === "object" && typeof m.t === "string" ? (m as FeedMessage) : null;
  } catch {
    return null;
  }
}

export function applyFeed(f: Feed, m: FeedMessage): Applied {
  if (m.t === "screen") {
    const next: Feed = {
      rev: m.rev,
      lines: m.text.split("\n"),
      meta: { cols: m.cols, rows: m.rows, cursor: m.cursor, history: m.history, hidden: m.hidden },
    };
    return { feed: next, capture: capture(next) };
  }
  if (m.t === "diff") {
    if (f.rev === undefined || m.base !== f.rev) return { feed: f, resync: true };
    if (m.top < 0 || m.top > f.lines.length) return { feed: f, resync: true };
    const rest = f.lines.slice(m.top);
    if (m.at < 0 || m.at + m.drop > rest.length) return { feed: f, resync: true };
    const next: Feed = {
      rev: m.rev,
      lines: [...rest.slice(0, m.at), ...m.ins, ...rest.slice(m.at + m.drop)],
      meta: { cols: m.cols, rows: m.rows, cursor: m.cursor, history: m.history, hidden: m.hidden },
    };
    return { feed: next, capture: capture(next) };
  }
  if (m.t === "ok") return m.rev === f.rev ? { feed: f } : { feed: f, resync: true };
  if (m.t === "refused") return { feed: f, refused: m.reason ?? "The terminal did not open its view." };
  return { feed: f };
}
