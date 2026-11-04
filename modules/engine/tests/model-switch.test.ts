// A model an account does not serve (owner bug, rc.20, Beam Free): the swap picks the next model (same provider, last pick, Space default), says one quiet line, takes the model off that account's list
// until it works again, moves the person's last pick to the model that answered, and with nothing left ends with the plain code.
import test from "node:test";
import assert from "node:assert/strict";
import { candidates, createModelSwitch, modelSwapLine, NO_MODEL_WORKS } from "../model-switch.ts";
import { REST_MS, clearUnavailable, markUnavailable, unavailableFor } from "../model-health.ts";
import { recallPick, rememberPick } from "../last-pick.ts";
import { modelsList } from "../handlers/extra/models.ts";
import { resetLiveModels } from "../live-models.ts";
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
  assert.deepEqual(candidates(rows, { model: "beam-free", provider: "opencode_go" }, null).map((r) => r.model), ["glm-5.3", "claude-sonnet-5-5"]);
  assert.deepEqual(candidates(rows.filter((r) => r.model !== "glm-5.3"), { model: "beam-free", provider: "opencode_go" }, "claude-sonnet-5-5").map((r) => r.model), ["claude-sonnet-5-5"]);
  assert.deepEqual(candidates(rows, { model: "claude-sonnet-5-5", provider: "anthropic" }, null).map((r) => r.model), ["beam-free", "glm-5.3"].sort((a) => (a === "glm-5.3" ? -1 : 1)));
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
  assert.equal(s.posts[0]!.blocks[0]!.data.text, "Beam Free isn't available right now, so GLM 5.3 answered. It's off your list until it works again.");
  assert.equal(modelSwapLine("A", "B"), "A isn't available right now, so B answered. It's off your list until it works again.");
  assert.doesNotMatch(s.posts[0]!.blocks[0]!.data.text, /—|--|beam-free|glm-5\.3/);
  assert.deepEqual([...unavailableFor(s.h.ctx.db, "#A", 5_000)], ["beam-free"]);
  assert.equal(recallPick(s.h.ctx.db, "dana", "intake")?.model, "glm-5.3");
});

test("a model no account can pay for is passed over; with none left the turn ends with the plain code and says nothing in the chat", async () => {
  const some = setup((m) => m === "claude-sonnet-5-5");
  assert.ok(await some.sw(q));
  assert.equal(some.model(), "claude-sonnet-5-5");
  assert.match(some.posts[0]!.blocks[0]!.data.text, /Claude Sonnet 5.5 answered/);
  const none = setup(() => false);
  await assert.rejects(() => none.sw(q), (e: { code?: string; message: string }) => e.code === NO_MODEL_WORKS && e.message === "None of your AI accounts can answer right now.");
  assert.equal(none.posts.length, 0);
});
