// The Vault list's speed, split from vault-layout.test.tsx: a speed budget counts only on the v1-perf runners (ruling 46, test/slow.json "perf": true), where a shared CI shard's load
// cannot move it. 10,000 keys filter and count inside the 100 ms complete-paint budget, and the list draws only a window of rows.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Vault from "../layout/index.tsx";
import { createSampleVault, northwind } from "../layout/sample.ts";
import type { SampleVault } from "../layout/sample.ts";
import { visibleItems, countItems } from "../layout/model.ts";
import type { Item } from "../layout/model.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const html = (v: SampleVault): string => clean(renderToStaticMarkup(<Vault data={v.data} />));
const has = (s: string, needle: string): boolean => s.includes(needle);
const queryOf = <T,>(v: SampleVault, screen: string, name: string, state: Record<string, unknown> = {}): T => {
  const snap = v.data.screens.query(screen, name, state).getSnapshot();
  assert.equal(snap.status, "ready");
  return (snap as { data: T }).data;
};

test("speed: 10,000 keys filter and count fast and the list renders only a window", async () => {
  const v = createSampleVault(northwind, { extraItems: 10_000 });
  const items = queryOf<{ items: Item[] }>(v, "vault.layout", "items").items;
  assert.equal(items.length, 10_016);
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); visibleItems(items, { kind: "keys" }, "sample", new Set(), new Set()); countItems(items, new Set(), null, 0); samples.push(performance.now() - t0); }
  samples.sort((a, b) => a - b);
  assert.ok(samples[1]! < 100, `median filter plus count ${samples[1]!.toFixed(1)} ms is under the 100 ms complete-paint budget`);
  const out = html(v);
  const rowsDrawn = out.split('data-testid="row-vit_').length - 1;
  assert.ok(rowsDrawn > 5 && rowsDrawn < 60, `only a window of rows is drawn (${rowsDrawn})`);
  assert.ok(has(out, "10016"), "the count is the whole list");
});
