import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createIdempotency } from "../../kernel/src/idempotency/index.ts";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { Handler } from "../src/invoke.ts";
import { FrameReader, createLiveHub, encodeFrame } from "../src/ws.ts";
import type { LiveHub } from "../src/ws.ts";
import { LogSink } from "../src/logsink/index.ts";
import { createTracer, formatTr, parseTr } from "../src/trace/index.ts";

const SPACE = "spc_1";
const TR = `${"a1".repeat(16)}-${"b2".repeat(8)}`;

const echoCap = { name: "example.echo", v: 1, permission: "demo.edit", level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low", emits: ["example.said"], examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "" } as unknown as CapabilityDef;

function rig(o: { hbMs?: number; deadMs?: number } = {}) {
  const sink = new LogSink({ batchMs: 0 });
  const snap = new AccessSnapshot();
  snap.putRole({ id: "member", clearance: 3, perms: ["demo.edit"], name: "Member" });
  snap.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  snap.addPrincipalRole({ holder: "usr_dana", role: "member" });
  snap.putResource({ id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const stored: EventEnvelope[] = [];
  const store = new Map<string, { hash: string; result: unknown }>();
  const idem = createIdempotency({ get: (k) => store.get(k) ?? null, put: (k, _p, _c, rec) => { store.set(k, rec as { hash: string; result: unknown }); } });
  const handler: Handler = (ctx, input) => { ctx.emit("example.said" as never, "echo:1", input); return input; };
  let hub: LiveHub | undefined;
  const invoke = createInvoke({
    caps: indexCapabilities([echoCap]), validateInput: () => [], authorize: (r) => authorize(snap, r), handler: (c) => (c === "example.echo" ? handler : undefined), idem, log: sink.invokeLogger(SPACE),
    commit: async (b) => { sink.log({ space: SPACE, level: 20, msg: "commit", cap: b.cap, trace_id: b.events[0]?.traceId, attrs: { events: b.events.length } }); const out = b.events.map((e, i) => ({ ...e, seq: stored.length + i + 1 })); stored.push(...out); return out; },
    publish: (events) => hub?.publish(SPACE, events),
    onSpan: (s) => sink.span({ trace_id: s.traceId, span_id: s.spanId, parent: s.parent ?? null, name: s.name, at: s.startedAt, dur_us: s.ms * 1000, attrs: { cap: s.cap, status: s.status } }),
  });
  const mkHub = (): LiveHub => createLiveHub({
    session: (_h, url) => (url.searchParams.get("token") === "dana" ? { space: SPACE, principal: { kind: "person", id: "usr_dana" }, device: url.searchParams.get("device") ?? "dev1" } : null),
    invoke, sink, eventsSince: (_s, cursor) => stored.filter((e) => e.seq > cursor), head: () => stored.length, ...o,
  });
  hub = mkHub();
  return { sink, stored, hub, mkHub, setHub: (h: LiveHub) => { hub = h; } };
}

/** A client over Node's own WebSocket: frames arrive in a queue. */
async function connect(port: number, query = "token=dana&device=dev1") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/sync/v1/ws?${query}`);
  const queue: Record<string, unknown>[] = [];
  const waiting: ((f: Record<string, unknown>) => void)[] = [];
  let closed: { code: number } | null = null;
  const onClose: ((c: { code: number }) => void)[] = [];
  ws.addEventListener("message", (m) => { const f = JSON.parse(String(m.data)) as Record<string, unknown>; const w = waiting.shift(); if (w) w(f); else queue.push(f); });
  ws.addEventListener("close", (e) => { closed = { code: e.code }; for (const f of onClose) f(closed); });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("could not connect"))); });
  return {
    ws,
    send: (f: unknown) => ws.send(JSON.stringify(f)),
    next: (ms = 2000) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const q = queue.shift();
      if (q) { resolve(q); return; }
      const t = setTimeout(() => reject(new Error("no frame")), ms);
      waiting.push((f) => { clearTimeout(t); resolve(f); });
    }),
    nextOfType: async function (t: string, ms = 2000): Promise<Record<string, unknown>> { for (;;) { const f = await this.next(ms); if (f["t"] === t) return f; } },
    closed: () => new Promise<{ code: number }>((resolve) => { if (closed) resolve(closed); else onClose.push(resolve); }),
    close: () => ws.close(),
  };
}

test("example.echo over the socket: one trace id in the response, the numbered event, the log rows and the spans", async () => {
  const r = rig();
  const port = await r.hub.listen();
  try {
    const c = await connect(port);
    c.send({ t: "hello", cursor: 0 });
    assert.equal((await c.next())["t"], "hello_ok");
    c.send({ t: "call", id: 1, cap: "example.echo", input: { n: 7 }, tr: TR });
    const ev = await c.nextOfType("ev");
    const res = await c.nextOfType("res");
    assert.equal(res["ok"], true);
    assert.deepEqual((res["data"] as { output: unknown }).output, { n: 7 });
    const traceId = "a1".repeat(16);
    assert.equal(parseTr(res["tr"])?.traceId, traceId, "the response carries the caller's trace");
    assert.equal(ev["tr"], traceId, "the event frame carries it");
    assert.equal(ev["seq"], 1, "numbered by the event seq");
    assert.equal((ev["items"] as EventEnvelope[])[0]?.traceId, traceId, "and so does the event itself");
    const t = r.sink.trace(traceId);
    assert.ok(t.logs.length >= 2, "ws.call and the commit both logged");
    assert.ok(t.logs.every((l) => l.trace_id === traceId), "every log row of the call has the one trace id");
    assert.deepEqual([...new Set(t.logs.map((l) => l.msg))].sort(), ["commit", "ws.call"]);
    assert.ok(t.spans.some((s) => s.name === "ws.call" && s.parent === "b2".repeat(8)), "our span is a child of the caller's span");
    assert.ok(t.spans.some((s) => s.name === "invoke"));
    assert.equal(r.sink.db.prepare("SELECT COUNT(*) AS n FROM logs WHERE trace_id IS NOT NULL AND trace_id != ?").get(traceId)?.["n"], 0, "no other trace leaked in");
    // ack drops the buffered event
    assert.equal(r.hub.connections()[0]?.pending, 1);
    c.send({ t: "ack", seq: 1 });
    c.send({ t: "hb", seq: 1 });
    for (let i = 0; i < 50 && r.hub.connections()[0]?.pending; i++) await new Promise((x) => setTimeout(x, 10));
    assert.deepEqual(r.hub.connections()[0], { device: "dev1", acked: 1, pending: 0 });
    c.close();
  } finally { await r.hub.close(); r.sink.close(); }
});

test("a call without a trace starts one; a refused call comes back as an error frame with its trace", async () => {
  const r = rig();
  const port = await r.hub.listen();
  try {
    const c = await connect(port);
    c.send({ t: "hello", cursor: 0 }); await c.next();
    c.send({ t: "call", id: "a", cap: "example.echo", input: {} });
    const ok = await c.nextOfType("res");
    assert.match(String(parseTr(ok["tr"])?.traceId), /^[0-9a-f]{32}$/);
    c.send({ t: "call", id: "b", cap: "nope.nothing", input: {}, tr: TR });
    const bad = await c.nextOfType("res");
    assert.equal(bad["ok"], false);
    assert.equal(typeof (bad["error"] as { code: string }).code, "string");
    c.send({ t: "call", id: "c" });
    assert.equal((await c.nextOfType("res"))["ok"], false, "a call must name a capability");
    c.send({ t: "nonsense" });
    assert.equal((await c.nextOfType("error"))["code"], "validation.bad_input");
    c.close();
  } finally { await r.hub.close(); r.sink.close(); }
});

test("an upgrade without a session is refused; a second socket from one device replaces the first", async () => {
  const r = rig();
  const port = await r.hub.listen();
  try {
    await assert.rejects(connect(port, "token=nobody"));
    const a = await connect(port, "token=dana&device=phone");
    a.send({ t: "hello", cursor: 0 }); await a.next();
    const b = await connect(port, "token=dana&device=phone");
    assert.equal((await a.closed()).code, 4000, "the old socket is told it was replaced");
    b.send({ t: "hello", cursor: 0 });
    assert.equal((await b.next())["t"], "hello_ok");
    assert.equal(r.hub.connections().length, 1);
    b.close();
  } finally { await r.hub.close(); r.sink.close(); }
});

test("heartbeat: the server beats, and a peer silent past the dead window is dropped", async () => {
  const r = rig({ hbMs: 30, deadMs: 150 });
  const port = await r.hub.listen();
  try {
    const live = await connect(port, "token=dana&device=live");
    const mute = await connect(port, "token=dana&device=mute");
    live.send({ t: "hello", cursor: 0 });
    const beats: number[] = [];
    let silentDrop: { code: number } | null = null;
    void mute.closed().then((c) => { silentDrop = c; });
    for (let i = 0; i < 12; i++) { beats.push(Number((await live.nextOfType("hb"))["seq"])); live.send({ t: "hb", seq: 0 }); await new Promise((x) => setTimeout(x, 20)); }
    assert.ok(beats.length >= 12, "the server keeps beating");
    assert.deepEqual(silentDrop, { code: 4001 }, "the mute client missed its heartbeats and was closed with 4001");
    assert.deepEqual(r.hub.connections().map((c) => c.device), ["live"], "the live one is still connected");
    live.close();
  } finally { await r.hub.close(); r.sink.close(); }
});

test("failover: the device reconnects to another endpoint with its cursor and gets exactly what it missed", async () => {
  const r = rig();
  const portA = await r.hub.listen();
  const hubB = r.mkHub();
  const portB = await hubB.listen();
  try {
    const a = await connect(portA);
    a.send({ t: "hello", cursor: 0 }); await a.next();
    for (let i = 1; i <= 3; i++) { a.send({ t: "call", id: i, cap: "example.echo", input: { i } }); await a.nextOfType("res"); }
    assert.equal(r.stored.length, 3);
    a.send({ t: "ack", seq: 2 });
    a.ws.close();                                      // endpoint A goes away
    const b = await connect(portB);
    b.send({ t: "hello", cursor: 2 });                 // acked through 2
    assert.equal((await b.next())["t"], "hello_ok");
    const ev = await b.nextOfType("ev");
    assert.equal(ev["seq"], 3, "only the event after the cursor is replayed");
    assert.equal(hubB.connections()[0]?.pending, 1);
    b.send({ t: "hello", cursor: 3 });
    assert.equal((await b.nextOfType("hello_ok"))["mode"], "live");
    b.close();
  } finally { await hubB.close(); await r.hub.close(); r.sink.close(); }
});

// ---- framing ----
const masked = (opcode: number, payload: Buffer, fin = true): Buffer => {
  const mask = Buffer.from([1, 2, 3, 4]);
  const body = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]!));
  const head = payload.length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length]) : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([head, mask, body]);
};

test("frame reader: whole, split across chunks, fragmented, control frames, and the refusals", () => {
  const r = new FrameReader(1000);
  const whole = masked(1, Buffer.from("hello"));
  assert.deepEqual(r.push(whole).map((m) => m.data.toString()), ["hello"]);
  assert.deepEqual([...r.push(whole.subarray(0, 3)), ...r.push(whole.subarray(3))].map((m) => m.data.toString()), ["hello"], "split across chunks");
  const frag = Buffer.concat([masked(1, Buffer.from("hel"), false), masked(9, Buffer.from("p")), masked(0, Buffer.from("lo"), true)]);
  const got = r.push(frag);
  assert.deepEqual(got.map((m) => [m.opcode, m.data.toString()]), [[9, "p"], [1, "hello"]], "a ping may sit between fragments");
  const long = Buffer.alloc(300, 0x61);
  assert.equal(r.push(masked(1, long))[0]?.data.length, 300, "16-bit length");
  const big = new FrameReader(100);
  big.push(masked(1, Buffer.alloc(200)));
  assert.equal(big.error?.code, 1009);
  const bare = new FrameReader();
  bare.push(Buffer.from([0x81, 0x02, 0x68, 0x69]));
  assert.equal(bare.error?.code, 1002, "unmasked client frames are refused");
  const stray = new FrameReader();
  stray.push(masked(0, Buffer.from("x")));
  assert.equal(stray.error?.code, 1002);
  assert.equal(encodeFrame(1, Buffer.from("hi")).toString("hex"), "81026869");
  assert.equal(encodeFrame(1, Buffer.alloc(200))[1], 126);
});

// ---- trace and sink ----
test("tracer: spans nest, carry the trace id, record errors; tr text round trips", async () => {
  const rows: { trace_id: string; span_id: string; parent: string | null; name: string; attrs: Record<string, unknown> | null }[] = [];
  const tracer = createTracer({ span: (s) => rows.push(s) }, { from: parseTr(TR)! });
  await tracer.span("outer", async () => { await tracer.span("inner", async (s) => { s.set("rows", 3); }); });
  await assert.rejects(tracer.span("boom", () => { throw new TypeError("x"); }));
  assert.deepEqual(rows.map((s) => s.name), ["inner", "outer", "boom"]);
  assert.ok(rows.every((s) => s.trace_id === "a1".repeat(16)));
  const [inner, outer, boom] = rows;
  assert.equal(inner?.parent, outer?.span_id);
  assert.equal(outer?.parent, "b2".repeat(8));
  assert.deepEqual(inner?.attrs, { rows: 3 });
  assert.deepEqual(boom?.attrs, { error: "TypeError" });
  assert.equal(formatTr({ traceId: "a1".repeat(16), spanId: "b2".repeat(8) }), TR);
  assert.equal(parseTr("junk"), undefined);
  assert.equal(parseTr(`${TR}-${"c3".repeat(8)}`)?.parent, "c3".repeat(8));
  assert.match(createTracer({ span: () => {} }).traceId, /^[0-9a-f]{32}$/);
});

test("log sink: batches, redacts content keys and known secrets, reads by trace, erases an actor", () => {
  let now = 1000;
  const sink = new LogSink({ batchMs: 60_000, now: () => ++now, secrets: () => ["sk-live-123"] });
  sink.log({ space: SPACE, level: 20, msg: "thing.done", trace_id: "t1", actor: "usr_dana", attrs: { count: 2, body: "the secret text", nested: { subject: "hi", id: "x" }, note: "sk-live-123" } });
  assert.equal(sink.db.prepare("SELECT COUNT(*) AS n FROM logs").get()?.["n"], 0, "queued, not written yet");
  const t = sink.trace("t1");   // trace() flushes
  assert.equal(t.logs.length, 1);
  assert.deepEqual(t.logs[0]?.attrs, { count: 2, nested: { id: "x" }, note: "[redacted]" });
  sink.erase("usr_dana");
  assert.equal(sink.trace("t1").logs[0]?.actor, null, "the erased actor reads as blank");
  assert.equal(sink.db.prepare("SELECT actor FROM logs").get()?.["actor"], "usr_dana", "the row keeps the id");
  sink.close();
});

// ---- types ----
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("the socket, trace and sink code and this test typecheck under tsconfig.base.json, with the checker left on", { timeout: 120_000 }, () => {
  const files = ["host/src/ws.ts", "host/src/trace/index.ts", "host/src/logsink/index.ts", "host/tests/ws.echo.e2e.test.ts"];
  for (const f of files) assert.ok(!new RegExp("@ts-" + "(nocheck|ignore|expect-error)").test(fs.readFileSync(path.join(REPO, f), "utf8")), `${f} must not switch the type checker off`);
  let cache = "";
  for (const d of ["/var/lib/ci-run/tsc-cache-v1", path.join(os.tmpdir(), "tsc-cache-v1")]) { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); cache = d; break; } catch { /* next */ } }
  assert.ok(cache, "a writable cache directory");
  const tsc = path.join(cache, "node_modules/typescript/bin/tsc");
  if (!fs.existsSync(tsc)) {
    fs.writeFileSync(path.join(cache, "package.json"), '{"private":true}');
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "typescript@5.9.3", "@types/node@24"], { cwd: cache, encoding: "utf8" });
    assert.equal(r.status, 0, `npm install failed: ${r.stderr}`);
  }
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsc-")), "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify({ extends: path.join(REPO, "tsconfig.base.json"), compilerOptions: { typeRoots: [path.join(cache, "node_modules/@types")], types: ["node"], noEmit: true }, files: files.map((f) => path.join(REPO, f)) }));
  const r = spawnSync(process.execPath, [tsc, "-p", cfg, "--pretty", "false"], { cwd: REPO, encoding: "utf8" });
  const mine = r.stdout.split("\n").filter((l) => /^host\/(src\/(ws|trace|logsink)|tests\/ws\.).*\(\d+,\d+\): error/.test(l));
  assert.deepEqual(mine.slice(0, 200), [], `${mine.length} type errors`);
});
