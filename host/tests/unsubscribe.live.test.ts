// The unsubscribe link on a booted daemon, through the real gateway and the real opt-out: a person with no session, on the address the email gave them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-unsub-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "unsub-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "unsub-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
const ok = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body, token);
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

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

test("with no session: the page is not the app, a bad link says so, a good one unsubscribes once at either address, and the address is suppressed", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    for (const p of [`/u/${TOKEN}`, `/p/u/${TOKEN}`]) {
      const page = await fetch(d.url + p);
      assert.equal(page.status, 200, p);
      const html = await page.text();
      assert.match(html, /method="post"/, p);
      assert.doesNotMatch(html, /__vyre|boot\.js|spc_core|Olivia/, "nothing of the app or the Space");
    }
    const bad = await fetch(`${d.url}/u/${TOKEN}`, { method: "POST" });
    assert.equal(bad.status, 404, await bad.clone().text());
    assert.match(await bad.text(), /does not work/);

    const file = (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => path.join(dir, f)).filter((f) => f.endsWith(".db")).find((f) => {
      const probe = new DatabaseSync(f, { readOnly: true });
      try { return probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'campaigns_unsub'").get() !== undefined; } finally { probe.close(); }
    });
    assert.ok(file, "the store with the campaign tables");
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO campaigns_unsub (token_hash, campaign_id, member_id, address, used_at) VALUES (?, ?, ?, ?, ?)").run(crypto.createHash("sha256").update(TOKEN).digest("hex"), "cmp_gone", "mem_gone", "dana@fox.test", null);
    db.close();
    const good = await fetch(`${d.url}/p/u/${TOKEN}`, { method: "POST" });
    assert.equal(good.status, 200, await good.clone().text());
    const text = await good.text();
    assert.match(text, /You are unsubscribed/);
    assert.doesNotMatch(text, /dana@fox\.test|spc_core|Olivia/, "not even their own address");
    const held = (await ok(d, "/v1/contacts/suppression/check", { channel: "email", addresses: ["dana@fox.test"] }))["suppressed"] as unknown[];
    assert.equal(held.length, 1, "the address is on the suppression list");
    assert.equal((await fetch(`${d.url}/u/${TOKEN}`, { method: "POST" })).status, 200, "the same link again answers the same");
  } finally { await d.stop(); }
});
