// Ruling 62: the person's own key, handed to the daemon by their client over loopback, opens their Mine provider for their own turn. Another person's turn cannot open it, lock and a restart close it again,
// and nothing key-like reaches the data directory.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { fileURLToPath } from "node:url";

/** A code root that is this repo with the vault live: every top-level entry a symlink, host/ rebuilt around an edited modules.json (the vault flips in P-L7_LIVE). */
function codeRootWithVaultLive(): string {
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-coderoot-"));
  for (const name of fs.readdirSync(repo)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(repo, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(repo, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(repo, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(repo, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const v = list.modules.find((m) => m.id === "vault");
  assert.ok(v, "host/modules.json lists vault");
  v.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia", OTHER = "tok-usr_noah";
const SECRET = "sk-ant-mine-NEVER-ON-DISK";

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test("vault key (ruling 62): unlock opens the person's Mine provider for their turn, others cannot, lock and a restart close it, nothing key-like on disk", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-vault-key-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const codeRoot = codeRootWithVaultLive();
  const boot = (extra: string[] = []) => startDaemon({
    codeRoot,
    config: loadConfig(["--data-dir", dir, "--port", "0", ...extra], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "vault-key", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER ? "usr_olivia" : t === OTHER ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "dev_vkey" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const personKey = crypto.randomBytes(32);
  let d = await boot(["--role", "space,device"]);
  const post = async (token: string, p: string, body: unknown) => {
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  };
  const fill = (token: string) => post(token, "/v1/vault/fill", { handle: "#Anthropic.api_key", target: { kind: "env", ref: "x" }, returnValue: true });
  const key = (token: string, op: "unlock" | "lock") => post(token, `/local/vault/key/${op}`, op === "unlock" ? { key: personKey.toString("base64") } : {});
  try {
    const locked = await post(OWNER, "/v1/providers/add", { providerKey: "anthropic", connection: "api_key", scope: "mine", apiKey: SECRET, idempotencyKey: "vk-1" });
    assert.notEqual(locked.status, 200, "before unlock a Mine key cannot be saved");
    assert.equal((await key(OWNER, "unlock")).status, 204);
    const added = await post(OWNER, "/v1/providers/add", { providerKey: "anthropic", connection: "api_key", scope: "mine", apiKey: SECRET, idempotencyKey: "vk-2" });
    assert.equal(added.status, 200, added.text);
    const own = await fill(OWNER);
    assert.equal(own.status, 200, own.text);
    assert.equal((JSON.parse(own.text) as { data: { value: string } }).data.value, SECRET, "their own turn opens it");

    assert.equal((await key(OTHER, "unlock")).status, 204, "another person unlocks their own key");
    const theirs = await fill(OTHER);
    assert.notEqual(theirs.status, 200, "but their turn cannot open Olivia's");
    assert.ok(!theirs.text.includes(SECRET));
    assert.equal((await key(OTHER, "lock")).status, 204);

    // not local: a forwarded request is refused (a remote caller through a proxy on this machine)
    const forwarded = await new Promise<number>((resolve, reject) => {
      const u = new URL(d.url);
      const req = http.request({ host: u.hostname, port: u.port, path: "/local/vault/key/unlock", method: "POST", headers: { authorization: `Bearer ${OWNER}`, "x-forwarded-for": "203.0.113.9", "content-type": "application/json" } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
      req.on("error", reject); req.end(JSON.stringify({ key: personKey.toString("base64") }));
    });
    assert.equal(forwarded, 403);

    assert.equal((await key(OWNER, "lock")).status, 204);
    const after = await fill(OWNER);
    assert.equal((JSON.parse(after.text) as { error?: { code?: string } }).error?.code, "auth.unauthenticated", "locked: " + after.text);
    assert.equal((await key(OWNER, "unlock")).status, 204);
    assert.equal((await fill(OWNER)).status, 200);
    await d.stop();
    d = await boot(["--role", "space,device"]);
    const restarted = await fill(OWNER);
    assert.equal((JSON.parse(restarted.text) as { error?: { code?: string } }).error?.code, "auth.unauthenticated", "a restart forgets the key");
    for (const f of walk(dir)) {
      const bytes = fs.readFileSync(f);
      for (const needle of [personKey, Buffer.from(personKey.toString("hex")), Buffer.from(personKey.toString("base64")), Buffer.from(SECRET)]) assert.ok(!bytes.includes(needle), `${path.basename(f)} holds nothing key-like`);
    }
  } finally { await d.stop(); }
  // a Space server that is not the person's own (space role only, owner someone else) never holds the key
  const server = await boot();
  try {
    const refused = await fetch(`${server.url}/local/vault/key/unlock`, { method: "POST", headers: { authorization: `Bearer ${OTHER}`, "content-type": "application/json" }, body: JSON.stringify({ key: personKey.toString("base64") }) });
    assert.equal(refused.status, 403, "a node that is not theirs does not take their key");
  } finally { await server.stop(); }
});
