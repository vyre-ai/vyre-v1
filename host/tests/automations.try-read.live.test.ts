// One safe read. The host puts the Vault key on the request. The reply is only the level.
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
import type { SeamFetch } from "../src/seams/ports.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const SECRET = "sk_live_SECRET";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-try-read-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("a safe read marks the connector tested and the reply has no key", async () => {
  const seen: { url: string; authorization: string | undefined; body: string }[] = [];
  const seamFetch: SeamFetch = async (url, init) => {
    const body = SECRET;
    seen.push({ url, authorization: init?.headers?.["authorization"], body });
    return { status: url.startsWith("https://api.stripe.com/") ? 204 : 500, text: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const dir = seededDir();
  const daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "exec-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    seams: { vaultSinks: { env: () => undefined }, fetch: seamFetch },
    session: (h) => {
      const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      return token === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, tick: 200 },
  } satisfies DaemonOptions);
  const post = async (route: string, body: unknown) => {
    const response = await fetch(`${daemon.url}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
    return { status: response.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, json, text };
  };
  try {
    const folder = await post("/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "try-read-folder" });
    assert.equal(folder.status, 200, folder.text);
    const folderId = String((folder.data["folder"] as { id?: string } | undefined)?.id ?? "");
    const put = await post("/v1/vault/item/put", {
      folderId, name: "Stripe", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "try-read-stripe",
    });
    assert.equal(put.status, 200, put.text);
    const handle = String((put.data["item"] as { handle?: string } | undefined)?.handle ?? "");
    assert.match(handle, /^#/);

    const read = await post("/v1/automations/try_read", {
      method: "GET", path: "/v1/customers", domains: ["api.stripe.com"], vaultItemId: `${handle}.api_key`, actionKey: "stripe-listcustomers",
    });
    assert.equal(read.status, 200, read.text);
    assert.equal(read.data["level"], "tested", read.text);
    assert.equal(read.text.includes(SECRET), false, read.text);
    const stripe = seen.filter((call) => call.url.startsWith("https://api.stripe.com/"));
    assert.equal(stripe.length, 1, JSON.stringify(seen.map((call) => call.url)));
    assert.equal(stripe[0]?.authorization, `Bearer ${SECRET}`);
    assert.equal(stripe[0]?.url, "https://api.stripe.com/v1/customers");

    const made = await post("/v1/automations/create", { idempotencyKey: "try-read-auto", name: "stripe-read" });
    assert.equal(made.status, 200, made.text);
    const automationId = String((made.data["automation"] as { id?: string } | undefined)?.id ?? "");
    const saved = await post("/v1/automations/update", {
      automationId,
      definition: {
        triggers: [{ key: "manual" }],
        nodes: [{ id: "list-customers", key: "stripe-listcustomers", title: "Stripe: List customers", input: { connectorLevel: "tested" } }],
      },
    });
    assert.equal(saved.status, 200, saved.text);
    const enabled = await post("/v1/automations/set_enabled", { automationId, enabled: true });
    assert.equal(enabled.status, 200, enabled.text);
    assert.equal((enabled.data["automation"] as { status?: string } | undefined)?.status, "on");
    assert.equal(enabled.text.includes(SECRET), false, enabled.text);

    const before = seen.length;
    const foreign = await post("/v1/automations/try_read", {
      method: "GET", path: "https://evil.example/v1", domains: ["api.stripe.com"], vaultItemId: `${handle}.api_key`,
    });
    assert.equal(foreign.data["level"], "draft", foreign.text);
    assert.equal(foreign.text.includes(SECRET), false, foreign.text);
    assert.equal(seen.length, before);
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
