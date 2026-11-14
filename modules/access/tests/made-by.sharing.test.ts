// "Made for me" and the person's control of it (owner, 14 Nov 2026): what an agent made for a person is the person's, and the person sees who can use it and can end it. The maker's reach is listed in the thing's
// sharing list as a row of its own ("made this for you", with its level) without a grant being written; removing that row, like any share, clears the stamp at once and the agent is refused like any other agent;
// a second person with Manage on the thing may remove it, one without may not; and an explicit share to the same agent on the same thing is one row, not two, and removing it ends the reach too.
import test from "node:test";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { LogEvent } from "../consumers.ts";
import { madeRowId, share, sharesOf, unshare } from "../handlers/share.ts";
import { fnv } from "../projections.ts";
import { NOW, SPACE, ctxOf as ctxBase, fresh, fromTables, sync } from "../fixtures/incremental.ts";

/** Ana by default: she owns the Space and the thing. */
const ctxOf = (db: Parameters<typeof ctxBase>[0], who = "usr_ana") => ctxBase(db, who);

const person = (seq: number, id: string): LogEvent => ({
  seq,
  type: "principal.created",
  payload: { id, kind: "person", name: id.slice(4), status: "active" },
});
const log = (): LogEvent[] => [
  {
    seq: 1,
    type: "resource.created",
    payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_ana", holds: 0 },
  },
  person(2, "usr_ana"),
  person(3, "usr_ben"),
  person(4, "usr_cara"),
  { seq: 5, type: "principal.role_set", payload: { holder: "usr_ana", role: "rol_owner" } },
  { seq: 6, type: "principal.role_set", payload: { holder: "usr_ben", role: "rol_member" } },
  { seq: 7, type: "principal.role_set", payload: { holder: "usr_cara", role: "rol_member" } },
  { seq: 8, type: "principal.created", payload: { id: "agt_dex", kind: "agent", name: "Dex", status: "active" } },
  { seq: 9, type: "principal.role_set", payload: { holder: "agt_dex", role: "rol_member" } },
  // a thing in Ana's private root, made for her by Dex: only the made-by reach (and an explicit share) gets the agent in
  {
    seq: 10,
    type: "resource.created",
    payload: {
      id: "sit_1",
      type: "site",
      parent_id: null,
      label: 0,
      owner_id: "usr_ana",
      holds: 0,
      made_by: "agt_dex",
      made_for: "usr_ana",
    },
  },
];
const agentMay = (snap: ReturnType<typeof sync>): boolean =>
  authorize(snap, {
    principal: "agt_dex",
    actingFor: "usr_ana",
    action: { perm: null, level: "edit" },
    resource: { type: "site", id: "sit_1" },
    cap: "sites.update",
    now: NOW,
  }).effect === "allow";
const SITE = { type: "site", id: "sit_1" } as const;
const rows = async (db: ReturnType<typeof fresh>["db"], who = "usr_ana") =>
  (await sharesOf(ctxOf(db, who), { resource: SITE })).shares.filter((s) => s.grant.subject.id === "agt_dex");

test("the maker's reach is a row in the sharing list, writes no grant, and removing it ends it at once, also after a restart", async () => {
  const { db } = fresh("made-row");
  let snap = sync(ctxOf(db), { events: log() });
  assert.ok(agentMay(snap), "the agent can use what it made");
  const before = await rows(db);
  assert.equal(before.length, 1, "listed once");
  assert.match(before[0]!.grant.id, /^gnt_made[a-z0-9]+$/, "an id the contract accepts");
  const madeId = before[0]!.grant.id;
  assert.equal(before[0]!.grant.source, "made_by");
  assert.equal(before[0]!.grant.level, "edit", "with its level");
  assert.equal(before[0]!.grant.by, "usr_ana");
  assert.equal(snap.grantsOn("sit_1")?.length ?? 0, 0, "and no grant exists");
  const emitted: string[] = [];
  const ctx = { ...ctxOf(db), emit: (type: string) => void emitted.push(type) } as ReturnType<typeof ctxOf>;
  const out = await unshare(ctx, { grantId: madeId });
  assert.equal(out.revoked, 1);
  assert.ok(emitted.includes("grant.revoked"), "an event carries it, so a restart or another computer does the same");
  assert.equal((await rows(db)).length, 0, "gone from the list");
  snap = fromTables(ctxOf(db));
  assert.ok(!agentMay(snap), "the agent is refused like any other agent");
  assert.equal(snap.resource("sit_1")?.made_by, undefined);
  // replaying the event over the log (a restart, another computer) does the same and is idempotent
  const replay: LogEvent = {
    seq: 11,
    type: "grant.revoked",
    payload: { grantId: madeId, resource: SITE, subject: { kind: "agent", id: "agt_dex" }, reason: "unshared" },
  };
  sync(ctxOf(db), { events: [replay] });
  sync(ctxOf(db), { events: [replay] });
  assert.ok(!agentMay(fromTables(ctxOf(db))));
  await assert.rejects(
    unshare(ctxOf(db), { grantId: madeId }),
    "it does not come back by itself; there is nothing left to remove",
  );
  // it comes back only when the person shares it again
  await share(ctxOf(db), { resource: SITE, subject: { kind: "agent", id: "agt_dex" }, level: "edit" });
  assert.ok(agentMay(fromTables(ctxOf(db))), "shared again on purpose");
});

test("who may remove it: a second person with Manage on the thing can, one without cannot", async () => {
  const { db } = fresh("made-who");
  sync(ctxOf(db), { events: log() });
  const madeId = (await rows(db))[0]!.grant.id;
  await share(ctxOf(db), { resource: SITE, subject: { kind: "person", id: "usr_ben" }, level: "manage" });
  await assert.rejects(unshare(ctxOf(db, "usr_cara"), { grantId: madeId }), "Cara has nothing on it");
  assert.ok(agentMay(fromTables(ctxOf(db))), "and nothing changed");
  assert.equal((await unshare(ctxOf(db, "usr_ben"), { grantId: madeId })).revoked, 1, "Ben holds Manage");
  assert.ok(!agentMay(fromTables(ctxOf(db))));
});

test("an explicit share to the same agent on the same thing is one row, not two, and removing it ends the made-by reach too", async () => {
  const { db } = fresh("made-one");
  sync(ctxOf(db), { events: log() });
  await share(ctxOf(db), { resource: SITE, subject: { kind: "agent", id: "agt_dex" }, level: "edit" });
  const listed = await rows(db);
  assert.equal(listed.length, 1, "one row");
  assert.notEqual(listed[0]!.grant.source, "made_by", "the explicit share is the row");
  await unshare(ctxOf(db), { grantId: listed[0]!.grant.id });
  assert.equal((await rows(db)).length, 0, "no second row appears");
  assert.ok(!agentMay(fromTables(ctxOf(db))), "the person removed the agent: no reach is left");
  // by the agent named on the thing
  const again = fresh("made-one-b");
  sync(ctxOf(again.db), { events: log() });
  assert.equal(
    (await unshare(ctxOf(again.db), { resource: SITE, subject: { kind: "agent", id: "agt_dex" } })).revoked,
    1,
  );
  assert.ok(!agentMay(fromTables(ctxOf(again.db))));
});

test("only kinds that the made-for reach covers are listed: a Vault item the agent stamped is not", async () => {
  const { db } = fresh("made-vault");
  const events = log();
  events.push({
    seq: 11,
    type: "resource.created",
    payload: {
      id: "vit_1",
      type: "vault_item",
      parent_id: null,
      label: 0,
      owner_id: "usr_ana",
      holds: 0,
      made_by: "agt_dex",
      made_for: "usr_ana",
    },
  });
  sync(ctxOf(db), { events });
  const l = await sharesOf(ctxOf(db), { resource: { type: "vault_item", id: "vit_1" } });
  assert.equal(l.shares.filter((s) => s.grant.subject.id === "agt_dex").length, 0);
});

const stamped = (seq: number, id: string, o: Record<string, unknown> = {}): LogEvent => ({
  seq,
  type: "resource.created",
  payload: {
    id,
    type: "site",
    parent_id: null,
    label: 0,
    owner_id: "usr_ana",
    holds: 0,
    made_by: "agt_dex",
    made_for: "usr_ana",
    ...o,
  },
});
const listsAgent = async (
  db: ReturnType<typeof fresh>["db"],
  id: string,
  agent: string,
  who = "usr_ana",
): Promise<boolean> =>
  (await sharesOf(ctxOf(db, who), { resource: { type: "site", id } })).shares.some((x) => x.grant.subject.id === agent);

test("replaying the removal from the log (a restart, another computer) clears the stamp with no handler call, from the tables too", () => {
  const { db } = fresh("made-replay");
  let snap = sync(ctxOf(db), { events: log() });
  assert.ok(agentMay(snap));
  const revoke: LogEvent = {
    seq: 11,
    type: "grant.revoked",
    payload: {
      grantId: madeRowId("sit_1"),
      subject: { kind: "agent", id: "agt_dex" },
      resource: SITE,
      reason: "unshared",
    },
  };
  snap = sync(ctxOf(db), { events: [revoke] });
  assert.ok(!agentMay(snap), "folded from the event alone");
  assert.equal(snap.resource("sit_1")?.made_by, undefined);
  assert.ok(!agentMay(fromTables(ctxOf(db))), "and the same after a rebuild from the tables");
  // a revoke that names another thing clears only that thing
  const other = fresh("made-replay-2");
  sync(ctxOf(other.db), { events: [...log(), stamped(11, "sit_2")] });
  sync(ctxOf(other.db), {
    events: [
      {
        seq: 12,
        type: "grant.revoked",
        payload: {
          grantId: madeRowId("sit_2"),
          subject: { kind: "agent", id: "agt_dex" },
          resource: { type: "site", id: "sit_2" },
          reason: "unshared",
        },
      },
    ],
  });
  assert.ok(agentMay(fromTables(ctxOf(other.db))), "sit_1 keeps its maker");
  assert.equal(fromTables(ctxOf(other.db)).resource("sit_2")?.made_by, undefined);
});

test("the row is listed only when it is real: not for a hidden agent, not when made for someone who is not the owner, not for an agent that does not exist", async () => {
  const { db } = fresh("made-real");
  const events = [
    ...log(),
    // a person's private agent (an Assistant) is named to no one but its person: its name must not leak through a sharing list
    {
      seq: 11,
      type: "principal.created",
      payload: { id: "agt_priv", kind: "agent", name: "Ben's Assistant", status: "active", owner: "usr_ben" },
    } as LogEvent,
    {
      seq: 12,
      type: "agent.privacy_set",
      payload: { agentId: "agt_priv", private: true, assistant: true },
    } as LogEvent,
    stamped(13, "sit_hidden", { made_by: "agt_priv" }),
    stamped(14, "sit_handed", { made_for: "usr_ben" }),
    stamped(15, "sit_ghost", { made_by: "agt_ghost" }),
  ];
  sync(ctxOf(db), { events });
  assert.equal(await listsAgent(db, "sit_1", "agt_dex"), true, "the real one is listed");
  assert.equal(await listsAgent(db, "sit_hidden", "agt_priv"), false, "a private agent's name does not appear to Ana");
  assert.equal(await listsAgent(db, "sit_handed", "agt_dex"), false, "made for someone who no longer owns it");
  assert.equal(await listsAgent(db, "sit_ghost", "agt_ghost"), false, "an agent that is not a principal");
});

test("two things whose ids collide in a 32-bit hash have two rows and two removals: the row's id names exactly one thing", async () => {
  // find two thing ids with the same 32-bit hash (a birthday search, a few tens of thousands of tries)
  const seen = new Map<string, string>();
  let pair: [string, string] | null = null;
  for (let i = 0; i < 600_000 && !pair; i++) {
    const id = `sit_${randomBytes(6).toString("hex")}`;
    const h = fnv(id);
    const have = seen.get(h);
    if (have !== undefined) pair = [have, id];
    else seen.set(h, id);
  }
  assert.ok(pair, "found a pair that collides");
  const [a, b] = pair!;
  assert.equal(fnv(a), fnv(b));
  assert.notEqual(madeRowId(a), madeRowId(b), "the row ids differ anyway");
  const { db } = fresh("made-collide");
  sync(ctxOf(db), { events: [...log(), stamped(11, a), stamped(12, b)] });
  assert.equal((await unshare(ctxOf(db), { grantId: madeRowId(a) })).revoked, 1);
  const snap = fromTables(ctxOf(db));
  assert.equal(snap.resource(a)?.made_by, undefined, "the one named is cleared");
  assert.equal(snap.resource(b)?.made_by, "agt_dex", "the other keeps its maker");
  await assert.rejects(unshare(ctxOf(db), { grantId: "gnt_made" + "zz" }), "an id that names no thing");
  assert.equal((await unshare(ctxOf(db), { grantId: madeRowId(b) })).revoked, 1);
});
