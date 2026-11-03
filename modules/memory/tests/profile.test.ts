// The person profile (owner ruling 3 Nov): public and private parts, one per person, read by all their agents; the private part only where nobody but the person reads the chat.
import test from "node:test";
import assert from "node:assert/strict";
import { profileAdd, profileContext, profileGet, profileMove, profileSuggest } from "../handlers/profile.ts";
import { erase, factCorrect, factsRemove } from "../handlers/facts.ts";
import { restore } from "../handlers/lifecycle.ts";
import { asPerson, harness, seedFact } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const DANA = "usr_dana", MAYA = "usr_maya", INTAKE = "agt_intake", BILLING = "agt_billing";
const PRIVATE = "Dana is going through IVF and leaves early on Thursdays.";
const PUBLIC = "Dana wants client emails short, with no exclamation marks.";

type Respond = Record<string, (b: Record<string, unknown>) => unknown>;
const chat = (persons: string[], extra: Record<string, unknown> = {}): Respond => ({
  "threads.get": () => ({ thread: { kind: "chat", starter: persons[0], members: persons.map((id) => ({ kind: "person", id })), ...extra } }),
});
const channel = (persons: string[], visibility = "public"): Respond => ({
  "threads.get": () => ({ thread: { kind: "channel", channelId: "chn_team", starter: persons[0], members: persons.map((id) => ({ kind: "person", id })) } }),
  "channels.get": () => ({ channel: { visibility, members: persons.map((id) => ({ kind: "person", id })) } }),
});
const commentAsk: Respond = { "threads.get": () => ({ thread: { kind: "ask", starter: DANA, recordId: "rec_harlow", scopeType: "record", scopeId: "rec_harlow", members: [{ kind: "person", id: DANA }] } }) };
const recordAskPane: Respond = { "threads.get": () => ({ thread: { kind: "ask", starter: DANA, scopeType: "record", scopeId: "rec_harlow", members: [{ kind: "person", id: DANA }] } }) };

/** Dana's profile: one private fact learned by Intake, one public fact learned by Billing. */
function seeded(respond?: Respond, principal?: { kind: "person" | "agent"; id: string }): Harness {
  const h = harness({ ...(respond ? { respond } : {}), ...(principal ? { principal, actingFor: DANA } : {}), settings: { "profile.timezone": "America/Chicago", "profile.working_hours": { days: [1, 2, 3, 4, 5], from: "08:00", to: "16:00" } } });
  seedFact(h, { id: "fct_priv", layer: "person", agentId: INTAKE, kind: "profile", text: PRIVATE });
  seedFact(h, { id: "fct_pub", layer: "person", agentId: BILLING, kind: "preference", text: PUBLIC });
  return h;
}
async function publish(h: Harness, factId: string): Promise<void> {
  const dana = asPerson(h, { kind: "person", id: DANA });
  await profileMove(dana.ctx, { factId, to: "public" });
}
const text = (o: unknown): string => JSON.stringify(o);

test("in a chat only Dana reads, the context holds both parts, whichever agent learned them", async () => {
  const h = seeded(chat([DANA]));
  await publish(h, "fct_pub");
  const out = await profileContext(h.ctx, { threadId: "thr_mine" });
  assert.equal(out.audience, "private");
  const me = out.people[0]!;
  assert.equal(me.self, true);
  assert.ok(me.private.some((l) => l.includes(PRIVATE)), "learned by Intake");
  assert.ok(me.public.some((l) => l.includes(PUBLIC)), "learned by Billing");
  assert.ok(me.basics.includes("Time zone: America/Chicago"));
  assert.ok(me.basics.includes("Working hours: Mon, Tue, Wed, Thu, Fri 08:00 to 16:00"));
});

for (const [name, respond] of [
  ["a public channel", channel([DANA, MAYA])],
  ["an invite-only channel with Maya", channel([DANA, MAYA], "invite")],
  ["a group chat with Maya (the Assistant answering there)", chat([DANA, MAYA])],
  ["a record comment's Ask, whose answer posts on the record", commentAsk],
  ["a chat that cannot be read", { "threads.get": () => { throw new Error("gone"); } }],
] as Array<[string, Respond]>) {
  test(`in ${name}, the private part is never loaded and the public part is`, async () => {
    const h = seeded(respond);
    await publish(h, "fct_pub");
    const out = await profileContext(h.ctx, { threadId: "thr_shared" });
    assert.equal(out.audience, "shared");
    assert.ok(!text(out).includes(PRIVATE), text(out));
    assert.ok(text(out).includes(PUBLIC), text(out));
    // and an agent working for Dana there, reading the profile itself, gets the same
    const agent = seeded(respond, { kind: "agent", id: BILLING });
    await publish(agent, "fct_pub");
    const got = await profileGet({ ...agent.ctx, thread: "thr_shared" }, {});
    assert.equal(got.audience, "shared");
    assert.ok(!text(got).includes(PRIVATE));
    assert.ok(text(got).includes(PUBLIC));
  });
}

test("Dana's own Ask pane on a record is private to her: both parts load", async () => {
  const h = seeded(recordAskPane);
  const out = await profileContext(h.ctx, { threadId: "thr_ask" });
  assert.equal(out.audience, "private");
  assert.ok(text(out).includes(PRIVATE));
});

test("a fact learned by Intake is used by Billing for the same person", async () => {
  const h = seeded(chat([DANA]), { kind: "agent", id: BILLING });
  const got = await profileGet({ ...h.ctx, thread: "thr_billing" }, {});
  assert.equal(got.audience, "private");
  const p = got.private.find((f) => f.factId === "fct_priv");
  assert.ok(p, text(got));
  assert.equal(p.agentId, INTAKE, "it keeps who learned it");
  // an agent with no chat to answer into gets the public part only
  assert.equal((await profileGet(h.ctx, {})).private.length, 0);
});

test("in a channel, the other people's public profile comes with the asker's, never their private one", async () => {
  const h = seeded(channel([DANA, MAYA]));
  await publish(h, "fct_pub");
  seedFact(h, { id: "fct_maya_priv", layer: "person", owner: MAYA, text: "Maya is interviewing at another firm." });
  seedFact(h, { id: "fct_maya_pub", layer: "person", owner: MAYA, text: "Maya runs the Harlow matter." });
  await profileMove(asPerson(h, { kind: "person", id: MAYA }).ctx, { factId: "fct_maya_pub", to: "public" });
  const out = await profileContext(h.ctx, { threadId: "thr_team" });
  assert.ok(text(out).includes("Maya runs the Harlow matter."));
  assert.ok(!text(out).includes("interviewing"));
  // Maya's own page is hers: Dana asking for it gets the public part only
  const seen = await profileGet(h.ctx, { personId: MAYA });
  assert.deepEqual(seen.public.map((f) => f.factId), ["fct_maya_pub"]);
  assert.deepEqual(seen.private, []);
});

test("moving a fact between the parts, both ways; the words stay, only the place changes", async () => {
  const h = seeded();
  const before = await profileGet(h.ctx, {});
  assert.deepEqual(before.public.map((f) => f.factId), []);
  assert.deepEqual(before.private.map((f) => f.factId).sort(), ["fct_priv", "fct_pub"]);
  await profileMove(h.ctx, { factId: "fct_pub", to: "public" });
  const row = h.rows("SELECT text, sealed, enc, profile FROM memory_facts WHERE id = 'fct_pub'")[0]!;
  assert.equal(row["text"], PUBLIC);
  assert.equal(row["enc"], 0);
  assert.equal(row["profile"], "public");
  const mid = await profileGet(h.ctx, {});
  assert.deepEqual(mid.public.map((f) => f.factId), ["fct_pub"]);
  assert.equal(mid.public[0]!.place, "public");
  await profileMove(h.ctx, { factId: "fct_pub", to: "private" });
  const back = h.rows("SELECT text, sealed, enc, profile FROM memory_facts WHERE id = 'fct_pub'")[0]!;
  assert.equal(back["text"], "", "sealed again: the database holds no words");
  assert.equal(back["enc"], 2);
  assert.equal(back["profile"], null);
  assert.deepEqual((await profileGet(h.ctx, {})).public, []);
  // the trail says where it went, never the words
  const trail = h.rows("SELECT reason FROM memory_trail WHERE fact_id = 'fct_pub' ORDER BY at, rowid").map((r) => String(r["reason"]));
  assert.deepEqual(trail, ["moved to the public profile", "moved to the private profile"]);
});

test("an agent cannot make a fact public; it suggests, and the fact stays private until Dana says yes", async () => {
  const h = seeded(chat([DANA]), { kind: "agent", id: INTAKE });
  await assert.rejects(profileMove(h.ctx, { factId: "fct_pub", to: "public" }), /Only you can put a fact on your public profile/);
  const s = await profileSuggest(h.ctx, { factId: "fct_pub" });
  assert.equal(s.fact.place, "private");
  assert.equal(s.fact.suggested, true);
  const inChannel = seeded(channel([DANA, MAYA]));
  assert.ok(!text(await profileContext(inChannel.ctx, { threadId: "thr_team" })).includes(PUBLIC), "a suggestion is not public");
  // a new fact suggested with its words is remembered privately first
  const made = await profileSuggest({ ...h.ctx, thread: "thr_mine" }, { text: "Dana leads the intake team.", threadId: "thr_mine" });
  assert.equal(made.fact.place, "private");
  assert.equal(made.fact.suggested, true);
  // Dana says yes
  await publish(h, "fct_pub");
  const after = await profileGet(asPerson(h, { kind: "person", id: DANA }).ctx, {});
  assert.equal(after.public.find((f) => f.factId === "fct_pub")?.suggested, undefined);
});

test("someone else cannot move Dana's facts", async () => {
  const h = seeded();
  const maya = asPerson(h, { kind: "person", id: MAYA });
  await assert.rejects(profileMove(maya.ctx, { factId: "fct_priv", to: "public" }), /Only facts about you/);
});

test("a fact added by hand lands where Dana puts it; an edit keeps a public fact public", async () => {
  const h = seeded();
  const added = await profileAdd(h.ctx, { text: "Dana is the Director of Intake.", to: "public" });
  assert.equal(added.fact.place, "public");
  const priv = await profileAdd(h.ctx, { text: "Dana's daughter starts school in May.", to: "private" });
  assert.equal(priv.fact.place, "private");
  const fixed = await factCorrect(h.ctx, { factId: added.fact.factId, text: "Dana is the Director of Intake and Billing." });
  const now = await profileGet(h.ctx, {});
  assert.deepEqual(now.public.map((f) => f.text), ["Dana is the Director of Intake and Billing."]);
  assert.equal(now.public[0]!.factId, fixed.fact.factId);
});

test("Forget takes a fact off the profile and Undo brings it back", async () => {
  const h = seeded();
  await profileMove(h.ctx, { factId: "fct_pub", to: "public" });
  await factsRemove(h.ctx, { factIds: ["fct_pub"] });
  assert.deepEqual((await profileGet(h.ctx, {})).public, []);
  assert.equal(h.rows("SELECT status FROM memory_facts WHERE id = 'fct_pub'")[0]!["status"], "removed", "kept in history");
  await restore(h.ctx, { factId: "fct_pub" });
  assert.deepEqual((await profileGet(h.ctx, {})).public.map((f) => f.factId), ["fct_pub"]);
});

test("Erase completely removes the fact, every earlier version and where recall quoted it; the trail keeps only that it happened", async () => {
  const h = seeded();
  const v2 = await factCorrect(h.ctx, { factId: "fct_priv", text: "Dana leaves early on Thursdays." });
  h.db.run("INSERT INTO memory_pointer_log (thread_id, ref, at) VALUES ('thr_x', 'fct_priv', 1)");
  h.db.run("CREATE TABLE IF NOT EXISTS memory_recall_log (thread_id TEXT NOT NULL, message_id TEXT NOT NULL, agent_id TEXT, asker TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, PRIMARY KEY (thread_id, message_id, kind, ref))");
  h.db.run("INSERT INTO memory_recall_log VALUES ('thr_x', 'msg_1', NULL, 'usr_dana', 1, 'fact', ?)", v2.fact.factId);
  const out = await erase(h.ctx, { factIds: [v2.fact.factId] });
  assert.equal(out.erased, 2);
  assert.equal(h.rows("SELECT id FROM memory_facts WHERE id IN ('fct_priv', ?)", v2.fact.factId).length, 0);
  assert.equal(h.rows("SELECT ref FROM memory_pointer_log WHERE ref = 'fct_priv'").length, 0);
  assert.equal(h.rows("SELECT ref FROM memory_recall_log").length, 0);
  const lines = h.rows("SELECT action, reason, detail FROM memory_trail WHERE action = 'erase'");
  assert.equal(lines.length, 2);
  assert.ok(!JSON.stringify(h.rows("SELECT * FROM memory_trail")).includes("Thursdays"));
});

test("a member who is not the source cannot erase it; an admin can", async () => {
  const h = seeded();
  await profileMove(h.ctx, { factId: "fct_pub", to: "public" });
  const maya = asPerson(h, { kind: "person", id: MAYA });
  await assert.rejects(erase(maya.ctx, { factIds: ["fct_pub"] }), /Only the person the fact came from, or an admin/);
  assert.equal(h.rows("SELECT id FROM memory_facts WHERE id = 'fct_pub'").length, 1);
  const admin = asPerson(h, { kind: "person", id: "usr_boss" }, { admin: true });
  assert.equal((await erase(admin.ctx, { factIds: ["fct_pub"] })).erased, 1);
});
