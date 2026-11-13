// The Inbox's side of per-person state (contract P2, step 4): what "a conversation" is to the `state` module (who can see it, which badge it counts in, its entries and their positions), and the few
// calls the Inbox makes on the seam. Positions are `inbox_item.arrival`, a Space-wide number given in the order the Inbox files items, so a position means the same in every conversation and a merge
// or an Undo never has to renumber anything. Only inbound items are entries: an outbound item is a reply, it never adds to anyone's unread and never brings a Done thing back.
import { rawDbOf } from "../../host/src/ctx/db.ts";
import { StateRefusal, stateSeamOf } from "../../host/src/seams/state.ts";
import type { StateEnv, StateKind, StateStore, ThingState } from "../../host/src/seams/state.ts";
import { peopleOf, stateEnvOf } from "../../host/src/seams/state-env.ts";
import type { RawDb } from "../../host/src/ctx/db.ts";
import { codeOf, first, jsonList, num, rowsOf, str, strOrNull } from "./projections.ts";
import type { ConversationRow, InboxCtx, Row } from "./projections.ts";

export const CONVERSATION = "conversation";
export const thingOf = (id: string): { type: string; id: string } => ({ type: CONVERSATION, id });

type Inboxes = { type: "mailbox" | "number"; id: string }[];

function conversationOf(db: RawDb, id: string): Row | null {
  return first(
    db.all(
      `SELECT "ownerId", "contactId", "mailboxIds", "numberIds" FROM inbox_conversation WHERE id = ? AND deleted_at IS NULL`,
      id,
    ),
  );
}
const isPrivate = (db: RawDb, id: string): boolean =>
  first(db.all(`SELECT "conversationId" FROM inbox_private WHERE "conversationId" = ?`, id)) !== null;
const inboxesOf = (conv: Row): Inboxes => [
  ...jsonList(conv["mailboxIds"]).map((id) => ({ type: "mailbox" as const, id })),
  ...jsonList(conv["numberIds"]).map((id) => ({ type: "number" as const, id })),
];
const followersOf = (db: RawDb, conv: Row): string[] => {
  const contactId = strOrNull(conv, "contactId");
  return contactId
    ? rowsOf(
        db.all(`SELECT "principalId" FROM inbox_follow WHERE "contactId" = ? AND deleted_at IS NULL`, contactId),
      ).map((r) => str(r, "principalId"))
    : [];
};

/** The reasons a conversation reaches a person (views.ts reasonsOf): they own it, follow its contact, or can see the inbox it arrived in. A private conversation reaches its owner alone. */
function reaches(db: RawDb, id: string, conv: Row, person: string, env: StateEnv): boolean {
  if (strOrNull(conv, "ownerId") === person) return true;
  if (isPrivate(db, id)) return false;
  if (followersOf(db, conv).includes(person)) return true;
  return inboxesOf(conv).some((i) => env.mayView(person, i.type, i.id));
}

const inboundItems = `SELECT i.arrival AS pos, i.at AS at, i."conversationId" AS conv FROM inbox_item i JOIN inbox_conversation c ON c.id = i."conversationId" AND c.deleted_at IS NULL
  WHERE i.direction = 'in' AND i.arrival IS NOT NULL`;
const partyItems = `SELECT i.arrival AS pos, i.at AS at, c.id AS conv FROM inbox_party p JOIN inbox_item i ON i.id = p."itemId" JOIN inbox_conversation c ON c."contactId" = p."contactId" AND c.deleted_at IS NULL
  WHERE i.direction = 'in' AND i.arrival IS NOT NULL`;

/** What the `state` module needs to know about an Inbox conversation. Registered through `stateKinds` in impl.ts. */
export const conversationKind: StateKind = {
  type: CONVERSATION,
  reopen: "new_entry",
  audience(db, id, env) {
    const conv = conversationOf(db, id);
    if (!conv) return [];
    const owner = strOrNull(conv, "ownerId");
    if (isPrivate(db, id)) return owner ? [owner] : [];
    const out = new Set<string>(followersOf(db, conv));
    if (owner) out.add(owner);
    const inboxes = inboxesOf(conv);
    if (inboxes.length) for (const p of env.people) if (inboxes.some((i) => env.mayView(p, i.type, i.id))) out.add(p);
    return [...out];
  },
  visible(db, id, person, env) {
    const conv = conversationOf(db, id);
    return conv !== null && reaches(db, id, conv, person, env);
  },
  scope(db, id) {
    const conv = conversationOf(db, id);
    const first = conv ? inboxesOf(conv)[0] : undefined;
    return first ? `${first.type}:${first.id}` : "inbox";
  },
  entries(db, id) {
    const rows = [
      ...rowsOf(db.all(`${inboundItems} AND i."conversationId" = ?`, id)),
      ...rowsOf(db.all(`${partyItems} AND c.id = ?`, id)),
    ];
    return [...new Set(rows.map((r) => num(r, "pos")))].map((pos) => ({ pos, by: null }));
  },
  heads(db) {
    const best = new Map<string, { thing: string; head: number; at: number }>();
    for (const r of [
      ...rowsOf(db.all(`SELECT conv AS thing, MAX(pos) AS head, MAX(at) AS at FROM (${inboundItems}) GROUP BY conv`)),
      ...rowsOf(db.all(`SELECT conv AS thing, MAX(pos) AS head, MAX(at) AS at FROM (${partyItems}) GROUP BY conv`)),
    ]) {
      const thing = str(r, "thing");
      const have = best.get(thing);
      if (!have || num(r, "head") > have.head) best.set(thing, { thing, head: num(r, "head"), at: num(r, "at") });
    }
    return [...best.values()];
  },
};

/** The kinds this module offers the host (the loader reads `stateKinds` from impl.ts). */
export const stateKinds: StateKind[] = [conversationKind];

// ---- what a handler needs

/** Whose state a call is about: the person an agent acts for, else the caller. */
export const subjectOf = (ctx: Pick<InboxCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

/** The seam for a handler that needs access (who can open what) but not the list of people. */
export async function seamFor(ctx: InboxCtx): Promise<StateStore> {
  return stateSeamOf(ctx.db, ctx.now, await stateEnvOf(ctx));
}

export function rawOf(ctx: Pick<InboxCtx, "db">): RawDb {
  const raw = rawDbOf(ctx.db);
  if (!raw) throw new StateRefusal("bad_input", "This handle has no host connection to keep state on.");
  return raw;
}

/** The seam for a read of the caller's own state: it needs neither people nor access. */
export const readSeam = (ctx: InboxCtx): StateStore => stateSeamOf(ctx.db, ctx.now);

export const maxPos = Number.MAX_SAFE_INTEGER;

/**
 * An inbound item was filed in a conversation: it reaches everyone who can see the conversation, each on their own, and brings a Done conversation back for them. An outbound item is a reply:
 * it is not an entry, so it adds to nobody's unread and reopens nothing (and, as before, it does not clear what is unread either). Never fails the filing: the item is committed, and a repair at
 * the next start (`state.verify`) mends an entry that was not counted.
 */
export async function noteItem(
  ctx: InboxCtx,
  a: { conversationId: string; direction: "in" | "out"; arrival: number; at: number },
): Promise<void> {
  if (a.direction !== "in") return;
  // Until the backfill has run the item is not counted here: the backfill reads every conversation as it is then, this item (filed unread) included, and sets each person's place once. Counting it now would
  // make a row that the backfill then leaves alone.
  if (!finished(ctx)) return;
  try {
    const people = await peopleOf(ctx);
    // a list of people that cannot be read is not an empty Space: the item is committed and `state.verify` counts it once the list can be read (a head that lags is what it looks for)
    if (people.length === 0) throw new StateRefusal("bad_input", "the list of people could not be read");
    stateSeamOf(ctx.db, ctx.now, { ...(await stateEnvOf(ctx)), people }).arrive(thingOf(a.conversationId), {
      pos: a.arrival,
      by: null,
      at: a.at,
    });
  } catch (e) {
    ctx.log.warn("inbox: per-person state was not updated for an item", { code: codeOf(e) || (e as Error).message });
  }
}

/** The caller's state on conversations, one query for the lot. */
export async function stateOfMany(ctx: InboxCtx, ids: readonly string[]): Promise<Map<string, ThingState>> {
  if (ids.length === 0) return new Map();
  const states = readSeam(ctx).stateOf(subjectOf(ctx), ids.map(thingOf));
  return new Map(states.map((s) => [s.thing.id, s]));
}

const BACKFILL_KEY = "state_backfill";

/** Has the Inbox started per-person state on this Space (backfill.ts)? */
export const finished = (ctx: Pick<InboxCtx, "db">): boolean =>
  first(ctx.db.all(`SELECT "key" FROM inbox_flag WHERE "key" = ?`, BACKFILL_KEY)) !== null;
export const markFinished = (ctx: Pick<InboxCtx, "db" | "now">): void => {
  ctx.db.run(`INSERT OR IGNORE INTO inbox_flag ("key", "at") VALUES (?, ?)`, BACKFILL_KEY, ctx.now());
};

/** Give every item without an arrival number one, in the order it was filed (time, then id), after the highest number there is. Returns what it gave, by id; with `write` false nothing is written. */
export function numberLegacy(ctx: Pick<InboxCtx, "db">, write: boolean): Map<string, number> {
  const base = num(first(ctx.db.all(`SELECT COALESCE(MAX(arrival), 0) AS n FROM inbox_item`)), "n");
  const missing = rowsOf(ctx.db.all(`SELECT id FROM inbox_item WHERE arrival IS NULL ORDER BY at, id`)).map((r) =>
    str(r, "id"),
  );
  const given = new Map(missing.map((id, i) => [id, base + i + 1]));
  if (write && missing.length > 0)
    ctx.db.run(
      `UPDATE inbox_item SET arrival = r.rn + ? FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY at, id) AS rn FROM inbox_item WHERE arrival IS NULL) AS r WHERE r.id = inbox_item.id`,
      base,
    );
  return given;
}

/**
 * The next arrival number: one more than the newest item the Inbox has filed. Until the backfill has run, the items rc.26 left (no number) are numbered first, in the order they were filed, so a new item
 * is always newer than them and a number is never handed out twice.
 */
export function nextArrival(ctx: Pick<InboxCtx, "db">): number {
  if (!finished(ctx)) numberLegacy(ctx, true);
  const row = first(ctx.db.all(`SELECT COALESCE(MAX(arrival), 0) AS n FROM inbox_item`));
  return num(row, "n") + 1;
}

/** Two conversations became one (a match folded the sender's into the contact's): each person's flags are merged and the survivor recounted. */
export async function noteMerge(ctx: InboxCtx, from: string, to: string): Promise<void> {
  try {
    (await seamFor(ctx)).merge(thingOf(from), thingOf(to));
  } catch (e) {
    ctx.log.warn("inbox: per-person state was not merged", { code: codeOf(e) || (e as Error).message });
  }
}

/** An Undo gave a conversation its items back: what each person had read carries onto it, and both are recounted. */
export async function noteSplit(ctx: InboxCtx, survivor: string, revived: string): Promise<void> {
  try {
    (await seamFor(ctx)).split(thingOf(survivor), thingOf(revived));
  } catch (e) {
    ctx.log.warn("inbox: per-person state was not split", { code: codeOf(e) || (e as Error).message });
  }
}

/** An erase removed items: a conversation that is gone takes its state with it, one that remains is recounted. */
export async function noteErased(ctx: InboxCtx, id: string, gone: boolean): Promise<void> {
  try {
    const store = await seamFor(ctx);
    if (gone) store.forget(thingOf(id));
    else store.retract(thingOf(id));
  } catch (e) {
    ctx.log.warn("inbox: per-person state was not recounted after an erase", {
      code: codeOf(e) || (e as Error).message,
    });
  }
}

/** A conversation row as the caller reads it: its unread count is theirs (their place in it), not a count the whole Space shares. `states`: the caller's state on many conversations, read once for a page. */
export function withUnread(ctx: InboxCtx, out: ConversationRow, states?: Map<string, ThingState>): ConversationRow {
  const mine = states?.get(out.id) ?? readSeam(ctx).stateOf(subjectOf(ctx), [thingOf(out.id)])[0];
  return { ...out, unreadCount: mine?.unread ?? 0 };
}

/** The conversations the caller has not marked done, and the caller's state on all of them. A list of Open shows only these; Done is a list of its own (state.list). */
export async function openOnly<T extends { row: Row }>(
  ctx: InboxCtx,
  found: readonly T[],
): Promise<{ open: T[]; states: Map<string, ThingState> }> {
  const states = await stateOfMany(
    ctx,
    found.map(({ row }) => str(row, "id")),
  );
  return { open: found.filter(({ row }) => states.get(str(row, "id"))?.done == null), states };
}
