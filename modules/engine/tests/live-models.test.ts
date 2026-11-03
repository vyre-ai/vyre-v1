// The live model lists of subscription engines in engine.models.list (modules/engine/live-models.ts): saved per account, refreshed when the menu opens (stale-while-revalidate) and once a day,
// the saved list or the release's shipped one when a refresh fails, the vendor's names and default, an alias that resolves, and usage greying as before.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { modelsList } from "../handlers/extra/models.ts";
import { recordModelLimit } from "../handlers/usage.ts";
import { DAY_MS, RETRY_GAP_MS, bindModelLister, resetLiveModels, resolvePick, shippedModels } from "../live-models.ts";
import type { LiveModel, ModelLister } from "../live-models.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const sub = (o: Record<string, unknown>) => ({ connection: "subscription", scope: "mine", spaceMayUse: false, state: "ok", ...o });
const CODEX = sub({ id: "prv_x", providerKey: "codex", name: "Codex", engine: "codex", handle: "#Dana_Codex", itemId: "vit_x" });
const CLAUDE = sub({ id: "prv_c", providerKey: "claude-code", name: "Claude Code", engine: "claude-code", handle: "#Dana_Claude", itemId: "vit_c" });

/** A lister standing in for the engines: what it answers per driver, how many times it ran, and a gate a test holds to keep a refresh in flight. */
function fakeLister(lists: Partial<Record<string, LiveModel[] | Error>>) {
  const runs: { ref: string; driver: string; asker: string }[] = [];
  let release: () => void = () => undefined;
  let gate: Promise<void> | null = null;
  const lister: ModelLister = async (account, asker) => {
    runs.push({ ref: account.ref, driver: account.driver, asker });
    if (gate) await gate;
    const got = lists[account.driver];
    if (got instanceof Error) throw got;
    return got ?? [];
  };
  return { lister, runs, hold() { gate = new Promise((r) => { release = () => { gate = null; r(); }; }); }, release: () => release() };
}

function setup(providers: unknown[]) {
  resetLiveModels();
  const h = harness();
  const ctx: EngineCtx = { ...h.ctx, call: async (cap: string, input: unknown) => (cap === "providers.list" ? { providers } : cap === "providers.test" ? { ok: true, models: [] } : h.ctx.call(cap, input)) };
  return { h, ctx };
}

const NEW_CODEX: LiveModel[] = [
  { id: "gpt-7-nova", title: "GPT-7-Nova", isDefault: true, efforts: ["low", "medium", "high", "max"], defaultEffort: "medium" },
  { id: "gpt-6.1-sol", title: "GPT-6.1-Sol" },
];

test("the menu opens on the saved list at once; the refresh it starts brings the vendor's new model in as its own row, by the vendor's name", async () => {
  const { h, ctx } = setup([CODEX]);
  const f = fakeLister({ codex: NEW_CODEX });
  bindModelLister(f.lister);
  try {
    f.hold();
    const first = await modelsList(ctx, { accountRef: "#Dana_Codex", refresh: true });
    assert.deepEqual(first.models.map((m) => m.model), shippedModels("codex").map((m) => m.id), "nothing saved yet: the shipped list answers, without waiting on the engine");
    assert.deepEqual(first.listed, { source: "shipped", refreshing: true, failed: false });
    assert.equal(first.models[0]?.isDefault, true);
    assert.deepEqual(contractErrors("engine.models.list", "out", first), []);
    f.release();
    const second = await modelsList(ctx, { accountRef: "#Dana_Codex", wait: true });
    assert.deepEqual(second.models.map((m) => [m.model, m.title, m.isDefault === true]), [["gpt-7-nova", "GPT-7-Nova", true], ["gpt-6.1-sol", "GPT-6.1-Sol", false]], "the vendor's order and names");
    assert.deepEqual(second.models[0]?.efforts, ["low", "medium", "high", "max"]);
    assert.equal(second.models[0]?.defaultEffort, "medium");
    assert.deepEqual(second.models[1]?.efforts, shippedModels("codex").find((m) => m.id === "gpt-6.1-sol")?.efforts, "what the CLI left out is filled from the shipped catalog");
    assert.deepEqual(second.listed, { source: "live", updatedAt: h.clock.t, refreshing: false, failed: false });
    assert.deepEqual(contractErrors("engine.models.list", "out", second), []);
    assert.deepEqual(f.runs, [{ ref: "#Dana_Codex", driver: "codex", asker: "usr_dana" }], "one run, as the person, on their account");
    assert.equal(h.rows("SELECT account_ref FROM engine_model_cache").length, 1, "saved per account");
  } finally { bindModelLister(null); }
});

test("opening the menu again a moment later does not run the engine again; a day later it does even without asking", async () => {
  const { h, ctx } = setup([CODEX]);
  const f = fakeLister({ codex: NEW_CODEX });
  bindModelLister(f.lister);
  try {
    await modelsList(ctx, { accountRef: "#Dana_Codex", refresh: true, wait: true });
    await modelsList(ctx, { accountRef: "#Dana_Codex", refresh: true, wait: true });
    assert.equal(f.runs.length, 1);
    h.advance(RETRY_GAP_MS + 1);
    await modelsList(ctx, { accountRef: "#Dana_Codex", refresh: true, wait: true });
    assert.equal(f.runs.length, 2, "a later opening refreshes");
    await modelsList(ctx, { accountRef: "#Dana_Codex" });
    assert.equal(f.runs.length, 2, "a read that is not the menu opening uses the saved list");
    h.advance(DAY_MS + 1);
    const daily = await modelsList(ctx, { accountRef: "#Dana_Codex", wait: true });
    assert.equal(f.runs.length, 3, "a list a day old is refreshed at the next read");
    assert.equal(daily.listed?.source, "live");
  } finally { bindModelLister(null); }
});

test("a refresh that fails keeps the saved list and says so; with nothing saved the shipped list answers", async () => {
  const { h, ctx } = setup([CODEX]);
  const lists: Partial<Record<string, LiveModel[] | Error>> = { codex: NEW_CODEX };
  bindModelLister(fakeLister(lists).lister);
  try {
    await modelsList(ctx, { accountRef: "#Dana_Codex", refresh: true, wait: true });
    lists.codex = new Error("network down");
    h.advance(RETRY_GAP_MS + 1);
    const kept = await modelsList(ctx, { accountRef: "#Dana_Codex", refresh: true, wait: true });
    assert.deepEqual(kept.models.map((m) => m.model), ["gpt-7-nova", "gpt-6.1-sol"], "the saved list stays");
    assert.equal(kept.listed?.source, "saved");
    assert.equal(kept.listed?.failed, true);

    const fresh = setup([CLAUDE]);
    bindModelLister(fakeLister({ claude_code: new Error("offline") }).lister);
    const shipped = await modelsList(fresh.ctx, { accountRef: "#Dana_Claude", refresh: true, wait: true });
    assert.deepEqual(shipped.models.map((m) => m.model), shippedModels("claude_code").map((m) => m.id), "a fresh install with no network still shows current models");
    assert.deepEqual(shipped.listed, { source: "shipped", refreshing: false, failed: true });
    assert.ok(shipped.models.every((m) => !/latest/i.test(m.title)), "every row names its model");

    const none = setup([CLAUDE]);
    bindModelLister(null);
    const noRuntime = await modelsList(none.ctx, { accountRef: "#Dana_Claude", refresh: true, wait: true });
    assert.equal(noRuntime.models.length, shippedModels("claude_code").length, "no runtime to run engines: the shipped list, never an empty menu");
  } finally { bindModelLister(null); }
});

test("an alias resolves to the model it means today, and a pick saved as the alias is greyed when that model runs out", async () => {
  const live: LiveModel[] = [
    { id: "claude-opus-6", title: "Opus 6", alias: "opus", isDefault: true, efforts: ["low", "medium", "high", "max"] },
    { id: "claude-sonnet-5-5", title: "Sonnet 5.5", alias: "sonnet" },
  ];
  assert.equal(resolvePick(live, "opus"), "claude-opus-6");
  assert.equal(resolvePick(live, "claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(resolvePick(live, "claude-unknown-9"), "claude-unknown-9", "an id the list does not know passes through to the CLI as it is");
  const { h, ctx } = setup([CLAUDE]);
  bindModelLister(fakeLister({ claude_code: live }).lister);
  try {
    await modelsList(ctx, { accountRef: "#Dana_Claude", refresh: true, wait: true });
    recordModelLimit(h.db, "#Dana_Claude", "opus", h.clock.t + 3_600_000, h.clock.t);
    recordModelLimit(h.db, "#Dana_Claude", "claude-sonnet-5-5", undefined, h.clock.t);
    const out = await modelsList(ctx, { accountRef: "#Dana_Claude" });
    const by = Object.fromEntries(out.models.map((m) => [m.model, m]));
    assert.deepEqual([by["claude-opus-6"]?.allowed, by["claude-opus-6"]?.reason, by["claude-opus-6"]?.resetsAt], [false, "usage_limit", h.clock.t + 3_600_000], "greyed under the alias it ran out as");
    assert.deepEqual([by["claude-sonnet-5-5"]?.allowed, by["claude-sonnet-5-5"]?.reason], [false, "usage_limit"], "greyed under its own id");
    assert.equal(by["claude-opus-6"]?.alias, "opus");
    assert.equal(by["claude-opus-6"]?.title, "Opus 6");
  } finally { bindModelLister(null); }
});

test("an API key's models still come from the provider's own list, and a signed-out subscription is still one greyed row", async () => {
  const { ctx } = setup([
    { id: "prv_a", providerKey: "anthropic", name: "Anthropic", connection: "api_key", scope: "mine", engine: "anthropic", spaceMayUse: false, state: "ok", handle: "#Dana_Anthropic", itemId: "vit_a" },
    { ...CODEX, state: "needs_sign_in" },
  ]);
  const f = fakeLister({ codex: NEW_CODEX });
  bindModelLister(f.lister);
  try {
    const h2 = { ...ctx, call: async (cap: string, input: unknown) => (cap === "providers.test" ? { ok: true, models: ["claude-sonnet-5-5"] } : ctx.call(cap, input)) };
    const out = await modelsList(h2, { refresh: true });
    assert.deepEqual(out.models.map((m) => [m.model, m.allowed, m.reason ?? null]), [["claude-sonnet-5-5", true, null], ["codex", false, "not_connected"]]);
    assert.equal(out.listed, undefined, "no subscription engine listed: nothing to say about freshness");
    assert.equal(f.runs.length, 0, "a signed-out account runs nothing");
  } finally { bindModelLister(null); }
});

test("the release ships a list per engine, and the Vault's provider files offer the same ids", () => {
  for (const [key, driver] of [["codex", "codex"], ["claude-code", "claude_code"], ["grok", "grok"]] as const) {
    const def = JSON.parse(readFileSync(new URL(`../../vault/providers/${key}.json`, import.meta.url), "utf8")) as { models: string[]; modelsSource: string };
    const ship = shippedModels(driver);
    assert.ok(ship.length > 0 && ship.filter((m) => m.isDefault).length === 1, `${driver} ships a list with one default`);
    assert.deepEqual(def.models, ship.map((m) => m.id), key);
    assert.equal(def.modelsSource, "engine", `${key} lists its models from the engine`);
    assert.ok(ship.every((m) => m.title !== "" && !/latest/i.test(m.title)));
  }
});
