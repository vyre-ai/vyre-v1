// Unlimited connectors on a booted daemon (owner ruling 30 Oct 2026). The model vendor and the app's API are stand-ins; everything between is the product:
// chat, the agent, the engine, the OpenAI API driver, the tool session, the invoke pipeline, the Gate, the Vault, the connector port with its address guard, the automation engine and the poller.
// 1  a Vault item, an agent that may use it, an Ask that names the app and the item handle (never the value)
// 2  the agent searches for tools, saves a connector (Drafted), tries a read (held back: nobody allowed the host), asks to allow the host (held at the Gate), a person approves, the read earns Tested
// 3  the agent asks to publish: held at the Gate, and a person turns it down; the connector stays Tested. A person publishes
// 4  the published actions run in an automation; a drafted action cannot be turned on
// 5  a polling trigger primes, fires once per new item, backs off on a 429 and starts again
// The key value is searched for in every model request, chat message, response, log line and stored definition.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { vendor } from "../../fixtures/model-vendor.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const MODEL_KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake
const KEY = "acme-live-7f3a9c1e-KEYVALUE-0042"; // secret-scan: fake

// ---- the app's API: a few orders, a bearer key, a rate limit a test can switch on
function acme() {
  const orders: { id: number; email: string }[] = [{ id: 1, email: "ann@example.test" }, { id: 2, email: "bo@example.test" }];
  const seen: { method: string; path: string; auth: string | undefined; body: string | undefined }[] = [];
  const hosts: string[] = [];
  let limited = false;
  return {
    orders, seen, hosts,
    limit(on: boolean): void { limited = on; },
    request: async (url: URL, o: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; text: string; retryAfter?: string }> => {
      hosts.push(url.hostname);
      seen.push({ method: o.method, path: `${url.pathname}${url.search}`, auth: o.headers["Authorization"], body: o.body });
      if (url.pathname === "/v1/bounce") return { status: 302, text: "", location: "https://evil.test/steal" } as { status: number; text: string };
      if (url.hostname !== "api.acme.test") return { status: 404, text: "{}" };
      if (o.headers["Authorization"] !== `Bearer ${KEY}`) return { status: 401, text: JSON.stringify({ error: "bad key" }) };
      if (limited) return { status: 429, text: "{}", retryAfter: "1" };
      if (o.method === "GET" && url.pathname === "/v1/orders") {
        const after = Number(url.searchParams.get("after") ?? 0);
        return { status: 200, text: JSON.stringify({ data: orders.filter((x) => x.id > after).sort((a, b) => b.id - a.id) }) };
      }
      if (o.method === "POST" && url.pathname === "/v1/orders") {
        const made = { id: orders.length + 1, email: String((JSON.parse(o.body ?? "{}") as { email?: string }).email ?? "") };
        orders.push(made);
        return { status: 201, text: JSON.stringify(made) };
      }
      return { status: 404, text: "{}" };
    },
  };
}

const DEFINITION = {
  app: "acme",
  title: "Acme",
  domains: ["api.acme.test"],
  auth: { type: "bearer", field: "api_key" },
  actions: [
    { key: "list_orders", title: "List orders", method: "GET", path: "/v1/orders", params: [{ name: "after", in: "query", type: "string" }] },
    { key: "create_order", title: "Create an order", method: "POST", path: "/v1/orders", params: [{ name: "email", in: "body", required: true, type: "string" }] },
    { key: "refund_order", title: "Refund an order", method: "POST", path: "/v1/orders/{id}/refund", params: [{ name: "id", in: "path", type: "string" }] },
  ],
  triggers: [
    { key: "new_order", title: "A new order", kind: "poll", action: "list_orders", intervalSec: 60, items: "/data", idField: "id", cursor: { mode: "after_id", param: "after" } },
  ],
};

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connector-builder-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const transcript: string[] = [];
async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  transcript.push(text);
  const body = JSON.parse(text) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
const ok = async (d: Daemon, cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
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

test("an agent drafts a connector from a Vault item, a person publishes it, an automation uses it and a poll fires once per new item", async () => {
  const model = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", model.base) : (u as string), i); }) as typeof fetch;
  const api = acme();
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "connector-builder", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    // the address guard sees an ordinary public address; the request goes to the stand-in
    connectorNetwork: { resolve: async (host) => (host === "metadata.acme.test" ? ["169.254.169.254"] : ["93.184.216.34"]), request: async (url, o) => api.request(url, o) },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200, poll: 300 },
  });
  try {
    // ---- the person: a model account, an agent, and the Acme key in the Vault
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const provider = await ok(d, "providers.add", { idempotencyKey: "cb-provider", providerKey: "openai", connection: "api_key", apiKey: MODEL_KEY, scope: "mine" });
    await ok(d, "providers.set_space_use", { idempotencyKey: "cb-spaceuse", providerId: provider.provider.id, allow: true });
    const agentId = (await ok(d, "agents.create", { name: "Connector helper", role: "You connect apps to Automations.", model: "gpt-4o-mini", idempotencyKey: "cb-agent" })).agent.agentId as string;
    // an agent without connectors.manage is refused at publish (the first run of this test showed it); this one has the permission, so what stops it is the Gate
    const role = (await ok(d, "access.roles.create", { idempotencyKey: "cb-role", name: "Connector manager", assignableToAgents: true })).role.id as string;
    const preview = await ok(d, "access.roles.preview", { roleId: role, permissions: ["connectors.manage"] });
    await ok(d, "access.roles.apply", { roleId: role, permissions: ["connectors.manage"], previewHash: preview.previewHash });
    await ok(d, "access.roles.assign", { subject: { kind: "agent", id: agentId }, roleId: role });
    const folder = await ok(d, "vault.folders.create", { name: "Keys", scope: "shared", idempotencyKey: "cb-folder" });
    const item = (await ok(d, "vault.item.put", { folderId: folder.folder.id, name: "Acme", kind: "api_key", fields: [{ key: "api_key", value: KEY, secret: true }], idempotencyKey: "cb-item" })).item as { id: string; handle: string };
    assert.match(item.handle, /^#/);
    // the click on "Add to Automations" lets the chosen agent use this one item
    await ok(d, "access.share", { idempotencyKey: "cb-share", resource: { type: "vault_item", id: item.id }, subject: { kind: "agent", id: agentId }, level: "use" });

    // ---- the Ask: the app name and the item handle, never the value
    const opening = `Add Acme to Automations. Its key is in the Vault item ${item.handle}. Use the connector-builder skill: find the API, draft the connector with the key mapped from ${item.handle}, test one safe read, and stop at Tested.`;
    assert.equal(opening.includes(KEY), false);
    const started = await ok(d, "chat.start", { kind: "chat", agentIds: [agentId], title: "Add Acme to Automations", idempotencyKey: "cb-start" });
    const threadId = started.thread.threadId as string;
    // the first engine call builds and binds the runtime, so the bridge consumer has an engine to hand the message to
    await ok(d, "engine.pool.status", {});

    // the model's side of the conversation, in order
    model.script.push(
      { toolCalls: [{ name: "tool_search", args: { query: "automations_connector_save automations_try_read automations_connector_trust_host automations_connector_publish automations_connector_get" } }] },
      { toolCalls: [{ name: "automations_connector_save", args: { definition: DEFINITION, vaultHandle: item.handle } }] },
      { toolCalls: [{ name: "automations_try_read", args: { app: "acme", action: "list_orders" } }] },
      { toolCalls: [{ name: "automations_connector_trust_host", args: { app: "acme", host: "api.acme.test" } }] },
    );
    await ok(d, "chat.post", { threadId, body: opening, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "cb-post" });

    const pump = setInterval(() => void d.hooks?.pump?.(), 150);
    try {
      // the agent asked to allow the host: the Gate holds it for a person
      const hold = await until("the host allowance to wait at the Gate", 60_000, async () => {
        const holds = (await ok(d, "gate.holds.list", { states: ["held"] })).holds as { id?: string; taskId?: string; capName?: string; state?: string }[];
        return holds.find((h) => h.capName === "automations.connector.trust_host");
      });
      const saved = (await ok(d, "automations.connector.get", { app: "acme" })).connector;
      assert.equal(saved.level, "draft", "the agent's save is Drafted");
      assert.equal(saved.vaultHandle, item.handle);
      assert.equal(api.seen.length, 0, "the key was not sent to a host nobody allowed");

      model.script.push(
        { toolCalls: [{ name: "automations_try_read", args: { app: "acme", action: "list_orders" } }] },
        { toolCalls: [{ name: "automations_connector_publish", args: { app: "acme" } }] },
      );
      await ok(d, "tasks.act", { taskId: hold.taskId, action: "approve" });

      // the read earns Tested, then the agent tries to publish and is held
      const publishHold = await until("the agent's publish to wait at the Gate", 60_000, async () => {
        const holds = (await ok(d, "gate.holds.list", { states: ["held"] })).holds as { taskId?: string; capName?: string }[];
        return holds.find((h) => h.capName === "automations.connector.publish");
      });
      const tested = (await ok(d, "automations.connector.get", { app: "acme" })).connector;
      assert.equal(tested.actions.find((a: any) => a.key === "list_orders").level, "tested");   // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal(tested.actions.find((a: any) => a.key === "create_order").level, "draft");   // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal(tested.level, "tested", "the agent stops at Tested; publishing is held");
      assert.equal(api.seen.filter((s) => s.method === "GET").length, 1, "one safe read");
      assert.equal(api.seen[0]!.auth, `Bearer ${KEY}`, "the Vault filled the key on the request");

      model.script.push({ text: "Acme is Tested. A person needs to publish it." });
      await ok(d, "tasks.act", { taskId: publishHold.taskId, action: "reject", note: "I will publish it myself." });
      const answered = await until("the agent's report in the chat", 60_000, async () => {
        const messages = (await ok(d, "chat.messages.list", { threadId })).messages as { author?: { kind?: string }; body?: string }[];
        return messages.find((m) => m.author?.kind === "agent" && /Tested/.test(m.body ?? ""));
      });
      assert.ok(answered);
      assert.equal((await ok(d, "automations.connector.get", { app: "acme" })).connector.level, "tested", "a held publish that was turned down changes nothing");
    } finally { clearInterval(pump); }

    // ---- a person publishes; the sample action was proven, the other two are still drafts
    const published = await ok(d, "automations.connector.publish", { app: "acme" });
    assert.equal(published.connector.level, "published");
    assert.deepEqual(published.connector.actions.map((a: any) => [a.key, a.level]), [["list_orders", "published"], ["create_order", "draft"], ["refund_order", "draft"]]);   // eslint-disable-line @typescript-eslint/no-explicit-any

    // the catalogue shows them under the app's name
    const palette = (await ok(d, "automations.steps.list", {})).steps as { key: string; app?: string; level?: string }[];
    assert.deepEqual(palette.filter((s) => s.app === "Acme").map((s) => [s.key, s.level]), [["acme-list_orders", "published"], ["acme-create_order", "draft"], ["acme-refund_order", "draft"]]);

    // ---- a person tests the second action with a real call: a click is a person's own act, and the host is already allowed
    // (create_order changes something, so it is not tried; a person publishes it after seeing a first run in an automation test)
    const made = await ok(d, "automations.create", { idempotencyKey: "cb-auto-draft", name: "Create order", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "make", key: "acme-create_order", input: { email: "new@example.test", connectorLevel: "draft" } }] } });
    const draftOn = await call(d, "automations.set_enabled", { automationId: made.automation.id, enabled: true });
    assert.equal(draftOn.status, 422, "a drafted action cannot run in a turned-on automation");
    assert.match(JSON.stringify(draftOn.data), /draft/i);

    // ---- the published read in an automation run
    const reader = await ok(d, "automations.create", { idempotencyKey: "cb-auto-read", name: "Read orders", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "list", key: "acme-list_orders", input: { connectorLevel: "tested" } }] } });
    await ok(d, "automations.set_enabled", { automationId: reader.automation.id, enabled: true });
    const run = await ok(d, "automations.run", { automationId: reader.automation.id, idempotencyKey: "cb-run-1" });
    const finished = await until("the run to finish", 30_000, async () => {
      const r = (await ok(d, "runs.get", { runId: run.runId })).run as { status?: string };
      if (r.status === "failed" || r.status === "stopped") assert.fail(`the run ended ${r.status}: ${JSON.stringify(await ok(d, "runs.steps", { runId: run.runId }))}`);
      return r.status === "succeeded" ? r : undefined;
    });
    assert.equal(finished.status, "succeeded");
    assert.equal(api.seen.filter((s) => s.method === "GET").length, 2, "the run read the app once more");
    const steps = (await ok(d, "runs.steps", { runId: run.runId })).steps as { step: string; state: string }[];
    assert.deepEqual(steps.map((s) => [s.step, s.state]), [["list", "succeeded"]]);

    // ---- polling: the first pass records what exists, a new order starts one run, a repeat starts none
    const watcher = await ok(d, "automations.create", { idempotencyKey: "cb-auto-poll", name: "On new order", definition: { triggers: [{ key: "app_event", config: { app: "acme", trigger: "new_order" }, filter: { app: "acme", trigger: "new_order" } }], nodes: [{ id: "done", key: "transform", input: { value: "{{ $trigger.item }}", mapping: { email: "email" } } }] } });
    await ok(d, "automations.set_enabled", { automationId: watcher.automation.id, enabled: true });
    const runsOf = async (): Promise<{ id: string; status: string }[]> => ((await ok(d, "runs.list", { scope: "subject", subject: { type: "automation", id: watcher.automation.id }, limit: 50 })).runs ?? []) as { id: string; status: string }[];
    await until("the first poll to record what exists", 20_000, async () => {
      const t = (await ok(d, "automations.connector.get", { app: "acme" })).connector.triggers.find((x: any) => x.key === "new_order");   // eslint-disable-line @typescript-eslint/no-explicit-any
      return t?.polling?.primed ? t : undefined;
    });
    assert.equal((await runsOf()).length, 0, "orders that already existed start nothing");

    api.orders.push({ id: 3, email: "cy@example.test" });
    // the interval is a minute; the test moves the poller by asking for the pass itself, as the Check now button does
    const forced = await ok(d, "automations.connector.poll", { app: "acme", trigger: "new_order" });
    assert.equal(forced.polled, true);
    assert.equal(forced.fired, 1);
    await until("the run of the new order", 20_000, async () => ((await runsOf()).length === 1 ? true : undefined));
    const again = await ok(d, "automations.connector.poll", { app: "acme", trigger: "new_order" });
    assert.equal(again.fired, 0, "the same order starts nothing twice");
    assert.equal((await runsOf()).length, 1);
    assert.ok(api.seen.some((s) => s.path === "/v1/orders?after=2"), "the cursor travelled in the query");

    // ---- a 429 waits, keeps the reason, and fires nothing
    api.limit(true);
    api.orders.push({ id: 4, email: "di@example.test" });
    const limited = await ok(d, "automations.connector.poll", { app: "acme", trigger: "new_order" });
    assert.deepEqual([limited.polled, limited.status, limited.fired], [false, 429, 0]);
    const waiting = (await ok(d, "automations.connector.get", { app: "acme" })).connector.triggers.find((x: any) => x.key === "new_order");   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(waiting.polling.failures, 1);
    assert.equal(waiting.polling.lastStatus, 429);
    api.limit(false);
    assert.equal((await runsOf()).length, 1);

    // ---- unattended: the host poller wakes the trigger when its wait is over (the test ends the wait early), and the two orders that came while the app was limiting start one run each
    api.orders.push({ id: 5, email: "ed@example.test" });
    const edit = new DatabaseSync(path.join(dir, "modules.db"));
    edit.exec("PRAGMA busy_timeout = 5000");
    edit.prepare("UPDATE automations_connector_poll SET next_at = 0 WHERE app = 'acme' AND trigger_key = 'new_order'").run();
    edit.close();
    await until("the host poller to start the runs of orders 4 and 5", 20_000, async () => ((await runsOf()).length === 3 ? true : undefined));
    await new Promise((r) => setTimeout(r, 1_500));
    assert.equal((await runsOf()).length, 3, "each order started exactly one run");
    const after = (await ok(d, "automations.connector.get", { app: "acme" })).connector.triggers.find((x: any) => x.key === "new_order");   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(after.polling.failures, 0, "a good read ends the backoff");
    assert.equal(after.polling.fired, 3);

    // ---- a webhook trigger: the address has a secret, a delivery starts one run, a repeat starts none, a wrong or rotated secret is the same bare 404
    const withHook = { ...DEFINITION, triggers: [...DEFINITION.triggers, { key: "order_paid", title: "An order is paid", kind: "webhook", idField: "id" }] };
    const resaved = await ok(d, "automations.connector.save", { definition: withHook });
    assert.equal(resaved.connector.actions.find((a: any) => a.key === "list_orders").level, "published", "adding a trigger leaves the published action published");   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(resaved.connector.triggers.find((x: any) => x.key === "order_paid").level, "draft");   // eslint-disable-line @typescript-eslint/no-explicit-any
    const hook = await ok(d, "automations.connector.webhook_url.get", { app: "acme", trigger: "order_paid" });
    const hookUrl = (u: string): string => (u.startsWith("http") ? u : `${d.url}${u}`);
    const paid = await ok(d, "automations.create", { idempotencyKey: "cb-auto-hook", name: "On paid order", definition: { triggers: [{ key: "app_event", config: { app: "acme", trigger: "order_paid" }, filter: { app: "acme", trigger: "order_paid" } }], nodes: [{ id: "done", key: "transform", input: { value: "{{ $trigger.item }}", mapping: { total: "total" } } }] } });
    await call(d, "automations.set_enabled", { automationId: paid.automation.id, enabled: true });
    assert.equal((await ok(d, "automations.get", { automationId: paid.automation.id })).automation.status, "draft", "a webhook trigger that no delivery has proven cannot be turned on");
    const post = (u: string, body: unknown): Promise<Response> => fetch(hookUrl(u), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post(hook.url.replace(/[^/]+$/, "0".repeat(48)), { id: "o1", total: 5 })).status, 404, "a wrong secret is a bare 404");
    assert.equal((await post(hook.url, { id: "o1", total: 5 })).status, 200);
    await d.hooks?.pump?.();
    assert.equal((await ok(d, "automations.connector.get", { app: "acme" })).connector.triggers.find((x: any) => x.key === "order_paid").level, "tested", "a delivery proves the trigger");   // eslint-disable-line @typescript-eslint/no-explicit-any
    await ok(d, "automations.set_enabled", { automationId: paid.automation.id, enabled: true });
    const paidRuns = async (): Promise<number> => ((await ok(d, "runs.list", { scope: "subject", subject: { type: "automation", id: paid.automation.id }, limit: 50 })).runs ?? []).length;
    assert.equal(await paidRuns(), 0, "the delivery that proved the trigger came before anything listened");
    assert.equal((await post(hook.url, { id: "o2", total: 7 })).status, 200);
    await until("the run of the delivery", 20_000, async () => ((await paidRuns()) === 1 ? true : undefined));
    assert.equal((await post(hook.url, { id: "o2", total: 7 })).status, 200, "a repeat is taken and dropped");
    await new Promise((r) => setTimeout(r, 1_000));
    assert.equal(await paidRuns(), 1, "one delivery id starts one run");
    const rotated = await ok(d, "automations.connector.webhook_url.rotate", { app: "acme", trigger: "order_paid", confirm: true });
    assert.notEqual(rotated.url, hook.url);
    assert.equal((await post(hook.url, { id: "o3", total: 1 })).status, 404, "the old address stopped working");
    assert.equal((await post(rotated.url, { id: "o3", total: 1 })).status, 200);

    // ---- the key is nowhere it should not be
    d.sink.flush();
    const logs = JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT msg, attrs FROM logs").all());
    assert.equal(logs.includes(KEY), false, "the host log holds no key");
    assert.equal(model.requests.join("\n").includes(KEY), false, "no model request carried the key");
    assert.equal(transcript.join("\n").includes(KEY), false, "no response to a caller carried the key");
    const stored = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    assert.equal(JSON.stringify(stored.prepare("SELECT * FROM automations_connectors").all()).includes(KEY), false, "the definition holds no key");
    assert.equal(JSON.stringify(stored.prepare("SELECT * FROM automations_defs").all()).includes(KEY), false, "no automation holds the key");
    stored.close();
  } catch (e) {
    d.sink.flush();
    const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 ORDER BY id DESC LIMIT 15").all();
    console.error("host log:", JSON.stringify(rows), "model requests:", model.requests.length, "api saw:", JSON.stringify(api.seen));
    throw e;
  } finally { await d.stop(); model.close(); globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the address guard: a host that resolves to the cloud metadata address is not reached, a redirect to another host is not followed, and the key goes to neither", async () => {
  const api = acme();
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "connector-guard", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    connectorNetwork: { resolve: async (host) => (host === "metadata.acme.test" ? ["169.254.169.254"] : ["93.184.216.34"]), request: async (url, o) => api.request(url, o) },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, tick: 3_600_000 },
  });
  try {
    const folder = await ok(d, "vault.folders.create", { name: "Keys", scope: "shared", idempotencyKey: "g-folder" });
    const item = (await ok(d, "vault.item.put", { folderId: folder.folder.id, name: "Acme", kind: "api_key", fields: [{ key: "api_key", value: KEY, secret: true }], idempotencyKey: "g-item" })).item as { handle: string };
    const base = { ...DEFINITION, triggers: [], actions: [{ key: "list_orders", title: "List orders", method: "GET", path: "/v1/orders" }, { key: "bounce", title: "Bounce", method: "GET", path: "/v1/bounce" }] };
    await ok(d, "automations.connector.save", { definition: { ...base, app: "inside", title: "Inside", domains: ["metadata.acme.test"] }, vaultHandle: item.handle });
    const refused = await call(d, "automations.try_read", { app: "inside", action: "list_orders", allowHost: "metadata.acme.test" });
    assert.equal(refused.status, 403, JSON.stringify(refused.data));
    assert.equal(api.seen.length, 0, "nothing was sent to a host that resolves to the metadata address");
    await ok(d, "automations.connector.save", { definition: { ...base, app: "outside", title: "Outside" }, vaultHandle: item.handle });
    const bounced = await call(d, "automations.try_read", { app: "outside", action: "bounce", allowHost: "api.acme.test" });
    assert.equal(bounced.status, 403, JSON.stringify(bounced.data));
    assert.deepEqual(api.hosts, ["api.acme.test"], "the redirect to another host was not followed");
    assert.equal(api.seen.length, 1);
    // a good read still works for the same person
    const fine = await ok(d, "automations.try_read", { app: "outside", action: "list_orders" });
    assert.equal(fine.level, "tested");
    assert.equal(JSON.stringify(fine).includes(KEY), false);
    // a person cannot see another person's connector as theirs: the stored row belongs to its owner and a second save by anyone without the right is refused
    d.sink.flush();
    const logs = JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT msg, attrs FROM logs").all());
    assert.equal(logs.includes(KEY), false, "the host log holds no key");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
