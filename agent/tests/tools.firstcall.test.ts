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

function toolNeeding(name: string, only: string[]): string {
  const { loaded } = session();
  const t = loaded.catalog.all.find((x) => {
    const r = ((x.inputSchema as { required?: string[] }).required ?? []).slice().sort();
    return r.length === only.length && r.every((k, i) => k === only.slice().sort()[i]) && x.name.startsWith(name);
  });
  assert.ok(t, `a tool starting ${name} that needs only ${only.join(", ")}`);
  return t.name;
}

test("natural second spellings of an input are read as the tool's own: file_id and id for fileId, chatId for threadId", async () => {
  const { s, sent } = session();
  const tool = toolNeeding("files_", ["fileId"]);
  s.preload("thr_1", [tool]);
  const a = await s.call(c(), tool, { file_id: "fil_a1b2c3" });
  assert.equal(a.kind, "result", JSON.stringify(a.kind === "error" ? a.result.content : ""));
  assert.equal((sent.at(-1)?.input as { fileId?: string }).fileId, "fil_a1b2c3");
  const b = await s.call(c(), tool, { id: "fil_a1b2c3" });
  assert.equal(b.kind, "result");
  assert.equal((sent.at(-1)?.input as { fileId?: string }).fileId, "fil_a1b2c3");
  s.preload("thr_1", ["chat_messages_list"]);
  const d = await s.call(c(), "chat_messages_list", { chatId: "thr_other1" });
  assert.equal(d.kind, "result", JSON.stringify(d.kind === "error" ? d.result.content : ""));
  assert.equal((sent.at(-1)?.input as { threadId?: string }).threadId, "thr_other1");
});

test("a name the tool does not have, where an input is missing, is refused with the exact names the tool takes", async () => {
  const { s } = session();
  const tool = toolNeeding("files_", ["fileId"]);
  s.preload("thr_1", [tool]);
  const out = await s.call(c(), tool, { document: "fil_a1b2c3" });
  assert.equal(out.kind, "error");
  const words = JSON.stringify(out.kind === "error" ? out.result.content : "");
  assert.match(words, /fileId is missing/);
  assert.match(words, /no input named document/);
  assert.match(words, /Its inputs are/);
});

test("a chat tool called with no chat is for this chat; a tool that ends a chat is not", async () => {
  const { s, sent } = session();
  s.preload("thr_1", ["chat_messages_list", "threads_archive"]);
  await s.call(c(), "chat_messages_list", {});
  assert.equal((sent.at(-1)?.input as { threadId?: string }).threadId, "thr_1");
  const arch = await s.call(c(), "threads_archive", {});
  assert.equal(arch.kind, "error", "the chat is not archived on a missing input");
  assert.match(JSON.stringify(arch.kind === "error" ? arch.result.content : ""), /threadId is missing/);
});

test("the key is the call's own id: the same call delivered twice has one key, two identical calls made on purpose have two", async () => {
  const { s, sent } = session();
  const at = (callId: string) => c({ callId });
  await s.call(at("toolu_1"), "artifact_publish", { title: "A", html: PAGE });
  await s.call(at("toolu_1"), "artifact_publish", { title: "A", html: PAGE }); // a transport retry of the same call
  await s.call(at("toolu_2"), "artifact_publish", { title: "A", html: PAGE }); // the model asked again on purpose
  const keys = sent.map((x) => (x.input as { idempotencyKey: string }).idempotencyKey);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.equal(keys[0], "ag:trn_1:toolu_1");
});

test("a key the model supplies itself is kept even when the call has an id", async () => {
  const { s, sent } = session();
  await s.call(c({ callId: "toolu_9" }), "artifact_publish", { title: "A", html: PAGE, idempotencyKey: "mine-2" });
  assert.equal((sent[0]?.input as { idempotencyKey?: string }).idempotencyKey, "mine-2");
});
