// state (contract P2, 13 Nov 2026): what one person has done with one thing, kept apart from the thing. Read (a position, not a flag), done (one state: Done in the Inbox is Archive in Chats), star,
// follow, mute. One row per person and thing; two people never share one, so one person's read can never clear another's.
// DECISION: a thing is `{ type, id }` with an open type, not a resourceRef: the things that carry state (an Inbox conversation, a notice) are not access resources, and each kind of thing says who can see it (the module's `audience`).
// DECISION (lead's review, 13 Nov): every state event is `vis: private`: only the person it is about, the one who made it, and (for the host's own changes, such as a mute ending) the person it is made on behalf of ever read it; the Space owner does not.
// DECISION: every call works on `actingFor ?? principal`. Reading is always allowed; an agent acting for a person changes that person's state only while the person's setting `state.agents_may_triage` is on (default off).
// DECISION: the seven internal calls (arrive, retract, merge, gain, lose, forget, verify) are the host's own: a module reaches them through the seam in host/src/seams/state.ts, in one transaction with the rows they move.
import { defineManifest, ev, read, setting, t, write } from "../packages/contracts/src/index.ts";
import type { CapOpts } from "../packages/contracts/src/index.ts";

const thing = t.obj({ type: t.str({ examples: ["conversation"] }), id: t.str({ examples: ["cnv_a1b2c3"] }) });
const scope = t.str({
  examples: ["mailbox:mbx_a1b2c3"],
  description: "A badge: `mailbox:<id>`, `number:<id>`, `chats`, `threads` or `notices:<place>`",
});
const follow = t.enm("following", "left");
const flag = t.enm("read", "done", "star", "follow", "mute", "pin");
const stateRow = t.obj({
  thing,
  readUpto: t.int({ minimum: 0, description: "The newest entry I have read" }),
  unread: t.int({
    minimum: 0,
    description: "Entries after that which someone else wrote; 0 for a thing I have lost access to",
  }),
  done: t.nullable(t.ts({ description: "When I marked it done (Archive in Chats); null when it is open" })),
  starred: t.nullable(t.ts()),
  follow: t.nullable(follow),
  alert: t.bool({ description: "Alert me on replies" }),
  muted: t.nullable(t.ts({ description: "Muted until this time; a very large value means for good" })),
  pin: t.nullable(
    t.num({ description: "Where my pin sits among my pins of this kind of thing (smaller is higher); null when not pinned" }),
  ),
});
const count = t.obj({ scope, things: t.int({ minimum: 0 }), entries: t.int({ minimum: 0 }) });
const layoutValue = t.obj({
  key: t.str({ examples: ["chats.sidebar.folds"] }),
  value: t.json(),
  version: t.int({ minimum: 0 }),
  at: t.ts(),
});
const listRow = t.obj({
  thing,
  title: t.str(),
  at: t.ts({ description: "When it was starred, done, or last had an entry, by the filter" }),
  unread: t.int({ minimum: 0 }),
  state: stateRow,
});
const problem = t.obj({
  kind: t.enm("head", "unread", "count"),
  detail: t.str(),
  person: t.opt(t.str()),
  thing: t.opt(thing),
  scope: t.opt(t.str()),
});

const V = { level: "member" } as const;
/** The host's own: no tool, no screen, and the handler refuses anyone but the server. */
const INTERNAL: CapOpts = { ...V, risk: "low", audit: "none", offline: "online", errors: ["permission.no_grant"] };

export default defineManifest({
  id: "state",
  title: "State",
  owner: "L7a",

  events: [
    ev(
      "state.changed",
      "One person's state on one thing changed (read, done, star, follow, mute or pin): the event carries the new state of that thing and the badge it counts in, so a screen patches its row without asking again",
      {
        p: {
          person: t.str(),
          thing,
          changed: t.arr(flag),
          now: t.ts(),
          by: t.str({
            description: "Who did it: the person, or the agent that acted for them; the host for a mute that ended",
          }),
          state: stateRow,
          count,
        },
        subject: ["entity", "/thing/id"],
        vis: "private",
      },
    ),
    ev("state.scope_read", "A person marked everything in one badge read: one event for the whole badge, with its new count", {
      p: { person: t.str(), scope, marked: t.int({ minimum: 0 }), count, now: t.ts(), by: t.str() },
      subject: ["entity", "/scope"],
      vis: "private",
    }),
    ev(
      "state.layout_changed",
      "A person's layout value changed (how they arranged a screen): their other devices take the new value",
      {
        p: { person: t.str(), key: t.str(), value: t.json(), version: t.int({ minimum: 0 }), now: t.ts(), by: t.str() },
        subject: ["entity", "/key"],
        vis: "private",
      },
    ),
  ],

  capabilities: [
    read("state.get", "My state on up to 500 things: how far I read, unread, done, starred, followed, muted", {
      ...V,
      in: { things: t.arr(thing, { minItems: 1, maxItems: 500 }) },
      out: { states: t.arr(stateRow) },
      tool: "meta",
      deferred: true,
    }),
    read("state.list", "My things by what I did with them: starred, following, done, unread, muted, pinned (in my own order) or any (everything I have set on anything: one read paints a whole screen). Each row carries the thing's whole state", {
      ...V,
      in: {
        flag: t.enm("starred", "following", "done", "unread", "muted", "pinned", "any"),
        type: t.opt(t.str()),
        scope: t.opt(scope),
        cursor: t.opt(t.str()),
        limit: t.opt(t.int({ minimum: 1, maximum: 500 })),
      },
      out: {
        rows: t.arr(listRow),
        next: t.opt(t.str({ description: "Cursor for the next page; absent on the last page" })),
      },
      tool: "meta",
      deferred: true,
    }),
    read(
      "state.counts",
      "My badges: for each scope how many things have something unread (not done, not muted) and how many entries that is",
      {
        ...V,
        in: { scopes: t.opt(t.arr(scope)) },
        out: { counts: t.arr(t.obj({ scope, things: t.int({ minimum: 0 }), entries: t.int({ minimum: 0 }) })) },
        tool: "meta",
        deferred: true,
      },
    ),
    write(
      "state.read",
      "Mark a thing read up to a position, mark it unread, or mark it unread from a position. Give exactly one of upto, unread, fromPos",
      {
        ...V,
        in: {
          thing,
          upto: t.opt(t.int({ minimum: 0 })),
          unread: t.opt(t.lit(true)),
          fromPos: t.opt(t.int({ minimum: 1 })),
        },
        out: { unread: t.int({ minimum: 0 }) },
        emits: ["state.changed"],
        offline: "queue",
        idem: "natural",
        tool: "meta",
        deferred: true,
        errors: ["validation.not_found", "permission.no_grant"],
      },
    ),
    write("state.read_scope", "Mark everything in one badge read, or only what arrived before a time", {
      ...V,
      in: { scope, before: t.opt(t.ts()) },
      out: { marked: t.int({ minimum: 0 }) },
      emits: ["state.scope_read"],
      offline: "queue",
      idem: "natural",
      tool: "meta",
      deferred: true,
      errors: ["permission.no_grant"],
    }),
    write(
      "state.set",
      "Mark a thing done or open again, star it, follow or leave it, set Alert me on replies, mute it, or pin it (`pin: {}` puts it last among my pins of this kind, `{ after: null }` first, `{ after: thing }` right below that pin; `pin: null` takes it off). Give at least one",
      {
        ...V,
        in: {
          thing,
          done: t.opt(t.bool()),
          star: t.opt(t.bool()),
          follow: t.opt(t.nullable(follow)),
          alert: t.opt(t.bool()),
          mute: t.opt(t.nullable(t.obj({ until: t.ts() }))),
          pin: t.opt(t.nullable(t.obj({ after: t.opt(t.nullable(thing)) }))),
        },
        out: { state: stateRow },
        emits: ["state.changed"],
        offline: "queue",
        idem: "natural",
        tool: "meta",
        deferred: true,
        errors: ["validation.not_found", "permission.no_grant"],
      },
    ),

    read(
      "state.layout.get",
      "How I arranged my screens: my layout values (all, or the named keys). A small value for each registered key, mine alone",
      {
        ...V,
        in: { keys: t.opt(t.arr(t.str())) },
        out: { values: t.arr(layoutValue) },
        tool: "meta",
        deferred: true,
      },
    ),
    write(
      "state.layout.set",
      "Set one layout value, or clear it with null. Only registered keys, each with a small size limit; it is never a place for content",
      {
        ...V,
        in: { key: t.str({ examples: ["chats.sidebar.folds"] }), value: t.json() },
        out: { value: layoutValue },
        emits: ["state.layout_changed"],
        offline: "queue",
        idem: "natural",
        tool: "meta",
        deferred: true,
        errors: ["permission.no_grant", "validation.bad_input"],
      },
    ),

    // the host's own halves: what a module's seam does, as calls, for the host and the tests
    write(
      "state.arrive",
      "Host only: a new entry reached a thing; raise its head and every audience member's unread, in one transaction. Idempotent on position",
      {
        ...INTERNAL,
        in: { thing, pos: t.int({ minimum: 1 }), by: t.nullable(t.str()), at: t.ts(), mentions: t.opt(t.arr(t.str())) },
        out: { applied: t.bool(), people: t.int({ minimum: 0 }) },
      },
    ),
    write("state.retract", "Host only: an entry was removed from a thing; recount every row of it from its entries", {
      ...INTERNAL,
      in: { thing },
      out: { ok: t.bool() },
    }),
    write("state.merge", "Host only: one thing became part of another; merge each person's flags and recount", {
      ...INTERNAL,
      in: { from: thing, to: thing },
      out: { ok: t.bool() },
    }),
    write(
      "state.gain",
      "Host only: a person gets access to a scope; they start with nothing unread and keep the flags they had",
      {
        ...INTERNAL,
        in: { person: t.str(), scope },
        out: { rows: t.int({ minimum: 0 }) },
      },
    ),
    write(
      "state.lose",
      "Host only: a person loses access to a scope; its rows leave their lists and badge, done and star are kept",
      {
        ...INTERNAL,
        in: { person: t.str(), scope },
        out: { rows: t.int({ minimum: 0 }) },
      },
    ),
    write("state.forget", "Host only: a thing was deleted; every row and count of it goes", {
      ...INTERNAL,
      in: { thing },
      out: { ok: t.bool() },
    }),
    write(
      "state.verify",
      "Host only: compare every head, unread and badge with the entries and the rows; with repair, fix what differs. Runs at module start and in the doctor",
      {
        ...INTERNAL,
        in: { person: t.opt(t.str()), scope: t.opt(scope), repair: t.opt(t.bool()), deep: t.opt(t.bool()) },
        out: { problems: t.arr(problem), repaired: t.int({ minimum: 0 }) },
      },
    ),
  ],

  settings: [
    setting(
      "state.agents_may_triage",
      "person",
      "Chats",
      "Let my assistant mark things read, done, starred, followed or muted for me",
      t.bool(),
      false,
    ),
  ],
});
