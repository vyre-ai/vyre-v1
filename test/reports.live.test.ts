// Report a problem on a booted daemon (host/src/seams/reports.ts): the owner submits a report, the bundle is scrubbed and stored with a Review task, and under the default policy it is registered and posted to
// the reports service, which here is the real one (apps/reports) on in-memory stores. A service that cannot be reached loses nothing: the report is kept and can be sent again.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { world as serviceWorld } from "../apps/reports/tests/harness.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seeded(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-reports-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

type Fetch = NonNullable<Parameters<typeof startDaemon>[0]["reportsFetch"]>;

async function boot(dir: string, reportsFetch: Fetch): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "alpha.test"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "reports-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    reportsFetch,
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

const bundle = (note: string) => ({
  context: { place: "files" }, traceIds: ["0123456789abcdef0123456789abcdef"], events: [{ type: "files.write", at: Date.now() - 1000 }],
  versions: { app: "1.2.3", server: "1.2.3", device: "darwin" }, note,
});

test("reports live: submit stores the report with a Review task and posts it to the service, which opens an issue", async () => {
  const dir = seeded();
  const w = await serviceWorld();
  w.advance(Date.now() - w.now());   // the service checks the signed time against its own clock: it runs on the daemon's
  const seen: string[] = [];
  const reportsFetch: Fetch = async (url, init = {}) => {
    const u = new URL(url);
    seen.push(`${init.method ?? "GET"} ${u.pathname}`);
    const res = await w.send({ method: init.method ?? "GET", path: u.pathname, headers: init.headers ?? {}, body: new TextEncoder().encode(init.body ?? "") });
    const text = typeof res.body === "string" ? res.body : new TextDecoder().decode(res.body);
    return { status: res.status, headers: { get: () => null }, text: async () => text };
  };
  const d = await boot(dir, reportsFetch);
  try {
    assert.deepEqual(d.seams?.missing, [], "no module is left without its driver");
    const preview = await call(d, "reports.preview", { context: { place: "files" }, note: "The save button did nothing" });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    const out = await call(d, "reports.submit", { bundle: bundle("The save button did nothing"), idempotencyKey: "reports-live-1" });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.equal(out.data.sentToVyre, true, JSON.stringify(out.data));
    assert.ok(out.data.taskId, "the admins have a Review task");
    assert.deepEqual(seen, ["POST /v1/spaces", "POST /v1/reports"], "the Space registered, then the report was posted");
    const list = await call(d, "reports.list", {});
    assert.equal(list.data.reports.length, 1);
    assert.equal(list.data.reports[0].status, "sent");
    assert.equal(typeof list.data.reports[0].issueNumber, "number");
    const got = await call(d, "reports.get", { reportId: list.data.reports[0].reportId });
    assert.equal(got.data.bundle.note, "The save button did nothing");
  } finally { await d.stop(); }
});

test("reports live: a service that cannot be reached loses nothing: the report is stored with its task and stays new", async () => {
  const dir = seeded();
  const d = await boot(dir, async () => { throw new Error("connect ECONNREFUSED"); });
  try {
    const out = await call(d, "reports.submit", { bundle: bundle("It broke"), idempotencyKey: "reports-live-2" });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.equal(out.data.sentToVyre, false);
    assert.ok(out.data.taskId);
    const list = await call(d, "reports.list", {});
    assert.deepEqual(list.data.reports.map((r: { status: string }) => r.status), ["new"]);
  } finally { await d.stop(); }
});

test("reports live: an admin turns sending off with reports.policy_set, and then a submitted report stays in the Space and nothing is posted", async () => {
  const dir = seeded();
  const seen: string[] = [];
  const d = await boot(dir, async (url) => { seen.push(url); throw new Error("must not be reached"); });
  try {
    const set = await call(d, "reports.policy_set", { policy: "off", idempotencyKey: "reports-policy-off" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal((await call(d, "reports.policy_get", {})).data.policy, "off");
    const out = await call(d, "reports.submit", { bundle: bundle("Kept here"), idempotencyKey: "reports-live-3" });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.equal(out.data.sentToVyre, false);
    assert.ok(out.data.taskId, "the admins still get the Review task");
    const sent = await call(d, "reports.send_to_vyre", { reportId: out.data.reportId, idempotencyKey: "reports-send-off" });
    assert.equal(sent.data.stored, false, "an explicit send is refused too while sending is off");
    assert.deepEqual(seen, [], "no request reached the service");
  } finally { await d.stop(); }
});
