// An agent that tries to read a Vault item never receives the key, and the stored turn does not contain it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import type { SeamFetch } from "../src/seams/ports.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const AGENT = "tok-agt_scout";
const SECRET = "sk_live_SECRET";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-transcript-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, seamFetch?: SeamFetch): Promise<Daemon> => startDaemon({
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
  seams: { vaultSinks: { env: () => undefined }, ...(seamFetch ? { fetch: seamFetch } : {}) },
  session: (h) => {
    const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    if (token === OWNER) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" };
    if (token === AGENT) return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_olivia", device: "exec-live" };
    return null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
} satisfies DaemonOptions);

async function post(d: Daemon, token: string, route: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> {
  const response = await fetch(`${d.url}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: response.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
}

function noSecret(text: string, where: string): void {
  assert.equal(text.includes(SECRET), false, `${where} contained the key: ${text}`);
}

test("an agent that reads a Vault item never receives the key, and the turn transcript does not contain it", async () => {
  const dir = seededDir();
  const daemon = await boot(dir);
  try {
    const folder = await post(daemon, OWNER, "/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "transcript-folder" });
    assert.equal(folder.status, 200, folder.text);
    const folderId = String((folder.data["folder"] as { id?: string } | undefined)?.id ?? "");
    assert.match(folderId, /^vfd_/);
    const put = await post(daemon, OWNER, "/v1/vault/item/put", {
      folderId, name: "Stripe", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "transcript-stripe",
    });
    assert.equal(put.status, 200, put.text);
    const item = put.data["item"] as { id?: string; handle?: string } | undefined;
    const itemId = String(item?.id ?? "");
    const handle = String(item?.handle ?? "");
    assert.match(itemId, /^vit_/);
    assert.match(handle, /^#/);

    const reveal = await post(daemon, AGENT, "/v1/vault/item/reveal", { itemId });
    noSecret(reveal.text, "reveal");
    assert.equal(reveal.text.includes("Agents use values by handle; they never see them."), true, reveal.text);
    let revealBody: unknown = reveal.text;
    try { revealBody = JSON.parse(reveal.text); } catch { /* append the raw body when it is not JSON */ }

    const fill = await post(daemon, AGENT, "/v1/vault/fill", {
      handle: `${handle}.api_key`, target: { kind: "env", ref: "STRIPE_KEY" }, returnValue: true,
    });
    noSecret(fill.text, "fill");
    assert.equal(fill.text.includes("Agents use values by handle"), true, fill.text);

    const started = await post(daemon, OWNER, "/v1/chat/start", { kind: "chat", agentIds: ["agt_scout"], idempotencyKey: "transcript-chat" });
    assert.equal(started.status, 200, started.text);
    const threadId = String((started.data["thread"] as { threadId?: string } | undefined)?.threadId ?? "");
    assert.match(threadId, /^thr_/);

    const enqueued = await post(daemon, AGENT, "/v1/engine/turn/enqueue", {
      threadId, agentId: "agt_scout", kind: "wake", from: "usr_olivia",
    });
    assert.equal(enqueued.status, 200, enqueued.text);
    const qseq = enqueued.data["qseq"];
    assert.equal(typeof qseq, "number");

    const running = await post(daemon, AGENT, "/v1/engine/turn/start", {
      threadId, agentId: "agt_scout", qseq, placement: "host", engine: "anthropic", model: "claude",
    });
    assert.equal(running.status, 200, running.text);
    const turnId = String((running.data["turn"] as { turnId?: string } | undefined)?.turnId ?? "");
    assert.match(turnId, /^trn_/);

    const appended = await post(daemon, AGENT, "/v1/engine/turn/append", { turnId, kind: "tool_result", data: revealBody });
    assert.equal(appended.status, 200, appended.text);
    noSecret(appended.text, "append");

    const got = await post(daemon, AGENT, "/v1/engine/turn/get", { turnId });
    assert.equal(got.status, 200, got.text);
    noSecret(got.text, "turn get");
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a try_read response from the app never enters an agent turn transcript", async () => {
  const BODY = "customer_body_MARK_7731";
  const sent: string[] = [];
  const seamFetch: SeamFetch = async (url) => {
    sent.push(url);
    return { status: 200, text: async () => BODY, arrayBuffer: async () => new TextEncoder().encode(BODY).buffer as ArrayBuffer };
  };
  const dir = seededDir();
  const daemon = await boot(dir, seamFetch);
  try {
    const folder = await post(daemon, OWNER, "/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "tr-read-folder" });
    const folderId = String((folder.data["folder"] as { id?: string } | undefined)?.id ?? "");
    const put = await post(daemon, OWNER, "/v1/vault/item/put", {
      folderId, name: "Stripe", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "tr-read-stripe",
    });
    const handle = String((put.data["item"] as { handle?: string } | undefined)?.handle ?? "");
    assert.match(handle, /^#/);

    const read = await post(daemon, OWNER, "/v1/automations/try_read", {
      method: "GET", path: "/v1/customers", domains: ["api.stripe.com"], vaultItemId: `${handle}.api_key`, actionKey: "list_customers",
    });
    assert.equal(read.status, 200, read.text);
    assert.equal(read.data["level"], "tested", read.text);
    assert.equal(sent.length, 1, "the host made the one read");
    // the reply is the level and the app's HTTP status code (so the agent can say tested or failed), never the app's body
    assert.deepEqual(Object.keys(read.data).sort(), ["level", "status"], "the reply is the level and the status only");
    assert.equal(typeof read.data["status"], "number", "the status is the bare HTTP code");
    noSecret(read.text, "try_read reply");
    assert.equal(read.text.includes(BODY), false, `the app's response reached the reply: ${read.text}`);

    const started = await post(daemon, OWNER, "/v1/chat/start", { kind: "chat", agentIds: ["agt_scout"], idempotencyKey: "tr-read-chat" });
    const threadId = String((started.data["thread"] as { threadId?: string } | undefined)?.threadId ?? "");
    const enqueued = await post(daemon, AGENT, "/v1/engine/turn/enqueue", { threadId, agentId: "agt_scout", kind: "wake", from: "usr_olivia" });
    const running = await post(daemon, AGENT, "/v1/engine/turn/start", { threadId, agentId: "agt_scout", qseq: enqueued.data["qseq"], placement: "host", engine: "anthropic", model: "claude" });
    const turnId = String((running.data["turn"] as { turnId?: string } | undefined)?.turnId ?? "");
    assert.match(turnId, /^trn_/);
    // The agent asks for the same read and the whole reply goes into the turn, as an engine does with a tool result.
    const asAgent = await post(daemon, AGENT, "/v1/automations/try_read", {
      method: "GET", path: "/v1/customers", domains: ["api.stripe.com"], vaultItemId: `${handle}.api_key`, actionKey: "list_customers",
    });
    assert.equal(asAgent.status, 200, asAgent.text);
    noSecret(asAgent.text, "agent try_read reply");
    assert.equal(asAgent.text.includes(BODY), false, asAgent.text);
    let toolResult: unknown = asAgent.text;
    try { toolResult = JSON.parse(asAgent.text); } catch { /* the raw body is appended when it is not JSON */ }
    const appended = await post(daemon, AGENT, "/v1/engine/turn/append", { turnId, kind: "tool_result", data: toolResult });
    assert.equal(appended.status, 200, appended.text);
    const got = await post(daemon, AGENT, "/v1/engine/turn/get", { turnId });
    assert.equal(got.status, 200, got.text);
    noSecret(got.text, "turn get");
    assert.equal(got.text.includes(BODY), false, `the app's response is in the transcript: ${got.text}`);
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
