// An automation's AI step turn (engine.step_turn). A scripted session stands in for the model vendor; accounts, policy, agents and memory are scripted capabilities. Real SQLite for the meters.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { STEP_AGENT, setMinuteForTests, stepTurn } from "../step-turn.ts";
import type { StepTurnIn } from "../step-turn.ts";
import { bindStepOpen } from "../projections.ts";
import { capsSet, pauseAll, usageQuery } from "../handlers/spend.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

type Prov = { id: string; handle?: string; itemId: string; name: string; providerKey: string; connection: "subscription" | "api_key" | "local_model"; scope: "mine" | "shared"; engine: string; spaceMayUse: boolean; state: "ok" | "needs_sign_in" | "failing" };
const key = (over: Partial<Prov> = {}): Prov => ({ id: "prv_1", handle: "#Mine_Anthropic", itemId: "vit_1", name: "Mine Anthropic", providerKey: "anthropic", connection: "api_key", scope: "mine", engine: "anthropic", spaceMayUse: false, state: "ok", ...over });
const team = (over: Partial<Prov> = {}): Prov => key({ id: "prv_t", handle: "#Team_Key", itemId: "vit_t", name: "Team key", scope: "shared", ...over });
const sub = (over: Partial<Prov> = {}): Prov => key({ id: "prv_s", handle: "#My_Claude", itemId: "vit_c", name: "My Claude", providerKey: "claude-code", connection: "subscription", engine: "claude-code", spaceMayUse: true, ...over });
const answer: DriverEvent[] = [{ type: "text", text: "Hello " }, { type: "text", text: "there." }, { type: "usage", inputTokens: 40, outputTokens: 7 }, { type: "done" }];

function scene(o: { principal?: Harness["ctx"]["principal"]; providers?: Prov[]; script?: readonly DriverEvent[]; agent?: Record<string, unknown>; facts?: string[]; policy?: "any" | "company" } = {}) {
  const h = harness({ principal: o.principal ?? { kind: "person", id: "usr_dana" } });
  const provider = scriptedProvider({ script: o.script ?? answer });
  bindStepOpen(provider.openSession);
  const seen: string[] = [];
  const base = h.ctx.call;
  h.ctx.call = async (cap: string, input: unknown): Promise<unknown> => {
    seen.push(cap);
    if (cap === "providers.list") return { providers: o.providers ?? [key()] };
    if (cap === "engine.policy.get") return { allowedAccounts: o.policy ?? "any" };
    if (cap === "agents.get") return { agent: { agentId: "agt_intake", name: "Intake", role: "You answer intake questions.", model: "claude-sonnet-5-5", accountPolicy: "asker", status: "awake", ...(o.agent ?? {}) } };
    if (cap === "memory.facts.list") return { facts: (o.facts ?? []).map((text) => ({ text })) };
    return base(cap, input);
  };
  return { h, provider, seen };
}
const run = (h: Harness, over: Partial<StepTurnIn> = {}) => stepTurn(h.ctx, { prompt: "Say hello.", runId: "run_1", stepId: "ask", idempotencyKey: "run_1:ask:1", ...over });
afterEach(() => { bindStepOpen(null); setMinuteForTests(60_000); });

test("a Personal turn runs on the owner's own key with no tools, and returns the answer, the key by handle and the model", async () => {
  const { h, provider } = scene();
  const out = await run(h);
  assert.deepEqual(out, { text: "Hello there.", keyUsed: "#Mine_Anthropic", modelUsed: "anthropic", tokensIn: 40, tokensOut: 7 });
  const spec = provider.specs[0]!;
  assert.equal(spec.tools, "none");
  assert.equal(spec.asker, "usr_dana");
  assert.equal(spec.agent.id, STEP_AGENT);
  assert.deepEqual([spec.account?.ref, spec.account?.driver, spec.account?.payer, spec.account?.kind], ["#Mine_Anthropic", "anthropic", "usr_dana", "api_key"]);
  assert.equal(provider.sessions[0]!.closed, true, "the session is given back");
  assert.equal(provider.sessions[0]!.inputs[0]!.trigger?.body, "Say hello.");
  assert.deepEqual(provider.sessions[0]!.inputs[0]!.history, []);
});

test("a Personal turn prefers the owner's subscription sign-in over an API key", async () => {
  const { h, provider } = scene({ providers: [key(), sub()] });
  const out = await run(h);
  assert.equal(out.keyUsed, "#My_Claude");
  assert.equal(provider.specs[0]!.account?.driver, "claude_code");
});

test("a subscription the Space may not use, a broken key and no key at all are refused, naming what to add", async () => {
  for (const providers of [[], [sub({ spaceMayUse: false })], [key({ state: "failing" })], [key({ state: "needs_sign_in" })]]) {
    const { h, provider } = scene({ providers });
    await assert.rejects(run(h), (e) => { assert.equal(codeOf(e), "provider.auth_failed"); assert.match((e as { error: { message: string } }).error.message, /AI account/); assert.match((e as { error: { message: string } }).error.message, /AI settings/); return true; });
    assert.equal(provider.specs.length, 0, "nothing was opened");
  }
});

test("a step key picks the account, and the backup covers a key that is not there", async () => {
  const { h } = scene({ providers: [key(), key({ id: "prv_2", handle: "#Other", itemId: "vit_2" })] });
  assert.equal((await run(h, { keyId: "#Other", idempotencyKey: "k2" })).keyUsed, "#Other");
  assert.equal((await run(h, { keyId: "#Missing", backupKeyId: "#Other", idempotencyKey: "k3" })).keyUsed, "#Other", "the backup is used when the key is not there");
  await assert.rejects(run(h, { keyId: "#Missing", idempotencyKey: "k4" }), (e) => codeOf(e) === "provider.auth_failed");
});

test("a key named by provider id, Vault item id or name is the account with that handle", async () => {
  const { h } = scene({ providers: [key({ id: "prv_other", handle: "#Other", itemId: "vit_other", name: "Other key" }), key()] });
  assert.equal((await run(h, { keyId: "prv_other", idempotencyKey: "p1" })).keyUsed, "#Other");
  assert.equal((await run(h, { keyId: "vit_other", idempotencyKey: "p2" })).keyUsed, "#Other");
  assert.equal((await run(h, { keyId: "Other key", idempotencyKey: "p3" })).keyUsed, "#Other");
  assert.equal((await run(h, { keyId: "prv_nope", backupKeyId: "prv_1", idempotencyKey: "p4" })).keyUsed, "#Mine_Anthropic");
});

test("a Space automation runs as its service on a Space-shared key only", async () => {
  const svc = { kind: "service" as const, id: "svc_abc" };
  const ok = scene({ principal: svc, providers: [team(), key()] });
  const out = await run(ok.h, { keyId: "#Team_Key" });
  assert.equal(out.keyUsed, "#Team_Key");
  assert.equal(ok.provider.specs[0]!.asker, "svc_abc");
  assert.equal(ok.provider.specs[0]!.account?.payer, "svc_abc");
  const mine = scene({ principal: svc, providers: [key()] });
  await assert.rejects(run(mine.h, { keyId: "#Mine_Anthropic" }), (e) => { assert.equal(codeOf(e), "provider.auth_failed"); assert.match((e as { error: { message: string } }).error.message, /Space-shared/); return true; });
  const none = scene({ principal: svc, providers: [team()] });
  await assert.rejects(run(none.h), (e) => { assert.match((e as { error: { message: string } }).error.message, /Space automation needs a Space-shared AI key/); return true; });
  assert.equal(none.provider.specs.length, 0);
});

test("as an agent: its name, role and the memory the asker may read lead the prompt, and its model is the session's", async () => {
  const { h, provider, seen } = scene({ facts: ["The firm is closed on Fridays.", "Dana prefers short answers."] });
  await run(h, { agentId: "agt_intake" });
  const body = provider.sessions[0]!.inputs[0]!.trigger!.body;
  assert.match(body, /^You are Intake, an agent in Vyre\. You answer intake questions\./);
  assert.match(body, /- The firm is closed on Fridays\./);
  assert.match(body, /Say hello\.$/);
  assert.equal(provider.specs[0]!.agent.id, "agt_intake");
  assert.equal(provider.specs[0]!.agent.model, "claude-sonnet-5-5");
  assert.ok(seen.includes("memory.facts.list"));
  assert.equal(provider.specs[0]!.tools, "none", "an agent's tools are not given to a step");
});

test("a paused agent cannot be used", async () => {
  const { h, provider } = scene({ agent: { status: "paused" } });
  await assert.rejects(run(h, { agentId: "agt_intake" }), (e) => codeOf(e) === "permission.limit");
  assert.equal(provider.specs.length, 0);
});

test("the same attempt key returns the stored answer and asks the model nothing; the next attempt asks again", async () => {
  const { h, provider } = scene();
  const first = await run(h);
  const again = await run(h);
  assert.deepEqual(again, first);
  assert.equal(provider.sends(), 1);
  await run(h, { idempotencyKey: "run_1:ask:2" });
  assert.equal(provider.sends(), 2);
});

test("a vendor error comes back by its catalogued code and carries neither the prompt nor the key", async () => {
  const { h } = scene({ script: [{ type: "error", code: "provider.rate_limited", message: "Rate limited. Slow down." }] });
  await assert.rejects(run(h, { prompt: "SECRET-PROMPT-TEXT" }), (e) => {
    assert.equal(codeOf(e), "provider.rate_limited");
    assert.equal(JSON.stringify(e).includes("SECRET-PROMPT-TEXT"), false);
    assert.equal(JSON.stringify(e).includes("Slow down"), false, "the provider's own words are not passed on");
    return true;
  });
  const odd = scene({ script: [{ type: "error", code: "engine.weird", message: "boom" }] });
  await assert.rejects(run(odd.h), (e) => codeOf(e) === "provider.unavailable");
  const auth = scene({ script: [{ type: "error", code: "auth.expired", message: "Sign in again." }] });
  await assert.rejects(run(auth.h), (e) => codeOf(e) === "provider.auth_failed");
});

test("a tool request is refused: the step gives the model none", async () => {
  const { h, provider } = scene({ script: [{ type: "tool_call", id: "c1", name: "mail.send", input: {} }, { type: "done" }] });
  await assert.rejects(run(h), (e) => codeOf(e) === "provider.unavailable");
  assert.equal(provider.sessions[0]!.cancelled, true);
  assert.equal(provider.sessions[0]!.toolResults.length, 0);
});

test("a turn that never answers times out at the step's limit", async () => {
  setMinuteForTests(20);
  const hang = scriptedProvider({ script: answer, beforeEvent: () => new Promise<void>(() => {}) });
  const { h } = scene();
  bindStepOpen(hang.openSession);
  await assert.rejects(run(h, { timeoutMinutes: 1 }), (e) => codeOf(e) === "timeout.deadline");
  assert.equal(hang.sessions[0]!.closed, true);
});

test("the turn is counted: usage by person, agent and model, and the meters can stop the next one", async () => {
  const { h } = scene();
  await run(h);
  const u = await usageQuery(h.ctx, { by: "person" });
  assert.deepEqual(u.rows.map((r) => [r.key, r.totals.turns, r.totals.tokensIn, r.totals.tokensOut]), [["usr_dana", 1, 40, 7]]);
  assert.deepEqual((await usageQuery(h.ctx, { by: "agent" })).rows.map((r) => r.key), [STEP_AGENT]);
  capsSet(h.ctx, { scope: "person", caps: { turnsPerDay: 1 } });
  await run(h, { idempotencyKey: "n2" });
  await assert.rejects(run(h, { idempotencyKey: "n3" }), (e) => { assert.equal(codeOf(e), "permission.limit"); return true; });
});

test("paused AI spend refuses the step before it asks anything", async () => {
  const { h, provider } = scene();
  pauseAll(h.ctx, {});
  await assert.rejects(run(h), (e) => codeOf(e) === "permission.limit");
  assert.equal(provider.specs.length, 0);
});

test("without the agent runtime the step says so", async () => {
  const { h } = scene();
  bindStepOpen(null);
  await assert.rejects(run(h), (e) => codeOf(e) === "internal.unavailable");
});

test("the Space's label rule is asked of every record the run read: a provider it forbids refuses the step", async () => {
  const asked: unknown[] = [];
  const { h, provider } = scene();
  const base = h.ctx.call;
  h.ctx.call = async (cap: string, i: unknown) => {
    if (cap === "access.provider_check") { asked.push(i); return { blocked: (i as { resources: { id: string }[] }).resources.filter((r) => r.id === "rec_secret").map((r) => ({ id: r.id, label: "restricted" })) }; }
    return base(cap, i);
  };
  await assert.rejects(run(h, { recordIds: ["rec_ok", "rec_secret"], idempotencyKey: "l1" }), (e) => {
    assert.equal(codeOf(e), "permission.provider_label");
    assert.match((e as { error: { message: string } }).error.message, /restricted records in its input/);
    return true;
  });
  assert.equal(provider.specs.length, 0, "nothing was sent to the provider");
  assert.deepEqual((asked[0] as { provider: string }).provider, "anthropic");
  assert.equal((await run(h, { recordIds: ["rec_ok"], idempotencyKey: "l2" })).keyUsed, "#Mine_Anthropic");
  assert.equal((await run(h, { idempotencyKey: "l3" })).keyUsed, "#Mine_Anthropic");
  assert.equal(asked.length >= 2, true);
});
