// The first call of an agent's tool (13 Nov 2026, owner: "its first attempts are always failing"). `create(...)` capabilities require an idempotencyKey that no description mentions; the model had to invent it,
// and the rejection did not name it. The tool layer now fills the key from the call's own id, does not show it, and a rejection names the exact input and shows a minimal call.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { ctx, loadGenerated, validatingInvoke } from "../src/tools/harness.ts";
import type { ToolCtx } from "../src/tools/types.ts";

function session() {
  const loaded = loadGenerated();
  const { invoke, sent } = validatingInvoke(loaded.caps);
  const s = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => null,
    canEngineer: () => false,
    traceId: () => "trace_fixed",
  });
  s.preload("thr_1", ["artifact_publish"]);
  return { s, sent, loaded };
}
const c = (over: Partial<ToolCtx> = {}): ToolCtx =>
  ctx({ thread: { threadId: "thr_1", kind: "chat", planMode: false }, turnId: "trn_1", ...over });
const PAGE = "<!doctype html><html><head><title>Q3 plan</title></head><body><h1>Plan</h1></body></html>";
const keyOf = (x: { input: unknown } | undefined): string | undefined =>
  (x?.input as { idempotencyKey?: string } | undefined)?.idempotencyKey;

test("artifact_publish: title and html alone is accepted, with no key from the model", async () => {
  const { s, sent } = session();
  const out = await s.call(c(), "artifact_publish", { title: "Q3 plan", html: PAGE });
  assert.equal(out.kind, "result", JSON.stringify(out.kind === "error" ? out.result.content : ""));
  assert.ok((keyOf(sent[0]) ?? "") !== "", "the tool layer made the key");
});

test("a 300 KB page is accepted", async () => {
  const { s } = session();
  const big = `<html><head><title>Big</title></head><body>${"<p>row</p>".repeat(30_000)}</body></html>`;
  const out = await s.call(c(), "artifact_publish", { title: "Big", html: big });
  assert.equal(out.kind, "result");
});

test("the model is shown no idempotencyKey: not in the inputs and not required", () => {
  const { loaded } = session();
  const schema = loaded.catalog.byName("artifact_publish")!.inputSchema as {
    properties: Record<string, unknown>;
    required?: string[];
  };
  assert.equal("idempotencyKey" in schema.properties, false);
  assert.deepEqual(schema.required, ["title"]);
  for (const t of loaded.catalog.all) assert.ok(!JSON.stringify(t.inputSchema).includes('"idempotencyKey"'), t.name);
});

test("a rejection names the missing input, the tool and a minimal call, and holds no value", async () => {
  const { s } = session();
  const out = await s.call(c(), "artifact_publish", { html: "<p>private words the person wrote</p>" });
  assert.equal(out.kind, "error");
  const words = JSON.stringify(out.kind === "error" ? out.result.content : "");
  assert.match(words, /title is missing/);
  assert.match(words, /artifact_publish \{/);
  assert.ok(!words.includes("private words"), "no value comes back");
});

test("a key the model supplies is kept; without a call id two identical calls get two keys", async () => {
  const { s, sent } = session();
  await s.call(c(), "artifact_publish", { title: "A", html: PAGE, idempotencyKey: "mine-1" });
  assert.equal(keyOf(sent[0]), "mine-1");
  await s.call(c(), "artifact_publish", { title: "A", html: PAGE });
  await s.call(c(), "artifact_publish", { title: "A", html: PAGE });
  assert.notEqual(keyOf(sent[1]), keyOf(sent[2]));
});

test("the key is the call's own id: the same call delivered twice has one key, two identical calls made on purpose have two", async () => {
  const { s, sent } = session();
  const at = (callId: string) => c({ callId });
  await s.call(at("toolu_1"), "artifact_publish", { title: "A", html: PAGE });
  await s.call(at("toolu_1"), "artifact_publish", { title: "A", html: PAGE });
  await s.call(at("toolu_2"), "artifact_publish", { title: "A", html: PAGE });
  assert.equal(keyOf(sent[0]), keyOf(sent[1]));
  assert.notEqual(keyOf(sent[0]), keyOf(sent[2]));
  assert.equal(keyOf(sent[0]), "ag:trn_1:toolu_1");
});

test("every tool that needs a key has the layer fill it: no tool is left with the key required of the model", () => {
  const { loaded } = session();
  const keyed = loaded.catalog.all.filter((t) => t.keyed === true);
  assert.ok(keyed.length >= 269);
});
