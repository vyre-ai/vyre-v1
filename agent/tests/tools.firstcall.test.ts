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

test("rule K: with no turn id, or no call id, the key is random: the same tool and input twice makes two things, in one session and in two", async () => {
  for (const make of [() => session(), () => session()]) {
    const { s, sent } = make();
    const bare = { ...c(), turnId: undefined } as ToolCtx;
    delete (bare as { turnId?: string }).turnId;
    await s.call(bare, "artifact_publish", { title: "Weekly report", html: PAGE });
    await s.call(bare, "artifact_publish", { title: "Weekly report", html: PAGE });
    await s.call(c(), "artifact_publish", { title: "Weekly report", html: PAGE }); // a turn id but no call id
    const keys = sent.map((x) => keyOf(x));
    assert.equal(sent.length, 3, "three handler runs");
    assert.equal(new Set(keys).size, 3);
    assert.ok(
      keys.every((k) => /^ag:r:[0-9a-f-]{36}$/.test(k ?? "")),
      String(keys),
    );
  }
  const a = session();
  const b = session();
  const bare = { ...c() } as ToolCtx;
  delete (bare as { turnId?: string }).turnId;
  await a.s.call(bare, "artifact_publish", { title: "Weekly report", html: PAGE });
  await b.s.call(bare, "artifact_publish", { title: "Weekly report", html: PAGE });
  assert.notEqual(keyOf(a.sent[0]), keyOf(b.sent[0]));
});

test("a pattern rule says what the pattern wants: a web address must start with http:// or https://", async () => {
  const { s } = session();
  s.preload("thr_1", ["chrome_open"]);
  const out = await s.call(c(), "chrome_open", { url: "acme.test/plan" });
  assert.equal(out.kind, "error");
  assert.match(
    JSON.stringify(out.kind === "error" ? out.result.content : ""),
    /url must start with http:\/\/ or https:\/\//,
  );
});

test("a template is called a template, and a worked example is called one that works", async () => {
  const { s } = session();
  const art = await s.call(c(), "artifact_publish", { html: "<p>x words here</p>" });
  assert.match(JSON.stringify(art.kind === "error" ? art.result.content : ""), /A call that works/);
  s.preload("thr_1", ["files_create"]);
  const f = await s.call(c(), "files_create", {});
  assert.match(
    JSON.stringify(f.kind === "error" ? f.result.content : ""),
    /The shape of a call \(replace each <\.\.\.>/,
  );
});
