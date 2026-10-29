// Report a problem, the host half (host/src/seams/reports.ts): the bundle sources read the person's last actions from the log, and the client signs with a key derived from the Space's seal key, registers
// the Space with the reports service and posts the redacted bundle. The service here is the real one (apps/reports) on in-memory stores, so what the client signs is checked by the code that verifies it.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LOGS_SCHEMA } from "../host/src/logsink/index.ts";
import { createReportsHost, deriveReportsKey, REPORTS_URL, SEALED_PLACES } from "../host/src/seams/reports.ts";
import { world as serviceWorld } from "../apps/reports/tests/harness.ts";

const SEAL = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const T1 = "0123456789abcdef0123456789abcdef";
const T2 = "fedcba9876543210fedcba9876543210";
const NOW = 1_760_000_000_000;

function logs(): { all(sql: string, ...a: unknown[]): Array<Record<string, unknown>>; add(r: Record<string, unknown>): void } {
  const db = new DatabaseSync(":memory:");
  db.exec(LOGS_SCHEMA);
  return {
    all: (sql, ...a) => db.prepare(sql).all(...(a as never[])) as Array<Record<string, unknown>>,
    add: (r) => { db.prepare("INSERT INTO logs (at, level, space, trace_id, actor, on_behalf, cap, result, msg) VALUES (?, ?, 'spc_alpha1', ?, ?, ?, ?, ?, ?)").run(r["at"] as number, (r["level"] as number) ?? 20, (r["trace"] as string) ?? null, (r["actor"] as string) ?? null, (r["behalf"] as string) ?? null, (r["cap"] as string) ?? null, (r["result"] as string) ?? null, (r["msg"] as string) ?? "invoke"); },
  };
}

const ctxOf = (id: string) => ({ principal: { id } });

test("the key is the same on every start, and different Spaces with different seal keys have different keys", async () => {
  const a = await deriveReportsKey(SEAL);
  const b = await deriveReportsKey(SEAL);
  const c = await deriveReportsKey(Uint8Array.from({ length: 32 }, (_, i) => 200 - i));
  assert.deepEqual(a.publicKey, b.publicKey);
  assert.notDeepEqual(a.publicKey, c.publicKey);
  assert.equal(a.publicKey.length, 32);
});

test("recent reads the person's own last actions and errors from the log, never someone else's, newest first", async () => {
  const l = logs();
  l.add({ at: NOW - 5000, trace: T1, actor: "usr_omar", cap: "records.update" });
  l.add({ at: NOW - 3000, trace: T2, actor: "usr_omar", cap: "files.write", level: 40, result: "validation.version_conflict", msg: "version conflict" });
  l.add({ at: NOW - 2000, trace: "f".repeat(32), actor: "usr_maya", cap: "records.update" });
  l.add({ at: NOW - 1000, trace: "e".repeat(32), actor: "agt_intake", behalf: "usr_omar", cap: "chat.post" });
  l.add({ at: NOW - 4 * 3_600_000, trace: "d".repeat(32), actor: "usr_omar", level: 40, msg: "old error" });
  const host = createReportsHost({ space: "spc_alpha1", now: () => NOW, fetch: async () => { throw new Error("no network"); }, logs: l, sealKey: SEAL, address: null, versions: { server: "1.0.0", device: "darwin" } });
  const out = await host.sources.recent(ctxOf("usr_omar"));
  assert.ok(out.traceIds.includes(T1) && out.traceIds.includes(T2) && out.traceIds.includes("e".repeat(32)), "own actions, and what an agent did for them");
  assert.ok(!out.traceIds.includes("f".repeat(32)), "not another person's");
  assert.equal(out.traceIds[0], "e".repeat(32), "newest first");
  assert.deepEqual(out.errors?.map((e) => [e.code, e.message]), [["validation.version_conflict", "version conflict"]], "errors of the last hour only");
  assert.deepEqual(out.versions, { app: "1.0.0", server: "1.0.0", device: "darwin" });
  assert.ok(out.events.every((e) => typeof e.type === "string" && typeof e.at === "number"));
});

test("a view that holds sealed values is reported as sealed, any other view is not", async () => {
  const host = createReportsHost({ space: "spc_alpha1", now: () => NOW, fetch: async () => { throw new Error("x"); }, logs: logs(), sealKey: SEAL, address: null, versions: { server: "1", device: "d" } });
  for (const place of SEALED_PLACES) assert.equal((await host.sources.sensitiveValues(ctxOf("usr_omar"), { place })).length, 1, place);
  assert.deepEqual(await host.sources.sensitiveValues(ctxOf("usr_omar"), { place: "files" }), []);
});

test("the client registers the Space and posts a report the service accepts: signed, unique, filed as an issue", async () => {
  const w = await serviceWorld();
  const seen: string[] = [];
  const fetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    assert.ok(url.startsWith(REPORTS_URL), url);
    const path = url.slice(REPORTS_URL.length);
    seen.push(`${init.method ?? "GET"} ${path}`);
    const res = await w.send({ method: init.method ?? "GET", path, headers: init.headers ?? {}, body: new TextEncoder().encode(init.body ?? "") });
    const text = typeof res.body === "string" ? res.body : new TextDecoder().decode(res.body);
    return { status: res.status, headers: { get: () => null }, text: async () => text };
  };
  const host = createReportsHost({ space: "spc_alpha1", now: w.now, fetch, logs: logs(), sealKey: SEAL, address: "https://alpha.test", versions: { server: "1.0.0", device: "darwin" } });
  const bundle = { context: { place: "files" }, traceIds: [T1], events: [{ type: "records.update", at: NOW - 5000 }], versions: { app: "1.0.0", server: "1.0.0", device: "darwin" }, note: "The save button did nothing", screenshotFileId: "fil_shot" };
  const out = await host.service.post({ reportId: "rpt_aaaaaaaa1", space: "spc_alpha1", reporter: "usr_omar", title: "Problem report from Omar", bundle });
  assert.equal(out.stored, true);
  assert.equal(typeof out.issueNumber, "number", "the service opened an issue");
  assert.deepEqual(seen, ["POST /v1/spaces", "POST /v1/reports"], "registered once, then posted");
  w.advance(1000);
  const again = await host.service.post({ reportId: "rpt_aaaaaaaa2", space: "spc_alpha1", reporter: "usr_omar", title: "Problem report from Omar", bundle });
  assert.equal(again.stored, true);
  assert.deepEqual(seen.slice(2), ["POST /v1/reports"], "no second registration");
  const stored = JSON.parse(new TextDecoder().decode((await w.objects.get("reports/rpt_aaaaaaaa1/bundle.json"))!.bytes)) as { bundle: Record<string, unknown> };
  assert.equal(stored.bundle["screenshotFileId"], undefined, "a Files id means nothing to the service and is not sent");
  assert.equal(stored.bundle["note"], "The save button did nothing");
});

test("a Space with no public address keeps its report: the post says the service is unavailable and nothing is sent", async () => {
  let called = 0;
  const host = createReportsHost({ space: "spc_alpha1", now: () => NOW, fetch: async () => { called++; throw new Error("x"); }, logs: logs(), sealKey: SEAL, address: null, versions: { server: "1", device: "d" } });
  await assert.rejects(host.service.post({ reportId: "rpt_aaaaaaaa1", space: "spc_alpha1", reporter: "usr_omar", title: "t", bundle: { context: { place: "files" }, traceIds: [], events: [], versions: { app: "1", server: "1", device: "d" } } }), (e: { code?: string }) => e.code === "unavailable");
  assert.equal(called, 0);
});

test("the service asking to slow down reaches the module as rate_limit", async () => {
  const host = createReportsHost({ space: "spc_alpha1", now: () => NOW, fetch: async () => ({ status: 429, headers: { get: () => null }, text: async () => "{}" }), logs: logs(), sealKey: SEAL, address: "https://alpha.test", versions: { server: "1", device: "d" } });
  await assert.rejects(host.service.post({ reportId: "rpt_aaaaaaaa1", space: "spc_alpha1", reporter: "usr_omar", title: "t", bundle: { context: { place: "files" }, traceIds: [], events: [], versions: { app: "1", server: "1", device: "d" } } }), (e: { code?: string }) => e.code === "rate_limit");
});

test("a log row that held message text never reaches the bundle: only action names, times, trace ids and the fixed log message are read", async () => {
  const l = logs();
  l.add({ at: NOW - 1000, trace: T1, actor: "usr_omar", cap: "chat.post", level: 40, result: "validation.bad_input", msg: "invoke failed" });
  (l as unknown as { all(sql: string): unknown }).all("SELECT 1");
  const host = createReportsHost({ space: "spc_alpha1", now: () => NOW, fetch: async () => { throw new Error("x"); }, logs: { ...l, all: (sql, ...a) => l.all(sql, ...a).map((r) => ({ ...r, attrs: JSON.stringify({ body: "the secret chat text", token: "tok_abc" }), body: "the secret chat text" })) }, sealKey: SEAL, address: null, versions: { server: "1", device: "d" } });
  const out = JSON.stringify(await host.sources.recent(ctxOf("usr_omar")));
  assert.ok(!out.includes("the secret chat text") && !out.includes("tok_abc"), out);
  assert.ok(out.includes("chat.post") && out.includes("validation.bad_input"));
});
