// Policy, defaults, the person switches, the use-policy export, models and providers, route preview and review (engine capabilities left over from P-L2_13).
import test from "node:test";
import assert from "node:assert/strict";
import { FLAG_DEFAULT, bindSandboxStopper, flagOn, wrappedRuntimeKey } from "../handlers/extra/config.ts";
import { extraHandlers } from "../handlers/extra/index.ts";
import { NEEDS_SANDBOX, providerState } from "../handlers/extra/models.ts";
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
  assert.equal(open.providers.length, 11, "ten engines and the custom endpoint driver");
  assert.deepEqual([row("custom")?.kind, row("custom")?.title], ["api", "A custom endpoint"]);

  await H["engine.policy.set"](ctx, { labelProviders: { restricted: ["anthropic"] } });
  const restricted = await H["engine.providers.list"](ctx, { threadId: "thr_x" });
  assert.equal(restricted.providers.find((p) => p.driver === "anthropic")?.allowed, true);
  const openai = restricted.providers.find((p) => p.driver === "openai");
  assert.equal(openai?.allowed, false);
  assert.match(openai?.reason ?? "", /restricted records may not go/);
});

test("providers.list: where CLI engines cannot be sandboxed, a connected CLI account says what it needs and is not offered; API engines are unchanged", () => {
  const rows = [{ id: "p1", providerKey: "anthropic", name: "Claude Code", connection: "subscription", scope: "mine", itemId: "i1", engine: "claude-code", spaceMayUse: false, state: "ok" }] as never;
  const policy = { allowedAccounts: "any", allowedModels: [], allowedProviders: [], labelProviders: {} } as never;
  const cli = providerState("claude_code", rows, policy, undefined, NEEDS_SANDBOX);
  assert.deepEqual([cli.connected, cli.allowed, cli.reason], [true, false, NEEDS_SANDBOX]);
  assert.match(NEEDS_SANDBOX, /^Needs .*\. Use an API key/);
  assert.equal(providerState("anthropic", rows, policy, undefined, NEEDS_SANDBOX).allowed, true);
  assert.equal(providerState("claude_code", rows, policy, undefined, null).allowed, true, "a computer that can sandbox offers it");
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
  assert.equal(h.named("engine.runtime_opt_in_changed").length, 0, "it was already on by default: storing the key changes nothing anyone sees");
  assert.deepEqual(H["engine.runtime.opt_in"](h.ctx, { enabled: false }), { enabled: false });
  assert.equal(wrappedRuntimeKey(h.ctx, "usr_dana"), null, "turning it off deletes the key");
  assert.equal(h.named("engine.runtime_opt_in_changed").length, 1);
  assert.ok(!JSON.stringify(h.emitted).includes("ciphertext"), "no key material in any event");
  assert.deepEqual(assertEventsConform(h), []);
});

test("Let the Space continue my chats when my computer is off is on by default (owner ruling, 3 Nov); a person who turned it off stays off", () => {
  const h = harness();
  assert.deepEqual(FLAG_DEFAULT, { subscription_share: false, runtime_opt_in: true });
  assert.equal(flagOn(h.ctx, "usr_dana", "runtime_opt_in"), true, "never set: on");
  assert.equal(flagOn(h.ctx, "usr_never_seen", "runtime_opt_in"), true, "anyone who never chose: on");
  assert.equal(flagOn(h.ctx, "usr_dana", "subscription_share"), false, "the other switch keeps its own default");
  H["engine.runtime.opt_in"](h.ctx, { enabled: false });
  assert.equal(flagOn(h.ctx, "usr_dana", "runtime_opt_in"), false, "their own choice is kept");
  assert.equal(h.named("engine.runtime_opt_in_changed").length, 1);
  assert.equal(flagOn(h.ctx, "usr_never_seen", "runtime_opt_in"), true, "one person's choice is theirs alone");
});

test("the opt-in has no Settings toggle until sealed chats ship: the Models and usage screen offers no runtime action, and no app code calls it", async () => {
  const { screens } = await import("../../../generated/screens.ts");
  const caps = screens.flatMap((sc) => Object.values(sc.actions).map((a) => `${sc.id}:${a.cap}`));
  assert.ok(screens.some((sc) => sc.id === "settings.models-usage"), "the screen is still there");
  assert.deepEqual(caps.filter((c) => c.endsWith(":engine.runtime.opt_in")), []);
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("../../../apps/app/src/", import.meta.url).pathname;
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const at = join(dir, name);
      if (statSync(at).isDirectory()) walk(at);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && readFileSync(at, "utf8").includes("engine.runtime.opt_in")) hits.push(at);
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
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
  assert.match(text, /Agent-to-agent hops before a person must reply: 8/);
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
  // a person named who is in the chat is addressed: no agent replies, and the lead is offered (7e9d7acba)
  assert.equal((await H["engine.route.preview"](ctx, { threadId: "thr_1", mentions: [{ kind: "person", id: "usr_sam" }] })).line, "Goes to the person you named; no agent will reply. Ask Intake too");
  // a person named who is not in the chat is only a reference: the lead still answers
  const members = withRoutes(h, { "threads.get": () => ({ thread: { members: [{ kind: "person", id: "usr_dana" }], agents: [{ agentId: "agt_intake", mode: "lead", name: "Intake" }] } }) });
  assert.deepEqual(await H["engine.route.preview"](members, { threadId: "thr_1", mentions: [{ kind: "person", id: "usr_sam" }] }), { responders: ["agt_intake"], line: "Intake will reply" });
  // no agent in the chat at all: the composer asks for a mention
  const none = withRoutes(h, { "threads.get": () => ({ thread: { agents: [] } }) });
  assert.equal((await H["engine.route.preview"](none, { threadId: "thr_1" })).line, "No agent will reply. @mention one");
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

