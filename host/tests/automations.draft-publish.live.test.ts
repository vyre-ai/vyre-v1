// A drafted connector action can sit on a draft. Turning that Automation on is refused.
// An input that claims connectorLevel "tested" is not a stored test, so it is refused the same way.
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
const DRAFT_REASON = "A drafted action cannot be published.";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-draft-publish-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> => startDaemon({
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
  session: (h) => {
    const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return token === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
} satisfies DaemonOptions);

async function post(d: Daemon, route: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; json: Record<string, unknown>; text: string }> {
  const response = await fetch(`${d.url}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: response.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, json, text };
}

test("a drafted connector action cannot be turned on, and a claimed tested level is refused the same way", async () => {
  const dir = seededDir();
  const daemon = await boot(dir);
  try {
    const made = await post(daemon, "/v1/automations/create", { idempotencyKey: "draft-connector-save", name: "stripe-draft" });
    assert.equal(made.status, 200, made.text);
    const id = String((made.data["automation"] as { id?: string } | undefined)?.id ?? "");
    assert.match(id, /^aut_/);
    const saved = await post(daemon, "/v1/automations/update", {
      automationId: id,
      definition: {
        triggers: [{ key: "manual" }],
        nodes: [{ id: "create-customer", key: "stripe-createcustomer", title: "Stripe: Create customer", input: { connectorLevel: "draft" } }],
      },
    });
    assert.equal(saved.status, 200, saved.text);
    const refused = await post(daemon, "/v1/automations/set_enabled", { automationId: id, enabled: true });
    assert.equal(refused.status, 422, refused.text);
    const error = refused.json["error"] as { code?: string; message?: string; details?: { reason?: string } } | undefined;
    assert.equal(error?.code, "validation.precondition_failed", refused.text);
    assert.equal(error?.message, DRAFT_REASON, refused.text);
    assert.equal(error?.details?.reason, "draft", refused.text);
    const still = await post(daemon, "/v1/automations/get", { automationId: id });
    assert.notEqual((still.data["automation"] as { status?: string } | undefined)?.status, "on");

    const tested = await post(daemon, "/v1/automations/create", { idempotencyKey: "tested-connector-save", name: "stripe-tested" });
    assert.equal(tested.status, 200, tested.text);
    const testedId = String((tested.data["automation"] as { id?: string } | undefined)?.id ?? "");
    const turned = await post(daemon, "/v1/automations/update", {
      automationId: testedId,
      definition: {
        triggers: [{ key: "manual" }],
        nodes: [{ id: "list-customers", key: "stripe-listcustomers", title: "Stripe: List customers", input: { connectorLevel: "tested" } }],
      },
    });
    assert.equal(turned.status, 200, turned.text);
    const enabled = await post(daemon, "/v1/automations/set_enabled", { automationId: testedId, enabled: true });
    assert.equal(enabled.status, 422, enabled.text);
    const testedError = enabled.json["error"] as { code?: string; message?: string; details?: { reason?: string } } | undefined;
    assert.equal(testedError?.code, "validation.precondition_failed", enabled.text);
    assert.equal(testedError?.message, DRAFT_REASON, enabled.text);
    assert.equal(testedError?.details?.reason, "draft", enabled.text);
    const stillTested = await post(daemon, "/v1/automations/get", { automationId: testedId });
    assert.notEqual((stillTested.data["automation"] as { status?: string } | undefined)?.status, "on");
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
