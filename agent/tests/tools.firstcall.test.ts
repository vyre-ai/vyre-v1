// The first call of an agent's tool (13 Nov 2026, owner: "its first attempts are always failing"). `create(...)` capabilities require an idempotencyKey that no description mentions; the model had to invent it,
// and the rejection did not name it. The tool layer now fills what it can know, and a rejection names the exact field and shows a minimal call.
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

test("artifact_publish: title and html alone is accepted, with no key from the model", async () => {
  const { s, sent } = session();
  const out = await s.call(c(), "artifact_publish", { title: "Q3 plan", html: PAGE });
  assert.equal(out.kind, "result", JSON.stringify(out.kind === "error" ? out.result.content : ""));
  const key = (sent[0]?.input as { idempotencyKey?: string }).idempotencyKey;
  assert.ok(typeof key === "string" && key.length > 0, "the tool layer made the key");
});

test("artifact_publish: html with no title takes the page's own title", async () => {
  const { s, sent } = session();
  const out = await s.call(c(), "artifact_publish", { html: PAGE });
  assert.equal(out.kind, "result", JSON.stringify(out.kind === "error" ? out.result.content : ""));
  assert.equal((sent[0]?.input as { title?: string }).title, "Q3 plan");
});

test("artifact_publish: html with no title and no title in the page is refused naming title, with a minimal call", async () => {
  const { s } = session();
  const out = await s.call(c(), "artifact_publish", { html: "<p>hi there</p>" });
  assert.equal(out.kind, "error");
  const words = JSON.stringify(out.kind === "error" ? out.result.content : "");
  assert.match(words, /title/);
  assert.match(words, /artifact_publish/);
  assert.match(words, /html/);
});

test("artifact_publish: a 300 KB page is accepted", async () => {
  const { s } = session();
  const big = `<html><head><title>Big</title></head><body>${"<p>row</p>".repeat(30_000)}</body></html>`;
  assert.ok(big.length > 300_000);
  const out = await s.call(c(), "artifact_publish", { title: "Big", html: big });
  assert.equal(out.kind, "result");
});

test("the model is shown no idempotencyKey: the tool layer owns it", () => {
  const { loaded } = session();
  const t = loaded.catalog.byName("artifact_publish")!;
  const schema = t.inputSchema as { properties: Record<string, unknown>; required?: string[] };
  assert.equal("idempotencyKey" in schema.properties, false);
  assert.deepEqual(schema.required, ["title"]);
});

test("a key the model did give is kept, and the same call twice in a turn gets two keys", async () => {
  const { s, sent } = session();
  await s.call(c(), "artifact_publish", { title: "A", html: PAGE, idempotencyKey: "mine-1" });
  assert.equal((sent[0]?.input as { idempotencyKey?: string }).idempotencyKey, "mine-1");
  await s.call(c(), "artifact_publish", { title: "A", html: PAGE });
  await s.call(c(), "artifact_publish", { title: "A", html: PAGE });
  const a = (sent[1]?.input as { idempotencyKey?: string }).idempotencyKey;
  const b = (sent[2]?.input as { idempotencyKey?: string }).idempotencyKey;
  assert.notEqual(a, b);
});

test("no tool shows an example that the placeholder guard refuses: a model copies an example whole", () => {
  const { loaded } = session();
  const shown = loaded.catalog.all.filter((t) => /example\.(com|org|net)/i.test(JSON.stringify(t.inputSchema)));
  assert.deepEqual(
    shown.map((t) => t.name),
    [],
  );
});
