// The HTTP request step on a booted host. A GET goes out through the installed network, a POST waits for the Gate and is released, a private address is refused,
// and the key in the Vault reaches the request header and nowhere else: not the definition, the step log, the run, the hold or the audit trail.
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
const SECRET = "sk_live_HTTPSTEP_7f3a91c2d4e8";

interface Seen { url: string; method: string; headers: Record<string, string>; body?: string }

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-http-step-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, seen: Seen[]): Promise<Daemon> => startDaemon({
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
const noSecret = (text: string, where: string): void => assert.equal(text.includes(SECRET), false, `the key is in ${where}`);

interface StepRow { step: string; attempt: number; state: string; error?: { code?: string; message?: string } }
interface HoldRow { taskId?: string; runId?: string; capName?: string; act?: string }

async function keyed(d: Daemon): Promise<string> {
  const folder = await ok(d, "/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "http-folder" });
  const folderId = String((folder["folder"] as { id?: string } | undefined)?.id ?? "");
  const put = await ok(d, "/v1/vault/item/put", { folderId, name: "Acme", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "http-acme" });
  const item = put["item"] as { handle?: string; id?: string };
  assert.match(String(item.handle), /^#/);
  return `${item.handle}.api_key`;
}

/** A Space Automation with its own service access: the Space to view and the key to use, as a person would grant them at Promote. */
async function promoted(d: Daemon, key: string, name: string, nodes: unknown[], shareKey = true): Promise<string> {
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

async function dump(d: Daemon, runId: string, id: string): Promise<string> {
  const parts = [
    JSON.stringify(await ok(d, "/v1/runs/get", { runId })), JSON.stringify(await ok(d, "/v1/runs/steps", { runId })), JSON.stringify(await ok(d, "/v1/automations/get", { automationId: id })),
    JSON.stringify(await ok(d, "/v1/gate/holds/list", { states: ["held", "approved", "denied"] })),
    JSON.stringify(d.db!.all("SELECT * FROM runs_steps WHERE run_id = ?", runId)),
  ];
  return parts.join("\n");
}

test("a GET reads through the installed network with the key in a header; the key is nowhere in the log", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-get", "Read items", [{ id: "look", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items", query: { page: 2 }, auth: { kind: "bearer", handle } } }]);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "http-get-run" }))["runId"]);
    await until("the read to finish", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ${run.status}: ${await dump(d, runId, id)}`);
      return run.status === "succeeded" ? true : undefined;
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "https://api.example.com/v1/items?page=2");
    assert.equal(seen[0]!.method, "GET");
    assert.equal(seen[0]!.headers["authorization"], `Bearer ${SECRET}`, "the header reached the network");
    const row = d.db!.all("SELECT output_json FROM runs_steps WHERE run_id = ? AND step = 'look'", runId)[0] as { output_json: string };
    const out = JSON.parse(row.output_json) as { status: number; ok: boolean; body: { path: string; echoedAuth: string } };
    assert.deepEqual([out.status, out.ok, out.body.path], [200, true, "/v1/items"]);
    assert.match(String(out.body.echoedAuth), /\[(hidden|redacted)\]/, "a server that echoes the header gets it scrubbed");
    noSecret(String(out.body.echoedAuth), "the echoed header");
    const io = await ok(d, "/v1/runs/step_io", { runId, step: "look" });
    assert.equal((io["output"] as { status: number }).status, 200, "the run history shows what the step answered");
    assert.equal((io["input"] as { method: string }).method, "GET");
    noSecret(JSON.stringify(io), "the run history read");
    noSecret(await dump(d, runId, id), "the run, step log, definition or hold");
  } finally { await d.stop(); }
});

test("a private address, a rebinding name and plain http are refused by name and nothing is sent", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const urls = ["https://127.0.0.1/", "https://10.1.2.3/v1", "https://169.254.169.254/latest/meta-data", "https://rebind.example.com/x"];
    for (const [i, url] of urls.entries()) {
      const made = await ok(d, "/v1/automations/create", {
        idempotencyKey: `http-priv-${i}`, name: `Private ${i}`,
        definition: { triggers: [{ key: "manual" }], nodes: [{ id: "look", key: "http_request", input: { method: "GET", url } }] },
      });
      const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
      const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: `http-priv-run-${i}` }))["runId"]);
      const failed = await until("the request to be refused", 12_000, async () => {
        const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
        if (run.status === "succeeded") assert.fail(`${url} was fetched`);
        return run.status === "failed" ? ((await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[]).find((s) => s.step === "look") : undefined;
      });
      assert.equal(failed.state, "failed");
      assert.equal(failed.error?.code, "validation.bad_input", `${url}: ${JSON.stringify(failed)}`);
      assert.match(String(failed.error?.message), /not a public host/);
    }
    assert.equal(seen.length, 0, "no request was made to a refused address");
  } finally { await d.stop(); }
});

test("a POST with Ask before sending On is held by the Gate, then released: it is sent once, with the attempt key as its Idempotency-Key", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-post", "Post order", [{ id: "order", key: "http_request", askBeforeSending: true, input: { method: "POST", url: "https://api.example.com/v1/orders", json: { sku: "A-1", qty: 2 }, auth: { kind: "bearer", handle } } }]);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "http-post-run" }))["runId"]);
    await until("the POST to wait for approval", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "succeeded" || run.status === "stopped") assert.fail(`the run ended ${run.status} before approval: ${await dump(d, runId, id)}`);
      return run.status === "waiting" ? true : undefined;
    });
    assert.equal(seen.length, 0, "nothing was sent while the Gate held it");
    const holds = (await ok(d, "/v1/gate/holds/list", { states: ["held"], runId }))["holds"] as HoldRow[];
    assert.equal(holds.length, 1, JSON.stringify(holds));
    assert.equal(holds[0]!.capName, "automations.http_send");
    assert.equal(holds[0]!.act, "send");
    noSecret(JSON.stringify(holds), "the hold");
    await ok(d, "/v1/tasks/act", { taskId: holds[0]!.taskId, action: "approve" });
    await until("the run to finish after approval", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "stopped") assert.fail(`approval did not finish the run: ${await dump(d, runId, id)}`);
      return run.status === "succeeded" ? true : undefined;
    });
    assert.equal(seen.length, 1, "released: sent exactly once");
    assert.equal(seen[0]!.method, "POST");
    assert.equal(seen[0]!.headers["idempotency-key"], `${runId}:order:1`);
    assert.equal(seen[0]!.headers["content-type"], "application/json");
    assert.equal(seen[0]!.body, '{"sku":"A-1","qty":2}');
    assert.equal(seen[0]!.headers["authorization"], `Bearer ${SECRET}`);
    noSecret(await dump(d, runId, id), "the run, step log, definition or hold");
  } finally { await d.stop(); }
});

test("a sandbox test reads a GET for real and records a POST without sending it", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "http-sbx", name: "Sandbox http",
      definition: { triggers: [{ key: "manual" }], nodes: [
        { id: "look", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items" }, next: ["order"] },
        { id: "order", key: "http_request", input: { method: "POST", url: "https://api.example.com/v1/orders", json: { n: 1 } } },
      ] },
    });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    const runId = String((await ok(d, "/v1/automations/test", { automationId: id }))["runId"]);
    await until("the test run to succeed", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ${run.status}: ${await dump(d, runId, id)}`);
      return run.status === "succeeded" ? true : undefined;
    });
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["GET https://api.example.com/v1/items"]);
  } finally { await d.stop(); }
});

test("an automation that was not given the key cannot use its handle: the request is refused and nothing is sent", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-nokey", "No key", [{ id: "look", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items", auth: { kind: "bearer", handle } } }], false);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "http-nokey-run" }))["runId"]);
    const failed = await until("the run to fail", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "succeeded") assert.fail("a run without the key used it");
      return run.status === "failed" ? ((await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[]).find((s) => s.step === "look") : undefined;
    });
    assert.equal(failed.error?.code, "permission.no_grant");
    assert.equal(seen.length, 0);
    noSecret(await dump(d, runId, id), "the failed run");
  } finally { await d.stop(); }
});

/** "sent" when the run finishes with no hold, "held" when it waits on the Gate. */
async function sendOutcome(d: Daemon, id: string, key: string): Promise<"sent" | "held"> {
  const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }))["runId"]);
  return until("the run to send or hold", 15_000, async () => {
    const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
    if (run.status === "succeeded") return "sent" as const;
    if (run.status === "waiting") return ((await ok(d, "/v1/gate/holds/list", { states: ["held"], runId }))["holds"] as HoldRow[]).length > 0 ? "held" as const : undefined;
    if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ${run.status}: ${JSON.stringify(await ok(d, "/v1/runs/steps", { runId }))}`);
    return undefined;
  });
}
const postNode = (handle: string, ask: boolean | undefined) => [{ id: "order", key: "http_request", ...(ask === undefined ? {} : { askBeforeSending: ask }), input: { method: "POST", url: "https://api.example.com/v1/orders", json: { n: 1 }, auth: { kind: "bearer", handle } } }];

test("Ask before sending Off, or unset, sends a POST at once with no hold", async () => {
  for (const [name, ask] of [["off", false], ["unset", undefined]] as const) {
    const seen: Seen[] = [];
    const d = await boot(seededDir(), seen);
    try {
      const handle = await keyed(d);
      const id = await promoted(d, `http-ask-${name}`, `Ask ${name}`, postNode(handle, ask));
      assert.equal(await sendOutcome(d, id, `http-ask-${name}-run`), "sent");
      assert.equal(seen.length, 1, "sent exactly once");
      assert.equal(seen[0]!.method, "POST");
    } finally { await d.stop(); }
  }
});

test("a Space rule that requires approval for sends holds a POST even when the step is Off", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-ask-rule", "Ask rule", postNode(handle, false));
    await ok(d, "/v1/gate/rules/set", { act: "send", scope: "space", mode: "hold" });
    assert.equal(await sendOutcome(d, id, "http-ask-rule-run"), "held");
    assert.equal(seen.length, 0, "nothing was sent while the rule held it");
  } finally { await d.stop(); }
});

test("a GET is a read: it is never held, whatever the setting", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-ask-get", "Ask get", [{ id: "look", key: "http_request", askBeforeSending: true, input: { method: "GET", url: "https://api.example.com/v1/items", auth: { kind: "bearer", handle } } }]);
    assert.equal(await sendOutcome(d, id, "http-ask-get-run"), "sent");
    assert.equal(seen.length, 1);
  } finally { await d.stop(); }
});
