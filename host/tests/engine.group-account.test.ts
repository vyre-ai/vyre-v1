// Group setup checks a usable account first, on a booted daemon through the gateway: nobody in this Space has an AI account, so a person who joins a channel with an agent is named there, once.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-group-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "group-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "group-live" } : null;
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

test("a person who joins a channel with an agent, with no account any agent could use, is named in one line of that channel", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/agents/create", { name: "Group helper", idempotencyKey: "group-agent" });
    const agentId = String((made["agent"] as { agentId: string }).agentId);
    const ch = (await ok(d, "/v1/channels/create", { name: "intake", visibility: "invite", agentIds: [agentId], idempotencyKey: "group-channel" }))["channel"] as { channelId: string; mainThreadId: string };
    await ok(d, "/v1/channels/members/add", { channelId: ch.channelId, personIds: ["usr_noah"], idempotencyKey: "group-add" });
    const line = await until("the account line", 15_000, async () => {
      const out = await ok(d, "/v1/chat/messages/list", { threadId: ch.mainThreadId });
      const blocks = ((out["messages"] as Array<{ blocks?: Array<{ type?: string; data?: { text?: string } }> }>) ?? []).flatMap((m) => m.blocks ?? []);
      return blocks.find((b) => b.type === "turn_status" && /no AI account/.test(b.data?.text ?? ""))?.data?.text;
    });
    assert.match(line, /^Noah has no AI account here yet/);
  } finally { await d.stop(); }
});
