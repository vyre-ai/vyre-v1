// The composer's model menu reading the live lists (live-models.ts): the saved list at once, the fresh one swapped in, the vendor's default marked, an alias picked as its model, the quiet line.
import test from "node:test";
import assert from "node:assert/strict";
import { listedLine, loadMenuModels, menuModels, pickedRow, pickUnavailable } from "./live-models.ts";
import type { MenuModel, ModelsOut } from "./live-models.ts";

const NOW = Date.UTC(2026, 10, 3, 12, 0);
const saved: ModelsOut = {
  models: [{ model: "gpt-6.1-sol", title: "GPT-6.1-Sol", allowed: true, isDefault: true }, { model: "gpt-5.5", title: "GPT-5.5", allowed: true }],
  listed: { source: "saved", updatedAt: NOW - 3_600_000, refreshing: true, failed: false },
};
const fresh: ModelsOut = {
  models: [{ model: "gpt-7-nova", title: "GPT-7-Nova", allowed: true, isDefault: true, efforts: ["low", "medium", "high"] }, { model: "gpt-6.1-sol", title: "GPT-6.1-Sol", allowed: true }],
  listed: { source: "live", updatedAt: NOW, refreshing: false, failed: false },
};

test("the menu shows the saved list at once and swaps in the vendor's new model when the refresh comes back", async () => {
  const calls: Record<string, unknown>[] = [];
  const shown: [string[], string | undefined][] = [];
  await loadMenuModels((cap, input) => { calls.push({ cap, ...(input as object) }); return calls.length === 1 ? saved : fresh; }, { accountRef: "#Dana_Codex" }, (m, line) => shown.push([m.map((x) => x.title), line]), () => true, () => NOW);
  assert.deepEqual(calls, [{ cap: "engine.models.list", accountRef: "#Dana_Codex", refresh: true }, { cap: "engine.models.list", accountRef: "#Dana_Codex", wait: true }]);
  assert.deepEqual(shown, [[["GPT-6.1-Sol", "GPT-5.5"], undefined], [["GPT-7-Nova", "GPT-6.1-Sol"], "Updated just now"]]);
});

test("a list that is not refreshing is read once; a closed menu drops what comes after; a failed second call keeps the first", async () => {
  let n = 0;
  await loadMenuModels(() => { n += 1; return { ...saved, listed: { ...saved.listed!, refreshing: false } }; }, {}, () => undefined, () => true);
  assert.equal(n, 1);
  const shown: string[][] = [];
  let open = true;
  await loadMenuModels((_c, i) => { if ((i as { wait?: boolean }).wait) { open = false; return fresh; } return saved; }, {}, (m) => shown.push(m.map((x) => x.id)), () => open);
  assert.deepEqual(shown, [["gpt-6.1-sol", "gpt-5.5"]], "the menu closed before the fresh list came");
  const kept: string[][] = [];
  await loadMenuModels((_c, i) => { if ((i as { wait?: boolean }).wait) throw new Error("gone"); return saved; }, {}, (m) => kept.push(m.map((x) => x.id)), () => true);
  assert.deepEqual(kept, [["gpt-6.1-sol", "gpt-5.5"]]);
});

test("the quiet line: just updated, couldn't refresh, or nothing", () => {
  assert.equal(listedLine({ source: "live", refreshing: false, failed: false }), "Updated just now");
  assert.equal(listedLine({ source: "saved", refreshing: false, failed: true }), "Couldn't refresh, showing saved list");
  assert.equal(listedLine({ source: "shipped", refreshing: false, failed: true }), "Couldn't refresh, showing saved list");
  assert.equal(listedLine({ source: "saved", refreshing: false, failed: false }), undefined);
  assert.equal(listedLine({ source: "live", refreshing: true, failed: false }), undefined, "while a refresh runs it says nothing");
  assert.equal(listedLine(undefined), undefined);
});

test("rows: the vendor's names, its default marked Default, usage greying kept, and an alias picked as the model it means", () => {
  const rows = menuModels({ models: [
    { model: "claude-opus-6", title: "Opus 6", allowed: true, alias: "opus", isDefault: true, efforts: ["low", "high"] },
    { model: "claude-sonnet-5-5", title: "Sonnet 5.5", allowed: false, reason: "usage_limit", resetsAt: NOW - 1, alias: "sonnet" },
    { model: "auto", title: "Auto", allowed: true },
  ] }, NOW);
  assert.deepEqual(rows.map((r: MenuModel) => [r.title, r.note ?? null, r.allowed, r.reason ?? null]), [["Opus 6", "Default", true, null], ["Sonnet 5.5", null, false, "Out of usage for now"], ["Auto", "Picks per message", true, null]]);
  assert.ok(rows.every((r) => !/latest/i.test(r.title)));
  assert.deepEqual(rows[0]?.efforts, ["low", "high"]);
  assert.equal(pickedRow(rows, "opus"), "claude-opus-6");
  assert.equal(pickedRow(rows, "claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(pickedRow(rows, "gpt-x"), "gpt-x");
  assert.equal(pickedRow(null, "opus"), "opus");
});

test("a remembered pick that cannot run here is unavailable: greyed by the list, or missing from a live list; Auto, no pick and a partial saved list say nothing", () => {
  const live = (models: ModelsOut["models"]): ModelsOut => ({ models, listed: { source: "live", refreshing: false, failed: false } });
  const sonnet = { model: "claude-sonnet-5-5", title: "Sonnet 5.5", allowed: true, alias: "sonnet" };
  assert.equal(pickUnavailable(live([{ ...sonnet, allowed: false, reason: "not_connected" }]), "claude-sonnet-5-5"), true, "greyed in the list");
  assert.equal(pickUnavailable(live([sonnet]), "claude-sonnet-5-5"), false, "allowed");
  assert.equal(pickUnavailable(live([sonnet]), "sonnet"), false, "an alias resolves to its row");
  assert.equal(pickUnavailable(live([{ model: "glm-5.3", title: "GLM 5.3", allowed: true }]), "claude-sonnet-5-5"), true, "a live list without it");
  assert.equal(pickUnavailable({ models: [{ model: "glm-5.3", title: "GLM 5.3", allowed: true }], listed: { source: "saved", refreshing: false, failed: false } }, "claude-sonnet-5-5"), false, "a saved list is not complete");
  assert.equal(pickUnavailable(live([]), "claude-sonnet-5-5"), false, "an empty list says nothing");
  for (const pick of [undefined, null, "", "auto"]) assert.equal(pickUnavailable(live([sonnet]), pick), false);
  assert.equal(pickUnavailable(undefined, "claude-sonnet-5-5"), false);
});

test("a model still being checked is a greyed row that says Checking...", () => {
  const rows = menuModels({ models: [{ model: "glm-5.3", title: "GLM 5.3", allowed: false, reason: "checking" }, { model: "ok", title: "Ok", allowed: true }] });
  assert.deepEqual(rows.map((r) => [r.id, r.allowed, r.reason]), [["glm-5.3", false, "Checking..."], ["ok", true, undefined]]);
});

test("a model being checked, or not checked, is a row the person can pick, with its state as the note", () => {
  const rows = menuModels({ models: [
    { model: "a", title: "A", allowed: true, reason: "checking" },
    { model: "b", title: "B", allowed: true, reason: "not_checked" },
    { model: "c", title: "C", allowed: false, reason: "usage_limit" },
  ] });
  assert.deepEqual(rows.map((r) => [r.id, r.allowed, r.reason, r.note]), [["a", true, undefined, "Checking..."], ["b", true, undefined, "Not checked"], ["c", false, "Out of usage for now", undefined]]);
});
