// What an agent does with Sites on a booted daemon, through the gateway: artifact_publish works as the agent for the person it acts for, the card's artifact opens for that person, and going public is held by the Gate.
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("an agent publishes an artifact for its person, and its going public is held", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sites-agent-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  let agent = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "sites-agent", free: 80e9,
      commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === "olivia") return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_x" };
      if (t === "agent") return { space: "spc_core", principal: { kind: "agent", id: agent }, actingFor: "usr_olivia" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    agent = (d.db!.all("SELECT id FROM agents_agent WHERE deletedAt IS NULL LIMIT 1")[0] as { id?: string } | undefined)?.id ?? "";
    assert.ok(agent, "the seed has an agent");
    const call = async (token: string, p: string, body: unknown): Promise<{ status: number; json: any }> => {
      const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json() };
    };
    const pub = await call("agent", "/v1/sites/artifact_publish", { idempotencyKey: "a1", title: "Numbers", html: "<p>42</p>" });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    const id = pub.json.data.artifactId as string;
    assert.equal(pub.json.data.url, `https://team.example.com/a/${id}`);
    const open = await call("olivia", "/v1/sites/artifact_open", { idempotencyKey: "o1", artifactId: id });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    assert.equal(await (await fetch(`${d.url}${open.json.data.path}`)).text(), "<p>42</p>");
    const list = await call("olivia", "/v1/sites/list", { kind: "artifact" });
    assert.ok(JSON.stringify(list.json).includes(id), "it is in the person's list");
    const made = await call("agent", "/v1/sites/create", { idempotencyKey: "s1", name: "Shop", port: 3000 });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const held = await call("agent", "/v1/sites/promote", { idempotencyKey: "s2", siteId: made.json.data.site.siteId });
    assert.equal(held.status, 202, JSON.stringify(held.json));
    assert.equal(held.json.data.status, "held");
    const after = await call("olivia", "/v1/sites/get", { siteId: made.json.data.site.siteId });
    assert.equal(after.json.data.site.live, false);
  } finally { await d.stop(); }
});
