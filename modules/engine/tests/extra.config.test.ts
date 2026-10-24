// Policy, defaults, the person switches, the use-policy export, models and providers, route preview and review (engine capabilities left over from P-L2_13).
import test from "node:test";
import assert from "node:assert/strict";
import { bindSandboxStopper, flagOn, wrappedRuntimeKey } from "../handlers/extra/config.ts";
import { extraHandlers } from "../handlers/extra/index.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const H = extraHandlers;

function withRoutes(h: Harness, routes: Record<string, (input: unknown) => unknown>): EngineCtx {
  return { ...h.ctx, call: async (cap: string, input: unknown) => (routes[cap] ? routes[cap](input) : h.ctx.call(cap, input)) };
}

const prov = (o: Record<string, unknown>) => ({ providerKey: "anthropic", name: "Anthropic", connection: "api_key", scope: "mine", engine: "anthropic", spaceMayUse: false, state: "ok", ...o });
const PROVIDERS = [
  prov({ id: "prv_a", handle: "#Dana_Anthropic", itemId: "vit_a" }),
  prov({ id: "prv_o", providerKey: "openai", name: "OpenAI", engine: "openai", handle: "#Dana_OpenAI", itemId: "vit_o" }),
  prov({ id: "prv_c", providerKey: "anthropic", name: "Claude Code", connection: "subscription", engine: "claude-code", handle: "#Dana_Claude", itemId: "vit_c", state: "needs_sign_in" }),
];
const MODELS: Record<string, string[]> = { prv_a: ["claude-sonnet-5-5", "claude-opus-5"], prv_o: ["gpt-5"] };
const routes = {
  "providers.list": () => ({ providers: PROVIDERS }),
  "providers.test": (i: unknown) => ({ ok: true, models: MODELS[(i as { providerId: string }).providerId] ?? [], latencyMs: 5 }),
};

test("policy is empty by default, saved per key, validated, and tells the settings page", async () => {
  const h = harness();
  const settingsSet: unknown[] = [];
  const stored: Record<string, unknown> = { "engine.agent_hops": 6 };
  const ctx = withRoutes(h, { "settings.get": (i) => ({ row: { value: stored[(i as { key: string }).key] ?? null } }), "settings.set_space": (i) => { settingsSet.push(i); return {}; } });
  const before = await H["engine.policy.get"](ctx, {});
  assert.deepEqual(before, { allowedAccounts: "any", allowedModels: [], allowedProviders: [], labelProviders: {}, hops: { agentHops: 6, reviewLoops: 2, ciFixLoops: 3 } });
  assert.deepEqual(contractErrors("engine.policy.get", "out", before), []);

  assert.deepEqual(await H["engine.policy.set"](ctx, {
    allowedAccounts: "company", allowedModels: ["claude-sonnet-5-5", "claude-sonnet-5-5"], allowedProviders: ["anthropic"], labelProviders: { restricted: ["anthropic"] },
  }), { ok: true });
  const after = await H["engine.policy.get"](ctx, {});
  assert.deepEqual([after.allowedAccounts, after.allowedModels, after.allowedProviders, after.labelProviders], ["company", ["claude-sonnet-5-5"], ["anthropic"], { restricted: ["anthropic"] }]);
  assert.deepEqual(settingsSet, [{ key: "engine.allowed_accounts", value: "company" }]);
  assert.deepEqual(h.named("engine.policy_changed")[0]?.payload, { keys: ["allowedAccounts", "allowedModels", "allowedProviders", "labelProviders"], by: "usr_dana" });
  await assert.rejects(H["engine.policy.set"](ctx, { labelProviders: { secret: ["x"] } }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.named("engine.policy_changed").length, 1, "a refused change records nothing");
  assert.deepEqual(assertEventsConform(h), []);
});

test("defaults are kept per person, merge field by field, and refuse what the Space policy forbids", async () => {
  const h = harness();
  assert.deepEqual(H["engine.defaults.get"](h.ctx, {}), { fallback: [] });
  await H["engine.defaults.set"](h.ctx, { provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" });
  await H["engine.defaults.set"](h.ctx, { fallback: [{ provider: "openai", model: "gpt-5", accountRef: "#Team_OpenAI" }] });
  const got = H["engine.defaults.get"](h.ctx, {});
  assert.deepEqual(got, { provider: "anthropic", model: "claude-sonnet-5-5", effort: "high", fallback: [{ provider: "openai", model: "gpt-5", accountRef: "#Team_OpenAI" }] });
  assert.deepEqual(contractErrors("engine.defaults.get", "out", got), []);
  const sam = { ...h.ctx, principal: { kind: "person" as const, id: "usr_sam" } };
  assert.deepEqual(H["engine.defaults.get"](sam, {}), { fallback: [] }, "Dana's choice is not Sam's");

  await H["engine.policy.set"](h.ctx, { allowedProviders: ["anthropic"] });
  await assert.rejects(H["engine.defaults.set"](h.ctx, { fallback: [{ provider: "openai", model: "gpt-5" }] }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(H["engine.defaults.set"](h.ctx, { fallback: [{ provider: "", model: "x" }] }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(H["engine.defaults.get"](h.ctx, {}).fallback.length, 1, "a refused save changes nothing");
});

test("models.list greys what the policy or the label forbids and what is not signed in, with the reason", async () => {
  const h = harness();
  const ctx = withRoutes(h, routes);
  const open = await H["engine.models.list"](ctx, {});
  assert.deepEqual(contractErrors("engine.models.list", "out", open), []);
  assert.deepEqual(open.models.map((m) => [m.provider, m.model, m.allowed, m.reason]), [
    ["anthropic", "claude-opus-5", true, undefined], ["anthropic", "claude-sonnet-5-5", true, undefined], ["openai", "gpt-5", true, undefined], ["anthropic", "anthropic", false, "not_connected"],
  ]);

  await H["engine.policy.set"](ctx, { allowedModels: ["claude-sonnet-5-5", "gpt-5"], labelProviders: { restricted: ["anthropic"] } });
  const limited = await H["engine.models.list"](ctx, { recordLabel: "restricted" });
  const by = Object.fromEntries(limited.models.map((m) => [m.model, [m.allowed, m.reason]]));
  assert.deepEqual(by["claude-sonnet-5-5"], [true, undefined]);
  assert.deepEqual(by["claude-opus-5"], [false, "policy_model"]);
  assert.deepEqual(by["gpt-5"], [false, "label_provider"]);

  const one = await H["engine.models.list"](ctx, { accountRef: "#Dana_OpenAI" });
  assert.deepEqual(one.models.map((m) => m.model), ["gpt-5"]);
  await assert.rejects(H["engine.models.list"](ctx, { accountRef: "#Nobody" }), (e) => codeOf(e) === "validation.not_found");
});

test("providers.list names every API and CLI engine with connected and allowed, and the label rule's reason", async () => {
  const h = harness();
  const ctx = withRoutes(h, { ...routes, "threads.get": () => ({ thread: { threadId: "thr_x", label: "restricted", agents: [] } }) });
  const open = await H["engine.providers.list"](ctx, {});
  assert.deepEqual(contractErrors("engine.providers.list", "out", open), []);
  const row = (d: string) => open.providers.find((p) => p.driver === d);
  assert.deepEqual([row("anthropic")?.connected, row("anthropic")?.kind, row("openai")?.connected, row("google")?.connected, row("claude_code")?.kind, row("claude_code")?.connected], [true, "api", true, false, "cli", false]);
  assert.equal(open.providers.length, 10);

  await H["engine.policy.set"](ctx, { labelProviders: { restricted: ["anthropic"] } });
  const restricted = await H["engine.providers.list"](ctx, { threadId: "thr_x" });
  assert.equal(restricted.providers.find((p) => p.driver === "anthropic")?.allowed, true);
  const openai = restricted.providers.find((p) => p.driver === "openai");
  assert.equal(openai?.allowed, false);
  assert.match(openai?.reason ?? "", /restricted records may not go/);
});

test("the person switches: sharing a subscription kills the sandbox when turned off, and the runtime opt-in keeps a wrapped key only while on", async () => {
  const h = harness();
  const stopped: string[] = [];
  bindSandboxStopper(async (p) => { stopped.push(p); return true; });
  try {
    assert.deepEqual(await H["engine.subscription_share.set"](h.ctx, { enabled: true }), { enabled: true, sandboxStopped: false });
    assert.equal(flagOn(h.ctx, "usr_dana", "subscription_share"), true);
    assert.deepEqual(await H["engine.subscription_share.set"](h.ctx, { enabled: false }), { enabled: false, sandboxStopped: true });
    assert.deepEqual(stopped, ["usr_dana"]);
    assert.equal(h.named("engine.subscription_share_changed").length, 2);
    await H["engine.subscription_share.set"](h.ctx, { enabled: false });
    assert.equal(h.named("engine.subscription_share_changed").length, 2, "no change, no event");
  } finally {
    bindSandboxStopper(null);
  }

  assert.throws(() => H["engine.runtime.opt_in"](h.ctx, { enabled: true }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(H["engine.runtime.opt_in"](h.ctx, { enabled: true, wrappedRuntimeKey: "ciphertext-1" }), { enabled: true });
  assert.equal(wrappedRuntimeKey(h.ctx, "usr_dana"), "ciphertext-1");
  assert.deepEqual(H["engine.runtime.opt_in"](h.ctx, { enabled: false }), { enabled: false });
  assert.equal(wrappedRuntimeKey(h.ctx, "usr_dana"), null, "turning it off deletes the key");
  assert.equal(h.named("engine.runtime_opt_in_changed").length, 2);
  assert.ok(!JSON.stringify(h.emitted).includes("ciphertext"), "no key material in any event");
  assert.deepEqual(assertEventsConform(h), []);
});

test("use_policy.export writes the policy as a Markdown file in the shared knowledge folder", async () => {
  const h = harness();
  const created: Array<Record<string, unknown>> = [];
  const ctx = withRoutes(h, {
    "files.tree": () => ({ roots: [{ key: "recent", title: "Recent", kind: "virtual", count: 0 }, { key: "knowledge", title: "Knowledge", kind: "folder", folderId: "fld_know", count: 2 }] }),
    "files.create": (i) => { created.push(i as Record<string, unknown>); return { file: { fileId: "fil_policy" } }; },
  });
  await H["engine.policy.set"](ctx, { allowedProviders: ["anthropic"], labelProviders: { restricted: ["anthropic"] } });
  const out = await H["engine.use_policy.export"](ctx, {});
  assert.deepEqual(out, { fileId: "fil_policy" });
  assert.deepEqual(contractErrors("engine.use_policy.export", "out", out), []);
  assert.equal(created[0]?.["folderId"], "fld_know");
  const text = ((created[0]?.["content"] as { text: string }).text);
  assert.match(text, /Allowed providers: anthropic/);
  assert.match(text, /- restricted: anthropic/);
  assert.match(text, /Agent-to-agent hops before a person must reply: 4/);
  const none = withRoutes(h, { "files.tree": () => ({ roots: [{ key: "recent", title: "Recent", kind: "virtual", count: 0 }] }) });
  await assert.rejects(H["engine.use_policy.export"](none, {}), (e) => codeOf(e) === "validation.precondition_failed");
});

test("route.preview says who will reply with the same route() the server uses", async () => {
  const h = harness();
  const ctx = withRoutes(h, { "threads.get": () => ({ thread: { agents: [{ agentId: "agt_intake", mode: "lead", name: "Intake" }, { agentId: "agt_docs", mode: "listen", name: "Docs" }] } }) });
  assert.deepEqual(await H["engine.route.preview"](ctx, { threadId: "thr_1" }), { responders: ["agt_intake"], line: "Intake will reply" });
  const two = await H["engine.route.preview"](ctx, { threadId: "thr_1", mentions: [{ kind: "agent", id: "agt_docs" }, { kind: "agent", id: "agt_intake" }] });
  assert.equal(two.line, "Docs and Intake will reply");
  assert.deepEqual(contractErrors("engine.route.preview", "out", two), []);
  assert.equal((await H["engine.route.preview"](ctx, { threadId: "thr_1", mentions: [{ kind: "person", id: "usr_sam" }] })).line, "No agent will reply, type @ to ask one");
  await assert.rejects(H["engine.route.preview"](h.ctx, { threadId: "thr_missing" }), (e) => codeOf(e) === "validation.not_found");
});

test("review: sampled turns wait for a person; fine closes them, flagged opens an incident once", async () => {
  const h = harness();
  const ctx = withRoutes(h, { "settings.get": () => ({ row: { value: { percent: 100, labels: [] } } }) });
  for (const [q, msg] of [[1, "msg_a"], [2, "msg_b"]] as const) {
    H["engine.turn.enqueue"](ctx, { threadId: "thr_r", agentId: "agt_intake", kind: "message", messageId: msg, from: "usr_dana" });
    const { turn } = H["engine.turn.start"](ctx, { threadId: "thr_r", agentId: "agt_intake", qseq: q, placement: "host", engine: "anthropic", model: "claude-sonnet-5-5" });
    h.advance(1000);
    await H["engine.turn.finish"](ctx, { turnId: turn.turnId, outcome: "completed" });
  }
  const waiting = H["engine.review.list"](ctx, { state: "waiting" });
  assert.deepEqual(contractErrors("engine.review.list", "out", waiting), []);
  assert.equal(waiting.items.length, 2);
  const [first, second] = waiting.items;
  assert.ok(first && second);

  assert.deepEqual(H["engine.review.mark"](ctx, { turnId: first.turnId, verdict: "ok" }), {});
  const flagged = H["engine.review.mark"](ctx, { turnId: second.turnId, verdict: "flagged", note: "Quoted a fee it should not have." });
  assert.ok(flagged.incidentId);
  assert.deepEqual(contractErrors("engine.review.mark", "out", flagged), []);
  assert.deepEqual(H["engine.review.mark"](ctx, { turnId: second.turnId, verdict: "flagged" }), flagged, "marking again returns the same incident");
  assert.equal(h.rows("SELECT * FROM engine_incidents").length, 1);
  assert.equal(h.rows("SELECT note_text FROM engine_incident_notes")[0]?.["note_text"], "Quoted a fee it should not have.");
  assert.equal(h.named("review.marked").length, 2);
  assert.deepEqual(H["engine.review.list"](ctx, {}).items.map((i) => i.state).sort(), ["flagged", "ok"]);
  assert.equal(H["engine.review.list"](ctx, { state: "waiting" }).items.length, 0);
  assert.throws(() => H["engine.review.mark"](ctx, { turnId: "trn_nope", verdict: "ok" }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(assertEventsConform(h), []);
});
