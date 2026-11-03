// The booted host the HTTP request step tests share (automations.http.live.test.ts and automations.http.send.live.test.ts): a seeded Space, a daemon whose network stub records
// every request it is asked to send, the owner's calls, and the Vault key and Space Automation each test starts from. Each test boots its own daemon from it.
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
export const SECRET = "sk_live_HTTPSTEP_7f3a91c2d4e8";

export interface Seen { url: string; method: string; headers: Record<string, string>; body?: string }

export function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-http-step-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

export const boot = (dir: string, seen: Seen[]): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "http-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  seams: {
    vaultSinks: { env: () => undefined },
    drivers: {
      // the network every HTTP request step goes through: public names resolve to one public address, and the stub answers whatever connects to it
      setDocumentNetwork: () => ({
        lookup: async (host: string) => (host === "rebind.example.com" ? ["93.184.216.34", "10.0.0.5"] : ["93.184.216.34"]),
        fetch: async () => { throw new Error("the pinned connect is used"); },
        connect: async (r: { url: URL; method?: string; headers?: Record<string, string>; body?: string }) => {
          seen.push({ url: r.url.href, method: r.method ?? "GET", headers: { ...(r.headers ?? {}) }, ...(r.body !== undefined ? { body: r.body } : {}) });
          return new Response(JSON.stringify({ ok: true, path: r.url.pathname, echoedAuth: r.headers?.["authorization"] ?? null }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_1" } });
        },
      }),
    },
  },
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "http-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
} satisfies DaemonOptions);

const call = async (d: Daemon, p: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
export const ok = async (d: Daemon, p: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};
export async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
export const noSecret = (text: string, where: string): void => assert.equal(text.includes(SECRET), false, `the key is in ${where}`);

export interface StepRow { step: string; attempt: number; state: string; error?: { code?: string; message?: string } }
export interface HoldRow { taskId?: string; runId?: string; capName?: string; act?: string }

export async function keyed(d: Daemon): Promise<string> {
  const folder = await ok(d, "/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "http-folder" });
  const folderId = String((folder["folder"] as { id?: string } | undefined)?.id ?? "");
  const put = await ok(d, "/v1/vault/item/put", { folderId, name: "Acme", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "http-acme" });
  const item = put["item"] as { handle?: string; id?: string };
  assert.match(String(item.handle), /^#/);
  return `${item.handle}.api_key`;
}

/** A Space Automation with its own service access: the Space to view and the key to use, as a person would grant them at Promote. */
export async function promoted(d: Daemon, key: string, name: string, nodes: unknown[], shareKey = true): Promise<string> {
  const made = await ok(d, "/v1/automations/create", { idempotencyKey: key, name });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  const serviceId = `svc_${id.slice(4)}`;
  await ok(d, "/v1/automations/update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes } });
  await ok(d, "/v1/automations/promote", { automationId: id, confirm: true });
  await ok(d, "/v1/access/share", { idempotencyKey: `${key}-space`, resource: { type: "space", id: "spc_core" }, subject: { kind: "service", id: serviceId }, level: "view" });
  if (!shareKey) return id;
  const items = (await ok(d, "/v1/vault/items/list", {}))["items"] as { id: string; name?: string }[] | undefined;
  const acme = items?.find((i) => i.name === "Acme");
  assert.ok(acme, "the Acme item is listed");
  await ok(d, "/v1/access/share", { idempotencyKey: `${key}-vault`, resource: { type: "vault_item", id: acme.id }, subject: { kind: "service", id: serviceId }, level: "use" });
  return id;
}

export async function dump(d: Daemon, runId: string, id: string): Promise<string> {
  const parts = [
    JSON.stringify(await ok(d, "/v1/runs/get", { runId })), JSON.stringify(await ok(d, "/v1/runs/steps", { runId })), JSON.stringify(await ok(d, "/v1/automations/get", { automationId: id })),
    JSON.stringify(await ok(d, "/v1/gate/holds/list", { states: ["held", "approved", "denied"] })),
    JSON.stringify(d.db!.all("SELECT * FROM runs_steps WHERE run_id = ?", runId)),
  ];
  return parts.join("\n");
}

/** "sent" when the run finishes with no hold, "held" when it waits on the Gate. */
export async function sendOutcome(d: Daemon, id: string, key: string): Promise<"sent" | "held"> {
  const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }))["runId"]);
  return until("the run to send or hold", 15_000, async () => {
    const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
    if (run.status === "succeeded") return "sent" as const;
    if (run.status === "waiting") return ((await ok(d, "/v1/gate/holds/list", { states: ["held"], runId }))["holds"] as HoldRow[]).length > 0 ? "held" as const : undefined;
    if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ${run.status}: ${JSON.stringify(await ok(d, "/v1/runs/steps", { runId }))}`);
    return undefined;
  });
}
export const postNode = (handle: string, ask: boolean | undefined) => [{ id: "order", key: "http_request", ...(ask === undefined ? {} : { askBeforeSending: ask }), input: { method: "POST", url: "https://api.example.com/v1/orders", json: { n: 1 }, auth: { kind: "bearer", handle } } }];
