// P-H_07b: the daemon dies between the delivery row insert and the dispatch (the first daemon here has a dispatcher that fails, which leaves the row pending exactly as a crash does).
// A second daemon on the same data directory re-dispatches the pending row older than the retry window, and the receiver gets one signed delivery, once.
// The network port is the real one with a fetch that sends the https address to the receiver on 127.0.0.1 (the egress policy itself is not bypassed: https, allowlist, no private host).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { ROLE_PERMS } from "../../kernel/src/grants/roles.ts";
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
  // The seed's roles carry no `connectors.manage` (the permission webhooks.create needs), so the Space owner is given it by one more role.defined event in this copy.
  const [owned] = core.store.appendBatch([{
    id: "evt_whlive_0001", type: "role.defined", sv: 1, trace_id: "0".repeat(32), actor: "svc_seed", vis: "space", entity: "role", entity_id: "owner",
    payload: { id: "owner", clearance: 3, perms: [...ROLE_PERMS.owner, "connectors.manage"], name: "owner" },
  }]);
  assert.ok(owned?.ok, "the owner role is extended");
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

test("webhooks recover: a delivery row left pending by a crash is sent after a restart, once, signed", async () => {
  const dir = seededDir();
  const rx = await receiver([]);
  const toReceiver: PostFetch = (url, init) => fetch(`http://127.0.0.1:${rx.port}${new URL(url).pathname}`, init as RequestInit) as unknown as ReturnType<PostFetch>;
  const boot = (extra: { skew?: number; crash?: boolean } = {}): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "webhooks-recover", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    now: () => Date.now() + (extra.skew ?? 0),
    extra: { caps: [echoCap], routes: [echoRoute], handlers: { "example.echo": echoHandler as never } },
    seams: {
      webhookAllow: () => ["*"], postFetch: toReceiver,
      ...(extra.crash ? { drivers: { setEventsDispatch: () => () => Promise.reject(new Error("the daemon died before it could dispatch")) } } : {}),
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  let d = await boot({ crash: true });
  let webhookId = "";
  let secret = "";
  try {
    const created = await post(d, "/v1/webhooks/create", { name: "Echoes", url: "https://hooks.example.com/in/echo", eventTypes: ["example.said"], idempotencyKey: "wh-rec-1" });
    assert.equal(created.status, 200);
    const body = ((await created.json()) as { data: { webhook: { id: string }; secret: string } }).data;
    webhookId = body.webhook.id; secret = body.secret;
    assert.equal((await post(d, "/v1/example/echo", { n: 7 })).status, 200);
    await until("the pending row", () => rows(d, "SELECT state FROM events_delivery WHERE webhook_id = ?", webhookId)[0]?.["state"] === "pending");
    await until("the cursor to pass the event", async () => d.projections!.cursors()["events.webhooks_out"]! >= (await d.log!.currentHead()).seq);
    assert.equal(rx.got.length, 0, "nothing was sent before the crash");
  } finally { await d.stop(); }

  d = await boot({ skew: 60_000 });
  try {
    await until("the recovered delivery", () => rx.got.length >= 1);
    await until("the row to read delivered", () => rows(d, "SELECT state FROM events_delivery WHERE webhook_id = ?", webhookId)[0]?.["state"] === "delivered");
    const got = rx.got[0]!;
    const sig = String(got.headers["x-vyre-signature"]);
    assert.equal(sig, signWebhook(secret, Number(/^t=(\d+),/.exec(sig)?.[1]), got.body), "signed under the webhook's secret");
    assert.deepEqual((JSON.parse(got.body) as { payload: unknown }).payload, { n: 7 });
    await d.projections!.recoverNow();
    await d.projections!.pump();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(rx.got.length, 1, "exactly one delivery");
    assert.equal(rows(d, "SELECT COUNT(*) AS n FROM events_delivery WHERE webhook_id = ?", webhookId)[0]!["n"], 1);
  } finally { await d.stop(); await rx.close(); }
});
