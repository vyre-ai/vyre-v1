// Reading a reply's details once: chat.reply_details for the reply, and the reader's own AI accounts (engine.accounts.list) to name the one it ran on. A reply that has ended does
// not change, so its read is kept for the session; one still being written is read again the next time it is asked for.
import type { ReplyDetails } from "./model.ts";

export type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface ReadDetails { details: ReplyDetails; accounts: ReadonlyMap<string, string> }

const kept = new Map<string, ReadDetails>();
let names: { at: number; map: Promise<ReadonlyMap<string, string>> } | null = null;
const NAMES_MS = 60_000;

/** The reader's AI accounts by ref, read at most once a minute; a failure leaves the names out (the line then says what kind of account it was). */
function accountNames(call: Call, now: number): Promise<ReadonlyMap<string, string>> {
  if (names && now - names.at < NAMES_MS) return names.map;
  const map = Promise.resolve(call("engine.accounts.list", {})).then((o) => {
    const rows = ((o as { accounts?: Array<{ ref?: string; name?: string; title?: string; aliases?: string[] }> } | null)?.accounts ?? []);
    const m = new Map<string, string>();
    for (const a of rows) {
      const name = a.name ?? a.title;
      if (!a.ref || !name) continue;
      m.set(a.ref, name);
      for (const alias of a.aliases ?? []) m.set(alias, name);
    }
    return m as ReadonlyMap<string, string>;
  }, () => new Map<string, string>() as ReadonlyMap<string, string>);
  names = { at: now, map };
  return map;
}

export async function readReplyDetails(call: Call, threadId: string, messageId: string, now: number = Date.now()): Promise<ReadDetails> {
  const hit = kept.get(messageId);
  if (hit) return hit;
  const [out, accounts] = await Promise.all([call("chat.reply_details", { threadId, messageId }), accountNames(call, now)]);
  const read: ReadDetails = { details: (out as { details: ReplyDetails }).details, accounts };
  if (read.details.turn?.timing.endedAt !== undefined || !read.details.turn) kept.set(messageId, read);
  return read;
}

/** What was already read for a reply, so a card or tab opened again draws at once. */
export const peekReplyDetails = (messageId: string): ReadDetails | undefined => kept.get(messageId);

/** Tests: forget what was read. */
export function forgetReplyDetails(): void { kept.clear(); names = null; }
