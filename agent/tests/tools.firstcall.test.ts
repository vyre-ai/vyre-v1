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
const keyOf = (x: { input: unknown } | undefined): string | undefined =>
  (x?.input as { idempotencyKey?: string } | undefined)?.idempotencyKey;
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
