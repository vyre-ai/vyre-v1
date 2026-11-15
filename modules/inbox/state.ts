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

/** People the Inbox knows from its own rows, for when the Space's list cannot be read: owners and followers of conversations. */
function knownPeople(db: RawDb): string[] {
  return [
    ...new Set(
      [
        ...rowsOf(
          db.all(
            `SELECT DISTINCT "ownerId" AS p FROM inbox_conversation WHERE "ownerId" IS NOT NULL AND deleted_at IS NULL`,
          ),
        ),
        ...rowsOf(db.all(`SELECT DISTINCT "principalId" AS p FROM inbox_follow WHERE deleted_at IS NULL`)),
      ].map((r) => str(r, "p")),
    ),
  ];
}

/** What the seam's kind needs for this call. `people` is read only for a call that decides who an entry reaches: the Space's list, else the people the Inbox knows from its own rows. */
export async function envOf(ctx: InboxCtx, o: { people?: boolean } = {}): Promise<StateEnv> {
  const env = await stateEnvOf(ctx);
  let people: readonly string[] = [];
  if (o.people) {
    people = await peopleOf(ctx);
    if (people.length === 0) people = knownPeople(rawOf(ctx));
  }
  return { ...env, people };
}

/** The seam for a handler. */
export async function seamFor(ctx: InboxCtx, o: { people?: boolean } = {}): Promise<StateStore> {
  return stateSeamOf(ctx.db, ctx.now, await envOf(ctx, o));
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
  try {
    (await seamFor(ctx, { people: true })).arrive(thingOf(a.conversationId), { pos: a.arrival, by: null, at: a.at });
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

/** The next arrival number: one more than the newest item the Inbox has filed. */
export function nextArrival(ctx: Pick<InboxCtx, "db">): number {
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
