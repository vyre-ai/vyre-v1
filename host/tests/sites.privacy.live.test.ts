// F48 (14 Nov 2026), sites: who may reach a site is kept where the kernel decides, like an inbox. (Mail: an inbox a person set to private is private where the kernel decides: the owner, and the people it is shared with, nobody else, for send and for naming it in a saved definition. Setting
// it back to the Space gives it back to every member. Real daemon, two people.
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
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";
const AGENT = "tok-agent";
const TO = "held@gate.test";

function seededDir(): string {
  const core = bootCore();
  core.store.appendBatch([
    {
      id: "evt_f47_box",
      type: "resource.created",
      sv: 1,
      trace_id: "1".repeat(32),
      actor: "svc_seed",
      vis: "space",
      entity: "resource",
      entity_id: "mbx_privatebox0001",
      payload: {
        id: "mbx_privatebox0001",
        type: "mailbox",
        parent_id: null,
        label: 0,
        owner_id: "usr_olivia",
        holds: 0,
      },
    } as never,
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-grant-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> =>
  startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "grant-live",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === OWNER)
        return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "grant-live" };
      if (t === NOAH) return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "grant-live" };
      if (t === AGENT)
        return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_noah" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  });

const post = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await r.text();
  assert.equal(r.status, 200, `${p}: ${text}`);
  return (JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {};
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


const raw = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; text: string }> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  return { status: r.status, text: await r.text() };
};

const reachOf = async (d: Daemon, id: string, who: string): Promise<string> =>
  (JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "site", id }] }, who)).text) as { data: { items: { level: string }[] } }).data.items[0]!.level;
const make = async (d: Daemon, key: string): Promise<string> => {
  const r = await raw(d, "/v1/sites/create", { name: key, kind: "artifact", access: "space", idempotencyKey: key });
  assert.equal(r.status, 200, r.text);
  return (JSON.parse(r.text) as { data: { site: { siteId: string } } }).data.site.siteId;
};

test("a site set private is private: a member is refused and cannot reach it, its owner can; set back to the Space it is the Space's again", async () => {
  const d = await boot(seededDir());
  try {
    const id = await make(d, "sp-live");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status, 200, "a Space site is open to members");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.notEqual((await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status, 200, "a member still reads a private site");
    assert.equal(await reachOf(d, id, NOAH), "none");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id })).status, 200, "its owner still does");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "space" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status, 200, "back to the Space, a member reads it again");
  } finally {
    await d.stop();
  }
});

test("a site already private in the store before this build is closed when the daemon starts on it", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let id = "";
  try {
    id = await make(d, "sp-old");
    // the old state: the site's own row says private, the kernel still holds it under the Space, no event closed it
    d.db!.run("UPDATE sites_site SET access = 'private' WHERE id = ?", id);
    assert.equal(await reachOf(d, id, NOAH), "edit", "the old state is open to members");
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(await reachOf(d, id, NOAH), "none", "a member still reaches a site its owner set to private");
    assert.notEqual(await reachOf(d, id, OWNER), "none");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
