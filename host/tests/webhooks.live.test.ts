// P-H_07: a booted daemon runs the events.webhooks_out projection. An admin creates a webhook through the gateway, a subscribed event is committed, and the daemon posts a signed
// webhook to a local receiver; the receiver fails the first try, the retry is scheduled by the module and goes out when the clock passes the backoff.
// The network port is the real one with a fetch that sends the https address to the receiver on 127.0.0.1 (the egress policy itself is not bypassed: https, allowlist, no private host).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { signWebhook } from "../src/seams/events-ports.ts";
import type { PostFetch } from "../src/seams/events-ports.ts";

const echoCap = {
  name: "example.echo", v: 1, permission: null, level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low", emits: ["example.said"],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Echo",
} as unknown as CapabilityDef;
const echoRoute = { method: "POST", path: "/v1/example/echo", cap: "example.echo", v: 1, effects: "write" as const };
const echoHandler = (ctx: { emit(n: never, s: string, p: unknown): unknown }, input: unknown): unknown => { ctx.emit("example.said" as never, "echo:1", input); return input; };

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  // The seed's owner role comes from the permission catalogue (P-H_15), so connectors.manage is already there: no extra role.defined event.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-webhooks-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

interface Got { headers: http.IncomingHttpHeaders; body: string; url: string }
/** A receiver on 127.0.0.1 that answers with the next status of `script` (then 200) and keeps what it was sent. */
async function receiver(script: number[]): Promise<{ port: number; got: Got[]; close(): Promise<void> }> {
  const got: Got[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      got.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8"), url: req.url ?? "" });
      res.statusCode = script.shift() ?? 200;
      res.end(res.statusCode === 200 ? "ok" : "later");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, got, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function until(what: string, f: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await f()) return; await new Promise((r) => setTimeout(r, 25)); }
  assert.fail(`timed out waiting for ${what}`);
}

const post = (d: Daemon, p: string, body: unknown) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body),
});
const rows = (d: Daemon, sql: string, ...a: unknown[]): Record<string, unknown>[] => d.db!.all(sql, ...a) as Record<string, unknown>[];

test("webhooks live: the daemon runs events.webhooks_out, posts a signed webhook to a receiver, and retries after a failure", async () => {
  const dir = seededDir();
  const rx = await receiver([500]);
  let skew = 0;
  const toReceiver: PostFetch = (url, init) => {
    const u = new URL(url);
    return fetch(`http://127.0.0.1:${rx.port}${u.pathname}${u.search}`, init as RequestInit) as unknown as ReturnType<PostFetch>;
  };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "webhooks-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    now: () => Date.now() + skew,
    extra: { caps: [echoCap], routes: [echoRoute], handlers: { "example.echo": echoHandler as never } },
    seams: { webhookAllow: () => ["*"], postFetch: toReceiver },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  try {
    assert.ok(d.projections!.projections.some((p) => p.name === "events.webhooks_out"), "the daemon hosts events.webhooks_out");
    assert.equal(d.seams!.missing.filter((m) => m.module === "events").length, 0, "the events module has its host ports");

    const created = await post(d, "/v1/webhooks/create", { name: "Echoes", url: "https://hooks.example.com/in/echo", eventTypes: ["example.said"], idempotencyKey: "wh-live-1" });
    assert.equal(created.status, 200);
    const { webhook, secret } = ((await created.json()) as { data: { webhook: { id: string }; secret: string } }).data;
    assert.equal(rx.got.length, 0, "creating a webhook sends nothing, and the history before it is not replayed into it");

    // a subscribed event: delivered to the receiver, signed, and the first answer (500) leaves the delivery retrying
    const echo = await post(d, "/v1/example/echo", { n: 1 });
    assert.equal(echo.status, 200);
    await until("the first post", () => rx.got.length >= 1);
    const first = rx.got[0]!;
    assert.equal(first.url, "/in/echo");
    assert.equal(first.headers["x-vyre-event"], "example.said");
    const sig = String(first.headers["x-vyre-signature"]);
    const ts = Number(/^t=(\d+),/.exec(sig)?.[1]);
    assert.ok(ts > 0, "the signature carries its timestamp");
    assert.equal(sig, signWebhook(secret, ts, first.body), "the signature is the HMAC of the timestamp and the body under the webhook's secret");
    const sent = JSON.parse(first.body) as { id: string; type: string; payload: { n: number } };
    assert.equal(sent.type, "example.said");
    assert.deepEqual(sent.payload, { n: 1 });
    assert.equal(first.headers["x-vyre-event-id"], sent.id);
    await until("the delivery row to read retrying", () => rows(d, "SELECT state FROM events_delivery WHERE webhook_id = ?", webhook.id)[0]?.["state"] === "retrying");
    const retrying = rows(d, "SELECT state, attempts, http_status, next_attempt_at FROM events_delivery WHERE webhook_id = ?", webhook.id);
    assert.equal(retrying.length, 1, "one delivery for one event");
    assert.equal(retrying[0]!["attempts"], 1);
    assert.equal(retrying[0]!["http_status"], 500);
    assert.ok(Number(retrying[0]!["next_attempt_at"]) > Date.now() + 20_000, "the retry waits out the backoff");
    assert.equal(rx.got.length, 1, "nothing is resent before the backoff passes");

    // the clock passes the backoff: the scheduled retry goes out, with the same event id, and is delivered
    skew += 31_000;
    await d.schedule!.tick();
    await until("the retry", () => rx.got.length >= 2);
    const second = rx.got[1]!;
    assert.equal(second.headers["x-vyre-event-id"], sent.id, "the retry is the same event");
    const sig2 = String(second.headers["x-vyre-signature"]);
    assert.equal(sig2, signWebhook(secret, Number(/^t=(\d+),/.exec(sig2)?.[1]), second.body), "and signed again");
    await until("the delivery row to read delivered", () => rows(d, "SELECT state FROM events_delivery WHERE webhook_id = ?", webhook.id)[0]?.["state"] === "delivered");
    const done = rows(d, "SELECT attempts, http_status FROM events_delivery WHERE webhook_id = ?", webhook.id)[0]!;
    assert.deepEqual([done["attempts"], done["http_status"]], [2, 200]);

    // the projection's own events (webhook.delivered, webhook.delivery_failed) are never delivered, and its cursor has passed them
    await until("the cursor to reach the head", async () => d.projections!.cursors()["events.webhooks_out"]! >= (await d.log!.currentHead()).seq);
    assert.equal(rx.got.length, 2, "no delivery of a delivery");
    assert.equal(rows(d, "SELECT COUNT(*) AS n FROM events_delivery WHERE webhook_id = ?", webhook.id)[0]!["n"], 1);
  } finally { await d.stop(); await rx.close(); }
});

test("webhooks live: a restart keeps the projection's cursor, so an event is delivered once and old events are not replayed", async () => {
  const dir = seededDir();
  const rx = await receiver([]);
  const toReceiver: PostFetch = (url, init) => fetch(`http://127.0.0.1:${rx.port}${new URL(url).pathname}`, init as RequestInit) as unknown as ReturnType<PostFetch>;
  const boot = (): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "webhooks-live2", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    extra: { caps: [echoCap], routes: [echoRoute], handlers: { "example.echo": echoHandler as never } },
    seams: { webhookAllow: () => ["*"], postFetch: toReceiver },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  let d = await boot();
  try {
    const created = await post(d, "/v1/webhooks/create", { name: "All echoes", url: "https://hooks.example.com/all", eventTypes: ["example.*"], idempotencyKey: "wh-live-2" });
    assert.equal(created.status, 200);
    assert.equal((await post(d, "/v1/example/echo", { n: 1 })).status, 200);
    await until("the first delivery", () => rx.got.length === 1);
    await until("the cursor to reach the head", async () => d.projections!.cursors()["events.webhooks_out"]! >= (await d.log!.currentHead()).seq);
    await d.stop();
    d = await boot();
    assert.equal((await post(d, "/v1/example/echo", { n: 2 })).status, 200);
    await until("the second delivery", () => rx.got.length === 2);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(rx.got.length, 2, "one delivery per event across the restart");
    assert.deepEqual(rx.got.map((g) => (JSON.parse(g.body) as { payload: { n: number } }).payload.n), [1, 2]);
  } finally { await d.stop(); await rx.close(); }
});
// P-H_15: run on the final commit.
