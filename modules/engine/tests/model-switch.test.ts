// A model an account does not serve (owner bug, rc.20, Beam Free): the swap picks the next model (same provider, last pick, Space default), says one quiet line, takes the model off that account's list
// until it works again, moves the person's last pick to the model that answered, and with nothing left ends with the plain code.
import test from "node:test";
import assert from "node:assert/strict";
import { candidates, createModelSwitch, modelSwapLine, NO_MODEL_WORKS } from "../model-switch.ts";
import { REST_MS, clearUnavailable, confirmedFor, forgetAll, forgetProvider, markConfirmed, noteAccount, markUnavailable, probing, resetProbes, unavailableFor } from "../model-health.ts";
import { bindCompleter } from "../runtime.ts";
import { recallPick, recentPicks, rememberPick } from "../last-pick.ts";
import { modelsList, probePick } from "../handlers/extra/models.ts";
import { bindModelLister, resetLiveModels } from "../live-models.ts";
import { harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const OPENCODE = { id: "prv_o", providerKey: "opencode_go", name: "OpenCode", connection: "api_key", scope: "mine", spaceMayUse: false, state: "ok", engine: "opencode-go", handle: "#Dana_Opencode", itemId: "vit_o" };
const rows = [
  { provider: "opencode_go", model: "beam-free", title: "Beam Free", allowed: true },
  { provider: "opencode_go", model: "glm-5.3", title: "GLM 5.3", allowed: true, isDefault: true },
  { provider: "anthropic", model: "claude-sonnet-5-5", title: "Claude Sonnet 5.5", allowed: true },
  { provider: "anthropic", model: "claude-haiku-5-5", title: "Claude Haiku 5.5", allowed: false },
];

test("the order: same provider first, then the last other pick, then the default", () => {
  assert.deepEqual(candidates(rows, { model: "beam-free", provider: "opencode_go" }, []).map((r) => r.model), ["glm-5.3", "claude-sonnet-5-5"]);
  assert.deepEqual(candidates(rows.filter((r) => r.model !== "glm-5.3"), { model: "beam-free", provider: "opencode_go" }, ["claude-sonnet-5-5"]).map((r) => r.model), ["claude-sonnet-5-5"]);
  assert.deepEqual(candidates(rows, { model: "claude-sonnet-5-5", provider: "anthropic" }, []).map((r) => r.model), ["beam-free", "glm-5.3"].sort((a) => (a === "glm-5.3" ? -1 : 1)));
});

test("the mark hides a model from one account, ends by itself, and clears when the model works", () => {
  const h = harness();
  markUnavailable(h.ctx.db, "#A", "beam-free", 1000);
  assert.deepEqual([...unavailableFor(h.ctx.db, "#A", 2000)], ["beam-free"]);
  assert.deepEqual([...unavailableFor(h.ctx.db, "#B", 2000)], [], "another account still serves it");
  assert.deepEqual([...unavailableFor(h.ctx.db, "#A", 1000 + REST_MS + 1)], [], "it is tried again later");
  clearUnavailable(h.ctx.db, "#A", "beam-free");
  assert.deepEqual([...unavailableFor(h.ctx.db, "#A", 2000)], []);
});

test("the picker leaves out a model its account refused", async () => {
  resetLiveModels();
  const h = harness();
  const ctx: EngineCtx = { ...h.ctx, call: async (cap: string, input: unknown) => (cap === "providers.list" ? { providers: [OPENCODE] } : cap === "providers.test" ? { ok: true, models: ["beam-free", "glm-5.3"] } : h.ctx.call(cap, input)) };
  assert.deepEqual((await modelsList(ctx, {})).models.map((m) => m.model), ["beam-free", "glm-5.3"]);
  markUnavailable(ctx.db, "#Dana_Opencode", "beam-free", ctx.now());
  assert.deepEqual((await modelsList(ctx, {})).models.map((m) => m.model), ["glm-5.3"]);
});

function setup(accountFor: (model: string | undefined) => boolean) {
  const h = harness();
  let model: string | undefined = "beam-free";
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const posts: Array<{ blocks: Array<{ data: { text: string } }> }> = [];
  const sw = createModelSwitch({
    db: h.ctx.db, now: () => 5_000,
    call: async (cap, input) => {
      calls.push({ cap, input: input as Record<string, unknown> });
      if (cap === "threads.get") return { thread: { agents: [{ agentId: "intake", model, provider: "opencode_go" }] } };
      if (cap === "engine.models.list") return { models: rows };
      if (cap === "engine.set_model") { model = (input as { model: string }).model; rememberPick(h.ctx.db, "dana", "intake", { model, provider: (input as { provider: string }).provider, effort: null }, 5_000); return {}; }
      return {};
    },
    accountFor: async () => (accountFor(model) ? { ref: "#B", driver: "x", provider: "x", kind: "api_key", payer: "dana", reason: "starter" } : null),
    postAs: async (_a, post) => { posts.push(post as never); return {} as never; },
  });
  return { h, sw, calls, posts, model: () => model };
}
const q = { threadId: "T", agentId: "intake", askerId: "dana", account: { ref: "#A", driver: "x", provider: "x", kind: "api_key" as const, payer: "dana", reason: "starter" as const }, message: "There's an issue with the selected model (beam-free)." };

test("a refused model: the next one answers, one quiet line, the model is off the list, and the last pick moves", async () => {
  const s = setup(() => true);
  const got = await s.sw(q);
  assert.equal(got?.ref, "#B");
  assert.equal(s.model(), "glm-5.3", "the same provider is tried first");
  assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0]!.blocks[0]!.data.text, "Beam Free isn't available on this account, so this reply used GLM 5.3.");
  assert.equal(modelSwapLine("A", "B"), "A isn't available on this account, so this reply used B.");
  assert.doesNotMatch(s.posts[0]!.blocks[0]!.data.text, /—|--|beam-free|glm-5\.3/);
  assert.deepEqual([...unavailableFor(s.h.ctx.db, "#A", 5_000)], ["beam-free"]);
  assert.equal(recallPick(s.h.ctx.db, "dana", "intake")?.model, "glm-5.3");
});

test("a model no account can pay for is passed over; with none left the turn ends with the plain code and says nothing in the chat", async () => {
  const some = setup((m) => m === "claude-sonnet-5-5");
  assert.ok(await some.sw(q));
  assert.equal(some.model(), "claude-sonnet-5-5");
  assert.match(some.posts[0]!.blocks[0]!.data.text, /this reply used Claude Sonnet 5.5\.$/);
  const none = setup(() => false);
  await assert.rejects(() => none.sw(q), (e: { code?: string; message: string }) => e.code === NO_MODEL_WORKS && e.message === "None of your AI accounts can answer right now.");
  assert.equal(none.posts.length, 0);
});

test("the pick history keeps the last three distinct models, newest first, and the fallback walks back through them", () => {
  const h = harness();
  for (const [i, m] of ["a", "b", "a", "c", "d"].entries()) rememberPick(h.ctx.db, "dana", "intake", { model: m, provider: null, effort: null }, 100 + i);
  assert.deepEqual(recentPicks(h.ctx.db, "dana"), ["d", "c", "a"]);
  assert.deepEqual(recentPicks(h.ctx.db, "sam"), []);
  const more = [{ provider: "p", model: "a", allowed: true }, { provider: "p", model: "c", allowed: true }, { provider: "q", model: "z", allowed: true }];
  assert.deepEqual(candidates(more, { model: "d", provider: "other" }, ["d", "c", "a"]).map((r) => r.model), ["c", "a", "z"]);
});

test("a sign-in change forgets what was learned about the accounts' models", () => {
  const h = harness();
  markConfirmed(h.ctx.db, "#A", "m1", 1000);
  markUnavailable(h.ctx.db, "#B", "m2", 1000);
  assert.deepEqual([[...confirmedFor(h.ctx.db, "#A", 2000)], [...unavailableFor(h.ctx.db, "#B", 2000)]], [["m1"], ["m2"]]);
  noteAccount(h.ctx.db, "prv_a", "#A");
  noteAccount(h.ctx.db, "prv_b", "#B");
  assert.equal(forgetProvider(h.ctx.db, "prv_b"), "#B", "only the changed account is forgotten");
  assert.equal(forgetProvider(h.ctx.db, "prv_zzz"), null, "an account never read has nothing to forget");
  assert.deepEqual([[...confirmedFor(h.ctx.db, "#A", 2000)], [...unavailableFor(h.ctx.db, "#B", 2000)]], [["m1"], []]);
  forgetAll(h.ctx.db);
  assert.deepEqual([[...confirmedFor(h.ctx.db, "#A", 2000)], [...unavailableFor(h.ctx.db, "#B", 2000)]], [[], []]);
});

test("an API key's models are checked in the background: shown greyed as Checking until confirmed, a refused one never becomes a row, and the menu's second call gets the result", async () => {
  resetLiveModels(); resetProbes();
  bindCompleter(async () => ({ text: "ok", tokensIn: 1, tokensOut: 1 }));
  try {
    const h = harness();
    const asked: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const ctx: EngineCtx = {
      ...h.ctx,
      call: async (cap: string, input: unknown) => {
        if (cap === "providers.list") return { providers: [OPENCODE] };
        if (cap === "providers.test") return { ok: true, models: ["beam-free", "glm-5.3"] };
        if (cap === "engine.complete") {
          const m = (input as { model: string }).model;
          asked.push(m);
          await gate;
          if (m === "beam-free") throw new Error("There's an issue with the selected model (beam-free). It may not exist or you may not have access to it.");
          return { text: "ok" };
        }
        return h.ctx.call(cap, input);
      },
    };
    const first = await modelsList(ctx, { refresh: true });
    assert.deepEqual(first.models.map((m) => [m.model, m.allowed, m.reason]), [["beam-free", true, "checking"], ["glm-5.3", true, "checking"]]);
    assert.equal(first.listed?.refreshing, true, "the menu asks again");
    release();
    const second = await modelsList(ctx, { wait: true });
    assert.deepEqual(second.models.map((m) => [m.model, m.allowed, m.reason]), [["glm-5.3", true, undefined]]);
    assert.deepEqual(asked.sort(), ["beam-free", "glm-5.3"], "one tiny request each");
    // checked once: opening the menu again asks nobody
    await modelsList(ctx, { refresh: true });
    assert.equal(asked.length, 2);
  } finally { bindCompleter(null); resetProbes(); }
});

test("a failure that says nothing about the model (a rate limit) confirms it; no completer, no checks", async () => {
  resetLiveModels(); resetProbes();
  const h = harness();
  const mk = (limited: boolean): EngineCtx => ({ ...h.ctx, call: async (cap: string, input: unknown) => (cap === "providers.list" ? { providers: [OPENCODE] } : cap === "providers.test" ? { ok: true, models: ["glm-5.3"] } : cap === "engine.complete" ? (limited ? Promise.reject(new Error("429 rate limit")) : { text: "ok" }) : h.ctx.call(cap, input)) });
  assert.deepEqual((await modelsList(mk(true), {})).models.map((m) => [m.model, m.allowed]), [["glm-5.3", true]], "without a completer nothing is checked");
  bindCompleter(async () => ({ text: "", tokensIn: 0, tokensOut: 0 }));
  try {
    const c = mk(true);
    await modelsList(c, { refresh: true });
    const done = await modelsList(c, { wait: true });
    assert.deepEqual(done.models.map((m) => [m.model, m.allowed]), [["glm-5.3", true]]);
  } finally { bindCompleter(null); resetProbes(); }
});

test("a CLI account's listed models are checked one at a time with the CLI's own one-shot, Beam Free-style refusals leave the list, and the rest stay", async () => {
  resetLiveModels(); resetProbes();
  const CODEX = { connection: "subscription", scope: "mine", spaceMayUse: false, state: "ok", id: "prv_x", providerKey: "codex", name: "Codex", engine: "codex", handle: "#Dana_Codex", itemId: "vit_x" };
  bindModelLister(async () => [{ id: "gpt-7-nova", title: "GPT-7-Nova" }, { id: "beam-free", title: "Beam Free" }, { id: "gpt-6.1-sol", title: "GPT-6.1-Sol" }]);
  bindCompleter(async () => ({ text: "ok", tokensIn: 1, tokensOut: 1 }));
  try {
    const h = harness();
    let live = 0, peak = 0;
    const asked: string[] = [];
    const ctx: EngineCtx = {
      ...h.ctx,
      call: async (cap: string, input: unknown) => {
        if (cap === "providers.list") return { providers: [CODEX] };
        if (cap === "engine.complete") {
          const m = (input as { model: string }).model;
          asked.push(m); live += 1; peak = Math.max(peak, live);
          await new Promise((r) => setTimeout(r, 5));
          live -= 1;
          if (m === "beam-free") throw new Error("engine.model_unavailable: There's an issue with the selected model (beam-free). It may not exist or you may not have access to it.");
          return { text: "ok" };
        }
        return h.ctx.call(cap, input);
      },
    };
    await modelsList(ctx, { refresh: true, wait: true });
    const first = await modelsList(ctx, { wait: true });
    const done = await modelsList(ctx, { wait: true });
    assert.deepEqual(done.models.map((m) => [m.model, m.allowed]).sort(), [["gpt-6.1-sol", true], ["gpt-7-nova", true]]);
    assert.ok(first.models.length >= 2);
    assert.equal(peak, 1, "one at a time per CLI");
    assert.deepEqual(asked.sort(), ["beam-free", "gpt-6.1-sol", "gpt-7-nova"]);
  } finally { bindCompleter(null); bindModelLister(null); resetProbes(); resetLiveModels(); }
});

test("a model that was never checked (past the cap, or still checking) and refused on its first turn: the next model answers, one quiet line, hidden for that account only", async () => {
  const s = setup(() => true);
  assert.equal(confirmedFor(s.h.ctx.db, "#A", 5_000).has("beam-free"), false, "never probed");
  assert.ok(await s.sw(q));
  assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0]!.blocks[0]!.data.text, "Beam Free isn't available on this account, so this reply used GLM 5.3.");
  assert.deepEqual([...unavailableFor(s.h.ctx.db, "#A", 5_000)], ["beam-free"]);
  assert.deepEqual([...unavailableFor(s.h.ctx.db, "#Other", 5_000)], [], "another account that serves it keeps it");
});

test("a picked model is checked at once, past the cap, and a refusal hides it", async () => {
  resetLiveModels(); resetProbes();
  const many = Array.from({ length: 30 }, (_, i) => `m-${String(i).padStart(2, "0")}`);
  bindCompleter(async () => ({ text: "ok", tokensIn: 1, tokensOut: 1 }));
  try {
    const h = harness();
    const asked: string[] = [];
    const ctx: EngineCtx = { ...h.ctx, call: async (cap: string, input: unknown) => {
      if (cap === "providers.list") return { providers: [OPENCODE] };
      if (cap === "providers.test") return { ok: true, models: many };
      if (cap === "engine.complete") { const m = (input as { model: string }).model; asked.push(m); if (m === "m-29") throw new Error("model_not_found"); return { text: "ok" }; }
      return h.ctx.call(cap, input);
    } };
    await modelsList(ctx, { refresh: true });   // saves the tested list; checks the first 12
    await Promise.all(probing(["#Dana_Opencode"]));
    asked.length = 0;
    assert.equal(confirmedFor(ctx.db, "#Dana_Opencode", ctx.now()).has("m-29"), false, "past the cap: not checked by the background run yet");
    await probePick(ctx, "m-29");
    await Promise.all(probing(["#Dana_Opencode"]));
    assert.deepEqual(asked, ["m-29"], "the picked model, and nothing else");
    assert.deepEqual([...unavailableFor(ctx.db, "#Dana_Opencode", ctx.now())], ["m-29"]);
  } finally { bindCompleter(null); resetProbes(); }
});

test("a check that fails because the Vault key is not on this node ends once for the whole account: one request, every model selectable and read as Not checked, no second try while it holds", async () => {
  resetLiveModels(); resetProbes();
  bindCompleter(async () => ({ text: "ok", tokensIn: 1, tokensOut: 1 }));
  try {
    const h = harness();
    const asked: string[] = [];
    const ctx: EngineCtx = {
      ...h.ctx,
      call: async (cap: string, input: unknown) => {
        if (cap === "providers.list") return { providers: [OPENCODE] };
        if (cap === "providers.test") return { ok: true, models: ["beam-free", "glm-5.3", "glm-5"] };
        if (cap === "engine.complete") { asked.push((input as { model: string }).model); throw Object.assign(new Error("Your Vault key is not on this server, so your sign-in cannot be opened."), { code: "engine.vault_locked" }); }
        return h.ctx.call(cap, input);
      },
    };
    await modelsList(ctx, { refresh: true });
    await Promise.all(probing(["#Dana_Opencode"]));
    const after = await modelsList(ctx, { refresh: true });
    assert.equal(asked.length, 1, "one failed read for the account, not one per model");
    assert.deepEqual(after.models.map((m) => [m.allowed, m.reason]), [[true, "not_checked"], [true, "not_checked"], [true, "not_checked"]]);
    assert.equal(after.listed?.refreshing ?? false, false, "nothing is checking any more");
    await modelsList(ctx, { refresh: true });
    assert.equal(asked.length, 1, "not asked again while Not checked holds");
  } finally { bindCompleter(null); resetProbes(); }
});

test("a check that takes too long is Not checked for that model, not Checking forever, and the model stays selectable", async () => {
  resetLiveModels(); resetProbes();
  const { probeModels, notCheckedFor, probing: inFlight } = await import("../model-health.ts");
  const h = harness();
  probeModels(h.ctx.db, "#Slow", ["m1"], () => new Promise<void>(() => undefined), () => 1000, { timeoutMs: 20 });
  await Promise.all(inFlight(["#Slow"]));
  assert.deepEqual([...notCheckedFor("#Slow", 1000).models], ["m1"]);
  assert.equal(confirmedFor(h.ctx.db, "#Slow", 1000).has("m1"), false, "a timeout confirms nothing");
  resetProbes();
});
