// Ask panes (spec 4.8, 2.5; ARCH 4.13): the suggested agent, the pane history of an object, the Recent rule, and the Ask for access link when the person cannot see the object.
import test from "node:test";
import assert from "node:assert/strict";
import { askHandlers } from "../handlers/index.ts";
import { handlers } from "../impl.ts";
import { threadBy } from "../projections.ts";
import { DANA, INTAKE, LEO, MAYA, assertEventsConform, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
const A = askHandlers as unknown as Record<string, Fn>;
let n = 0;

interface World {
  events: Record<string, { bookedByAgentId?: string; recordIds: string[] }>;
  records: Record<string, { type: string; fields: Record<string, unknown> }>;
  last: unknown;
  denied: Set<string>;
  asked: string[];
}
function rig(over: Partial<World> = {}) {
  const world: World = { events: {}, records: {}, last: null, denied: new Set(), asked: [], ...over };
  const hn = harness({
    calls: {
      "access.check": (i) => {
        const r = (i as { resource: { type: string; id: string } }).resource;
        world.asked.push(`${r.type}:${r.id}`);
        return { decision: { effect: world.denied.has(`${r.type}:${r.id}`) ? "deny" : "allow", reason: "test", steps: [], decisionId: "dec_1" } };
      },
      "calendar.get_event": (i) => {
        const e = world.events[(i as { eventId: string }).eventId];
        if (!e) throw new Error("no such event");
        return { event: e };
      },
      "records.get": (i) => {
        const { type, recordId } = i as { type: string; recordId: string };
        const r = world.records[recordId];
        if (!r || r.type !== type) throw new Error("no such record");
        return { record: { id: recordId, type, fields: r.fields } };
      },
      "settings.get": () => ({ row: { value: world.last } }),
    },
  });
  return { hn, world };
}
const ask = async (ctx: Harness["ctx"], scopeType: string, scopeId: string, agentId = INTAKE): Promise<any> =>
  (await h["chat.start"]!(ctx, { kind: "ask", agentIds: [agentId], scopeType, scopeId, idempotencyKey: `a${++n}` })).thread;
async function code(f: () => unknown): Promise<{ code: string; reason?: string; next: Array<{ kind: string; action?: { cap: string; input: any } }> }> {
  try { await f(); } catch (e) {
    const err = (e as { error?: { code?: string; details?: { reason?: string }; next?: any[] } }).error;
    return { code: err?.code ?? "unknown", ...(err?.details?.reason ? { reason: err.details.reason } : {}), next: err?.next ?? [] };
  }
  return { code: "none", next: [] };
}

// ---- who to ask

test("suggested agent: the one that booked the event, else the contact's agent, else the one the person last asked", async () => {
  const { hn, world } = rig();
  world.events["cev_booked"] = { bookedByAgentId: "agt_booker", recordIds: ["rec_c1"] };
  world.events["cev_plain"] = { recordIds: ["rec_company", "rec_c1"] };
  world.events["cev_none"] = { recordIds: [] };
  world.records["rec_company"] = { type: "company", fields: { agent: "agt_company" } };
  world.records["rec_c1"] = { type: "contact", fields: { agent: "agt_contact" } };
  world.records["rec_c2"] = { type: "contact", fields: {} };
  world.last = "agt_last";

  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "event", scopeId: "cev_booked" }), { agentId: "agt_booker", reason: "booked_by" });
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "event", scopeId: "cev_plain" }), { agentId: "agt_contact", reason: "contact_agent" }, "a linked company is not a contact; the contact's agent is");
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "event", scopeId: "cev_none" }), { agentId: "agt_last", reason: "last_used" });
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "record", scopeId: "rec_c1" }), { agentId: "agt_contact", reason: "contact_agent" });
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "record", scopeId: "rec_c2" }), { agentId: "agt_last", reason: "last_used" }, "a contact with no agent");
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "record", scopeId: "rec_company" }), { agentId: "agt_last", reason: "last_used" }, "a record that is not a contact");
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "file", scopeId: "fil_1" }), { agentId: "agt_last", reason: "last_used" });
  world.last = null;
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "file", scopeId: "fil_1" }), { agentId: null, reason: "none" });
  assert.deepEqual(contractErrors("chat.ask_suggest", "out", { agentId: null, reason: "none" }), []);
});

test("suggested agent: only an agent id counts, wherever it came from", async () => {
  const { hn, world } = rig();
  world.events["cev_x"] = { bookedByAgentId: "usr_not_an_agent", recordIds: ["rec_c1"] };
  world.records["rec_c1"] = { type: "contact", fields: { agent: "someone" } };
  world.last = "agent-ish";
  assert.deepEqual(await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "event", scopeId: "cev_x" }), { agentId: null, reason: "none" });
});

test("the suggestion follows the asker: the setting is read for the person who calls", async () => {
  const seen: Array<string | undefined> = [];
  const hn = harness({
    calls: {
      "access.check": (i) => { seen.push((i as { principal: { id: string } }).principal.id); return { decision: { effect: "allow", reason: "ok", steps: [], decisionId: "d" } }; },
      "settings.get": () => ({ row: { value: "agt_mine" } }),
    },
  });
  await A["chat.ask_suggest"]!(hn.agent(INTAKE, MAYA), { scopeType: "record", scopeId: "rec_1" });
  assert.deepEqual(seen, [MAYA], "access is asked for the person the agent acts for");
});

// ---- scope and access

test("an Ask scope names an object with a type and an id", async () => {
  const { hn } = rig();
  for (const bad of [{ scopeType: "Record!", scopeId: "rec_1" }, { scopeType: "", scopeId: "rec_1" }, { scopeType: "record", scopeId: "  " }, { scopeType: "record", scopeId: "x".repeat(201) }]) {
    assert.equal((await code(() => A["chat.ask_suggest"]!(hn.ctx, bad))).code, "validation.bad_input", JSON.stringify(bad).slice(0, 40));
    assert.equal((await code(() => A["chat.asks_of"]!(hn.ctx, { resourceType: bad.scopeType, resourceId: bad.scopeId }))).code, "validation.bad_input");
  }
});

test("an object the person cannot see gets no answer and the Ask for access link, the same one the tool refusals carry", async () => {
  const { hn, world } = rig();
  world.denied.add("record:rec_secret");
  const r = await code(() => A["chat.ask_suggest"]!(hn.ctx, { scopeType: "record", scopeId: "rec_secret" }));
  assert.deepEqual([r.code, r.reason], ["permission.no_grant", "no_view"]);
  assert.deepEqual(r.next, [{ kind: "ask_access", label: "Ask for access", action: { cap: "access.request", input: { resource: { type: "record", id: "rec_secret" }, level: "view" } } }]);
  const h2 = await code(() => A["chat.asks_of"]!(hn.ctx, { resourceType: "record", resourceId: "rec_secret" }));
  assert.equal(h2.code, "permission.no_grant", "the pane history of an object is as private as the object");
  // the person can still ask about what they can see
  assert.deepEqual((await A["chat.asks_of"]!(hn.ctx, { resourceType: "record", resourceId: "rec_open" })).threads, []);
});

test("objects that are not resources of their own are read through their own capability, which carries the refusal; no access check is made for them", async () => {
  const { hn, world } = rig();
  world.events["cev_1"] = { recordIds: [] };
  await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "event", scopeId: "cev_1" });
  await A["chat.asks_of"]!(hn.ctx, { resourceType: "page", resourceId: "home" });
  assert.deepEqual(world.asked, []);
  await A["chat.ask_suggest"]!(hn.ctx, { scopeType: "file", scopeId: "fil_1" });
  assert.deepEqual(world.asked, ["file:fil_1"]);
});

// ---- the pane history

test("Ask panes carry the object they are about as scope columns, and start out of Recent", async () => {
  const { hn } = rig();
  const t = await ask(hn.ctx, "record", "rec_a1");
  assert.deepEqual([t.kind, t.scopeType, t.scopeId, t.listed], ["ask", "record", "rec_a1", false]);
  const row = hn.rows("SELECT kind, scopeType, scopeId, listed, starter FROM chat_thread WHERE id = ?", t.threadId)[0]!;
  assert.deepEqual(row, { kind: "ask", scopeType: "record", scopeId: "rec_a1", listed: 0, starter: DANA });
});

test("the pane history of an object is the caller's own Ask panes on it, newest first, listed or not, and nobody else's", async () => {
  const { hn } = rig();
  const first = await ask(hn.ctx, "record", "rec_a1");
  hn.advance(10);
  const second = await ask(hn.ctx, "record", "rec_a1");
  hn.advance(10);
  await ask(hn.ctx, "record", "rec_a2");
  hn.advance(10);
  const mine = await ask(hn.person(MAYA), "record", "rec_a1");
  await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], recordId: "rec_a1", idempotencyKey: "plain-chat" });
  await A["chat.open_as_chat"]!(hn.ctx, { threadId: first.threadId });

  const dana = await A["chat.asks_of"]!(hn.ctx, { resourceType: "record", resourceId: "rec_a1" });
  assert.deepEqual(dana.threads.map((x: any) => x.threadId), [second.threadId, first.threadId]);
  assert.equal(dana.total, 2);
  assert.deepEqual(dana.threads.map((x: any) => x.listed), [false, true]);
  assert.equal("next" in dana, false);
  assert.deepEqual(contractErrors("chat.asks_of", "out", dana), []);

  const maya = await A["chat.asks_of"]!(hn.person(MAYA), { resourceType: "record", resourceId: "rec_a1" });
  assert.deepEqual(maya.threads.map((x: any) => x.threadId), [mine.threadId]);
  for (const other of [hn.person(LEO), hn.agent(INTAKE, LEO)]) assert.deepEqual((await A["chat.asks_of"]!(other, { resourceType: "record", resourceId: "rec_a1" })).threads, [], "an Ask pane is private, even from an admin");
  assert.deepEqual((await A["chat.asks_of"]!(hn.ctx, { resourceType: "file", resourceId: "rec_a1" })).threads, [], "the type is part of the object");
});

test("the pane history pages with a cursor and counts all of it", async () => {
  const { hn } = rig();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) { ids.unshift((await ask(hn.ctx, "record", "rec_p")).threadId); hn.advance(i === 2 ? 0 : 10); }
  const p1 = await A["chat.asks_of"]!(hn.ctx, { resourceType: "record", resourceId: "rec_p", limit: 2 });
  assert.equal(p1.threads.length, 2);
  assert.equal(p1.total, 5);
  assert.ok(p1.next);
  const p2 = await A["chat.asks_of"]!(hn.ctx, { resourceType: "record", resourceId: "rec_p", limit: 2, cursor: p1.next });
  const p3 = await A["chat.asks_of"]!(hn.ctx, { resourceType: "record", resourceId: "rec_p", limit: 2, cursor: p2.next });
  const got = [...p1.threads, ...p2.threads, ...p3.threads].map((x: any) => x.threadId);
  assert.equal(new Set(got).size, 5, "no pane twice, none missed, even where two share a timestamp");
  assert.equal("next" in p3, false);
  assert.equal((await code(() => A["chat.asks_of"]!(hn.ctx, { resourceType: "record", resourceId: "rec_p", cursor: "garbage" }))).code, "validation.bad_input");
  assert.deepEqual(got.slice().sort(), ids.slice().sort());
});

// ---- the Recent rule

test("open as chat lists the Ask pane in Recent: the owner only, once, with one event", async () => {
  const { hn } = rig();
  const t = await ask(hn.ctx, "record", "rec_a1");
  hn.clear();
  const out = await A["chat.open_as_chat"]!(hn.ctx, { threadId: t.threadId });
  assert.equal(out.thread.listed, true);
  assert.equal(threadBy(hn.db, t.threadId)?.listed, true);
  assert.deepEqual(hn.names(), ["thread.updated"]);
  assert.deepEqual(hn.named("thread.updated")[0]!.payload, { threadId: t.threadId, fields: ["listed"] });
  assert.deepEqual(assertEventsConform(hn), []);
  assert.deepEqual(contractErrors("chat.open_as_chat", "out", out), []);
  hn.clear();
  assert.equal((await A["chat.open_as_chat"]!(hn.ctx, { threadId: t.threadId })).thread.listed, true);
  assert.deepEqual(hn.names(), [], "asking again changes nothing and says nothing");
  assert.equal(hn.rows("SELECT version FROM chat_thread WHERE id = ?", t.threadId)[0]!["version"], 1);
});

test("open as chat refuses what is not the caller's own Ask pane: someone else's, a chat, a thread that is not there", async () => {
  const { hn } = rig();
  const t = await ask(hn.ctx, "record", "rec_a1");
  const chat = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "c1" })).thread;
  for (const [ctx, id] of [[hn.person(MAYA), t.threadId], [hn.agent(INTAKE, LEO), t.threadId], [hn.ctx, chat.threadId], [hn.ctx, "thr_none"]] as const) {
    assert.equal((await code(() => A["chat.open_as_chat"]!(ctx, { threadId: id }))).code, "validation.not_found");
  }
  assert.equal(threadBy(hn.db, t.threadId)?.listed, false);
});
