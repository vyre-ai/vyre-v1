// The sample behind the Unmatched tests and screenshots: the contact tab sample (which already holds one unmatched sender, +1 628 555 0194) with a second, suggestions per conversation, and the
// four capabilities the screen uses. A match moves the whole conversation onto the record's contact and answers an undo token; Create a Record turns the line into a new contact; Undo puts it back.
import type { Row } from "../../../../../../client/src/index.ts";
import { SAMPLE_NOW, northwind } from "../contactlist/sample.ts";
import type { SampleSpace } from "../contactlist/sample.ts";
import { createContactTabSample } from "../contacttab/sample.ts";
import type { ContactTabSample } from "../contacttab/sample.ts";
import type { InboxData } from "../sidebar/data.tsx";
import type { ContactRow } from "../sidebar/model.ts";
import { withTelephony } from "../softphone/sample.ts";
import type { PhoneSample } from "../softphone/sample.ts";
import type { Suggestion } from "./model.ts";

const ago = (m: number): number => SAMPLE_NOW - m * 60_000;

/** Which conversation row a record belongs to. */
const ROW_OF_RECORD: Record<string, string> = { rec_hannah: "hannah", rec_cole: "hannah", rec_sofia: "sofia" };
const SUGGESTIONS: Record<string, Suggestion[]> = {
  unk: [
    { recordId: "rec_hannah", type: "contact", name: "Hannah Cole", score: 0.92, why: "Texted from a number one digit away" },
    { recordId: "rec_cole", type: "company", name: "Cole Dental", score: 0.61, why: "Same area code, a dental practice" },
  ],
};

interface Undo { source: ContactRow; moved: string[]; target?: ContactRow }

export interface UnmatchedSample extends PhoneSample<ContactTabSample> {
  /** Every match, create and undo, in order. */
  matches: { cap: string; input: unknown }[];
}

export function createUnmatchedSample(space: SampleSpace = northwind, o: { online?: boolean } = {}): UnmatchedSample {
  const base = createContactTabSample(space, o);
  const phone = withTelephony(base);
  const { replica } = base;
  const matches: UnmatchedSample["matches"] = [];
  const contacts = (): ContactRow[] => replica.rows("contacts") as unknown as ContactRow[];
  const items = (): (Row & { conversationId: string })[] => replica.rows("thread_items") as unknown as (Row & { conversationId: string })[];

  // the one unmatched sender is the prototype's (+1 628 555 0194, in the contact sample); nothing is added here
  // the unmatched number texted before: its messages move with a match
  if (space.id === "northwind") {
    replica.put("thread_items", [{ conversationId: "unk", kind: "sms", id: "unk_1", at: ago(35), direction: "in", preview: "Hi, is this the Northwind office? I got a missed call from this number.", ref: { body: "Hi, is this the Northwind office? I got a missed call from this number.", via: "+1 415 555 0132", address: "+1 628 555 0194" } } as unknown as Row]);
  }
  const unmatched = (): ContactRow[] => contacts().filter((c) => c.contactId === undefined && c.needsMatch);

  replica.resolve("inbox.unmatched", (_t, i) => {
    const q = i.query?.trim().toLowerCase();
    const rows = unmatched().filter((c) => !q || `${c.displayName} ${c.address} ${c.lastPreview}`.toLowerCase().includes(q)).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return { rows: rows.map((r) => ({ ...r, unmatched: true })), total: rows.length } as never;
  });
  replica.resolve("inbox.match_suggestions", (_t, i) => ({ suggestions: SUGGESTIONS[i.conversationId] ?? [] }));

  const undos = new Map<string, Undo>();
  // the suggestions are also asked as a call (the Match menu asks when it opens)
  let n = 0;
  const writes: Record<string, (i: never) => unknown> = {
    "inbox.match_suggestions": (i: { conversationId: string }) => ({ suggestions: SUGGESTIONS[i.conversationId] ?? [] }),
    "inbox.match": (i: { conversationId: string; recordId: string }) => {
      matches.push({ cap: "inbox.match", input: i });
      const source = contacts().find((c) => c.id === i.conversationId);
      const target = contacts().find((c) => c.id === ROW_OF_RECORD[i.recordId]);
      if (!source || !target) throw new Error("that conversation or record is not here");
      const moved = items().filter((x) => x.conversationId === source.id);
      replica.put("thread_items", moved.map((x) => ({ ...x, conversationId: target.id })) as unknown as Row[]);
      const newer = source.lastMessageAt > target.lastMessageAt;
      const merged = { ...target, unreadCount: target.unreadCount + source.unreadCount, ...(newer ? { lastMessageAt: source.lastMessageAt, lastChannel: source.lastChannel, lastPreview: source.lastPreview } : {}) } as ContactRow;
      replica.put("contacts", [merged as unknown as Row]);
      replica.remove("contacts", [source.id]);
      const token = `undo_${++n}`;
      undos.set(token, { source, moved: moved.map((x) => String(x.id)), target });
      return { conversation: merged, undoToken: token };
    },
    "inbox.match_new": (i: { conversationId: string; type: "contact" | "company"; name?: string }) => {
      matches.push({ cap: "inbox.match_new", input: i });
      const source = contacts().find((c) => c.id === i.conversationId);
      if (!source) throw new Error("that conversation is not here");
      const created = { ...source, contactId: `ct_${source.id}`, needsMatch: false, displayName: i.name ?? source.displayName } as ContactRow;
      replica.put("contacts", [created as unknown as Row]);
      return { recordId: `rec_new_${source.id}`, conversation: created };
    },
    "inbox.unmatch": (i: { conversationId: string; undoToken?: string }) => {
      matches.push({ cap: "inbox.unmatch", input: i });
      const u = i.undoToken ? undos.get(i.undoToken) : undefined;
      if (!u) throw new Error("there is nothing to undo");
      replica.put("thread_items", items().filter((x) => u.moved.includes(String(x.id))).map((x) => ({ ...x, conversationId: u.source.id })) as unknown as Row[]);
      if (u.target) replica.put("contacts", [u.target as unknown as Row]);
      replica.put("contacts", [u.source as unknown as Row]);
      undos.delete(i.undoToken!);
      return { conversation: u.source };
    },
  };

  const data: InboxData = {
    ...phone.data,
    async call(cap, input) {
      const w = writes[cap];
      if (!w) return phone.data.call(cap, input);
      base.calls.push({ cap, input });
      return w(input as never);
    },
    // the placeholder nav handlers of the base sample, kept
    nav: base.data.nav,
  };
  return { ...phone, data, matches };
}
