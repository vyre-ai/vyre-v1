// An automation's webhook URL starts a run for real: one POST is one run, a wrong or rotated secret starts none, and a turned-off or deleted automation answers a bare 404.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-pfail-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "pfail-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "pfail-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
const ok = async (d: Daemon, p: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

type Note = { fields: { title?: string } };
// A read that lands while access is being folded answers "Access changed while reading. Refresh the list." (422). That is a read race, so the read is asked again.
const countOf = async (d: Daemon, title: string): Promise<number> => {
  for (let tries = 0; ; tries++) {
    const r = await call(d, "/v1/records/query", { type: "note_board" });
    if (r.status === 422 && tries < 6) { await new Promise((x) => setTimeout(x, 200)); continue; }
    assert.equal(r.status, 200, r.text);
    return (r.data["rows"] as Note[]).filter((row) => row.fields.title === title).length;
  }
};

const hook = (d: Daemon, url: string, init: { body?: string; key?: string; method?: string } = {}): Promise<Response> =>
  fetch(url, { method: init.method ?? "POST", headers: { "content-type": "application/json", ...(init.key ? { "idempotency-key": init.key } : {}) }, ...(init.body !== undefined ? { body: init.body } : {}), signal: AbortSignal.timeout(8_000) });

test("a real POST to the webhook URL starts exactly one run, a wrong secret starts none, a rotated secret stops the old URL", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/automations/create", { idempotencyKey: "hook-create", name: "hooked" });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    await ok(d, "/v1/automations/update", { automationId: id, definition: { triggers: [{ key: "webhook" }], nodes: [{ id: "n", key: "records.create", input: { type: "note_board", fields: { title: "From hook" } } }] } });
    const urlOf = async (route: string): Promise<string> => {
      const out = await ok(d, route, { automationId: id, ...(route.endsWith("rotate") ? { confirm: true } : {}) });
      return d.url + String(out["url"]).replace(/^https?:\/\/[^/]+/, "");
    };
    const url = await urlOf("/v1/automations/webhook_url/get");
    assert.match(url, /\/hooks\/automation\/aut_[a-z0-9]+\/[A-Za-z0-9_-]+$/);

    // turned off: the URL answers 404 and nothing starts
    const off = await hook(d, url, { body: "{}" });
    assert.equal(off.status, 404);
    assert.equal(await off.text(), "");
    assert.equal(await countOf(d, "From hook"), 0);

    await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
    const first = await hook(d, url, { body: JSON.stringify({ order: 7 }), key: "evt-1" });
    assert.equal(first.status, 200, await first.text());
    const again = await hook(d, url, { body: JSON.stringify({ order: 7 }), key: "evt-1" });
    assert.equal(again.status, 200);
    await until("the note", 10_000, async () => (await countOf(d, "From hook")) >= 1 ? true : undefined);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await countOf(d, "From hook"), 1, "one POST, sent twice with one Idempotency-Key, is one run");
    const runs = ((await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id }, limit: 20 }))["runs"] as unknown[]).length;
    assert.equal(runs, 1);

    // the payload is the trigger data
    const second = await hook(d, url, { body: JSON.stringify({ order: 8 }), key: "evt-2" });
    assert.equal(second.status, 200);
    await until("the second note", 10_000, async () => (await countOf(d, "From hook")) >= 2 ? true : undefined);

    // a wrong secret, an unknown id, a GET: no run
    const wrong = await hook(d, url.replace(/\/[^/]+$/, "/not-the-secret-at-all"), { body: "{}" });
    assert.equal(wrong.status, 404);
    assert.equal(await wrong.text(), "");
    const unknown = await hook(d, url.replace(/aut_[a-z0-9]+/, "aut_000000000000"), { body: "{}" });
    assert.equal(unknown.status, 404);
    assert.equal(await unknown.text(), "");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await countOf(d, "From hook"), 2, "a wrong secret starts nothing");

    // rotate: the old URL stops, the new one works
    const fresh = await urlOf("/v1/automations/webhook_url/rotate");
    assert.notEqual(fresh, url);
    const old = await hook(d, url, { body: "{}", key: "evt-3" });
    assert.equal(old.status, 404);
    const now = await hook(d, fresh, { body: "{}", key: "evt-4" });
    assert.equal(now.status, 200);
    await until("the third note", 10_000, async () => (await countOf(d, "From hook")) >= 3 ? true : undefined);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await countOf(d, "From hook"), 3, "the old URL started nothing");

    // a body over 1 MB is refused
    const big = await hook(d, fresh, { body: JSON.stringify({ blob: "x".repeat(1_100_000) }) });
    assert.equal(big.status, 413);
    // deleted: 404
    await ok(d, "/v1/automations/delete", { automationId: id, idempotencyKey: "hook-del" });
    assert.equal((await hook(d, fresh, { body: "{}", key: "evt-5" })).status, 404);
  } finally { await d.stop(); }
});
