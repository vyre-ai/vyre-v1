// Private agents (l-outsidepriv): a person's assistant and an outside agent they connected through /mcp are theirs alone. No one else lists, opens or reaches them, an admin's All in the Space
// included; a direct reach by id is refused in plain words; an owner or admin may still remove an outside agent from Console, without it being listed for them.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers } from "../impl.ts";
import { DANA, LEO, assertEventsConform, harness } from "../fixtures/harness.ts";
import { announcePrivacy } from "../handlers/crud.ts";
import type { Harness } from "../fixtures/harness.ts";
import { PRIVATE_AGENT, isPrivateAgent } from "../projections.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const connect = async (hn: Harness): Promise<string> => (await h["agents.outside.connect"]!({ ...hn.ctx, depth: 1 }, { clientName: "Claude Code" })).agentId;
const ids = async (ctx: Harness["ctx"]): Promise<string[]> => (await h["agents.list"]!(ctx, { teammates: "include", limit: 500 })).agents.map((a: { agentId: string }) => a.agentId);
const refusal = async (f: () => Promise<unknown>): Promise<{ code: string; message: string; reason?: string }> => {
  try { await f(); } catch (e) { const x = (e as { error: { code: string; message: string; details?: { reason?: string } } }).error; return { code: x.code, message: x.message, ...(x.details?.reason ? { reason: x.details.reason } : {}) }; }
  return { code: "none", message: "" };
};

test("an outside agent and an assistant are private; a Space agent is not", () => {
  assert.equal(isPrivateAgent({ kind: "agent", runtime: "outside" }), true);
  assert.equal(isPrivateAgent({ kind: "assistant", runtime: "vyre" }), true);
  assert.equal(isPrivateAgent({ kind: "agent", runtime: "vyre" }), false);
  assert.equal(isPrivateAgent({ kind: "teammate", runtime: "vyre" }), false);
});

test("another member, even an admin with All in the Space on, gets no row for the owner's outside agent or assistant", async () => {
  const hn = harness();   // everyone may do everything here: the admin case
  const simba = await connect(hn);
  const [assistant] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), { payload: { principalId: DANA, kind: "person", name: "Dana Reyes" } } as never);
  const plain = (await h["agents.create"]!(hn.ctx, { name: "Docs", idempotencyKey: "d" })).agent.agentId;
  const leo = hn.person(LEO);
  await h["agents.visibility.set"]!(leo, { all: true });
  const seen = await ids(leo);
  assert.equal(seen.includes(simba), false, "the outside agent is not listed");
  assert.equal(seen.includes(assistant!), false, "the assistant is not listed");
  assert.equal(seen.includes(plain), true, "a Space agent still is");
  const mine = await ids(hn.person(DANA));
  assert.ok(mine.includes(simba) && mine.includes(assistant!), "its person sees both");
});

test("a direct reach by id is refused in plain words, and says nothing more for an id that is not there", async () => {
  const hn = harness();
  const simba = await connect(hn);
  const leo = hn.person(LEO);
  for (const cap of ["agents.get", "agents.status", "agents.summary"]) {
    assert.deepEqual(await refusal(() => h[cap]!(leo, { agentId: simba })), { code: "validation.not_found", message: PRIVATE_AGENT, reason: "private" }, cap);
  }
  assert.deepEqual(await refusal(() => h["agents.get"]!(leo, { agentId: "agt_nothere" })), { code: "validation.not_found", message: "That agent does not exist." });
});

test("an owner or admin removes someone's outside agent from Console; a member cannot", async () => {
  const hn = harness();
  const simba = await connect(hn);
  hn.allowOnly((action) => action.perm !== "access.manage");   // a plain member
  assert.equal((await refusal(() => h["agents.delete"]!(hn.person(LEO), { agentId: simba }))).code, "validation.not_found");
  hn.allowOnly(() => true);   // an admin
  assert.deepEqual(await h["agents.delete"]!(hn.person(LEO), { agentId: simba }), { deleted: true });
  assert.equal(hn.named("agent.deleted").length + hn.named("agent.retired").length > 0 || hn.rows(`SELECT "deletedAt" FROM agents_agent WHERE id = ?`, simba)[0]?.["deletedAt"] != null, true, "it went to Trash");
});

test("an admin cannot reach someone's assistant to remove it, and the assistant still stays", async () => {
  const hn = harness();
  const [assistant] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), { payload: { principalId: DANA, kind: "person", name: "Dana Reyes" } } as never);
  assert.equal((await refusal(() => h["agents.delete"]!(hn.person(LEO), { agentId: assistant! }))).code, "validation.not_found");
});

test("access learns which agents are private: agent.created says so and agent.privacy_set follows; a Space agent says nothing", async () => {
  const hn = harness();
  const simba = await connect(hn);
  const [assistant] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), { payload: { principalId: DANA, kind: "person", name: "Dana Reyes" } } as never);
  const plain = (await h["agents.create"]!(hn.ctx, { name: "Docs", idempotencyKey: "d" })).agent.agentId;
  const created = new Map(hn.named("agent.created").map((e) => [e.subject, e.payload["private"]] as const));
  assert.deepEqual([created.get(simba), created.get(assistant!), created.get(plain)], [true, true, undefined]);
  assert.deepEqual(hn.named("agent.privacy_set").map((e) => e.payload).sort((a, b) => String(a["agentId"]).localeCompare(String(b["agentId"]))),
    [{ agentId: simba, ownerId: DANA, private: true }, { agentId: assistant!, ownerId: DANA, private: true }].sort((a, b) => a.agentId.localeCompare(b.agentId)));
  assert.deepEqual(assertEventsConform(hn), []);
});

test("at boot, a private agent made before access learnt of privacy is announced once", async () => {
  const hn = harness();
  const simba = await connect(hn);
  hn.db.run(`DELETE FROM agents_meta WHERE key = ?`, `privacy:${simba}`);
  hn.clear();
  assert.deepEqual(await announcePrivacy(hn.ctx), [simba]);
  assert.deepEqual(await announcePrivacy(hn.ctx), [], "once");
  assert.equal(hn.named("agent.privacy_set").length, 1);
});
