// Connectors written in a Space: saved as a draft, proven by one safe read, published by a person, used by a step, polled and fed by a webhook.
// The host port is a stand-in that fills a fixed key and answers the requests a test scripts. The module sees the same shape the real port gives it.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { setConnectorCallHost } from "../connector-host.ts";
import type { CallerCtx, ConnectorCallHost } from "../connector-host.ts";
import { storedLevel } from "../connector-level.ts";
import type { LevelDb } from "../connector-level.ts";
import { connectorSteps } from "../connector-steps.ts";
import { acceptAppHook, connectorPoll, pollDue } from "../handlers/connector-run.ts";
import { codeOf, harness, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, goodDefinition } from "../fixtures/seed.ts";
import type { Caller } from "../fixtures/seed.ts";

const KEY = "zq-live-7f3a9c1e-ACME-KEY";
// People may use the Vault item and nothing else here: no role gives anyone the right to change another person's connector.
const vaultOnly = { authorize: (_who: { id: string }, _action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): boolean => resource.type === "vault_item" };
const agent: Caller = { id: "agt_helper", kind: "agent", actingFor: "usr_alice" };

interface Sent { url: string; method: string; headers: Record<string, string>; body?: string }
interface Script { status: number; body: unknown; retryAfter?: string }

function install(script: (s: Sent) => Script): { sent: Sent[]; fills: string[] } {
  const sent: Sent[] = [];
  const fills: string[] = [];
  const host: ConnectorCallHost = {
    async fill(caller: CallerCtx, binding) {
      fills.push(binding.handle);
      caller.rememberVaultItem?.("vit_acme");
      return KEY;
    },
    async http(caller, domains, url, init) {
      const u = new URL(url);
      if (!domains.includes(u.hostname)) throw { error: { code: "permission.no_grant" } };
      caller.assertAuthorized?.();
      const s: Sent = { url, method: init?.method ?? "GET", headers: init?.headers ?? {}, ...(init?.body !== undefined ? { body: init.body } : {}) };
      sent.push(s);
      const r = script(s);
      const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      return { status: r.status, text: async () => text, ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}) };
    },
  };
  setConnectorCallHost(host);
  return { sent, fills };
}
afterEach(() => setConnectorCallHost(null));

const definition = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  app: "acme",
  title: "Acme",
  domains: ["api.acme.test"],
  auth: { type: "bearer", field: "token" },
  actions: [
    { key: "list_orders", title: "List orders", method: "GET", path: "/v1/orders", params: [{ name: "after", in: "query" }] },
    { key: "create_order", title: "Create an order", method: "POST", path: "/v1/orders", params: [{ name: "email", in: "body", required: true }] },
  ],
  triggers: [
    { key: "new_order", title: "A new order", kind: "poll", action: "list_orders", intervalSec: 120, items: "/data", idField: "id", cursor: { mode: "after_id", param: "after" } },
    { key: "order_paid", title: "An order is paid", kind: "webhook", idField: "id" },
  ],
  ...over,
});
const save = (h: Harness, who: Caller = alice, over: Record<string, unknown> = {}, handle = "#Acme"): Promise<any> => h.call("automations.connector.save", { definition: definition(over), vaultHandle: handle }, who);   // eslint-disable-line @typescript-eslint/no-explicit-any
/** The first read of a host by a person says yes to sending the key there. */
const tried = (h: Harness, action = "list_orders", who: Caller = alice, extra: Record<string, unknown> = {}): Promise<any> => h.call("automations.try_read", { app: "acme", action, allowHost: "api.acme.test", ...extra }, who);   // eslint-disable-line @typescript-eslint/no-explicit-any
const level = (h: Harness, key: string): string | undefined => storedLevel(h.db as LevelDb, key);
const orders = (...ids: number[]): Script => ({ status: 200, body: { data: ids.map((id) => ({ id, email: `p${id}@example.test` })) } });

test("a saved connector is a draft, shows its steps under the app, and holds no key", async () => {
  const h = harness(vaultOnly);
  const out = await save(h);
  assert.equal(out.connector.level, "draft");
  assert.deepEqual(out.connector.actions.map((a: any) => [a.key, a.level, a.stepKey]), [["list_orders", "draft", "acme-list_orders"], ["create_order", "draft", "acme-create_order"]]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(out.connector.vaultHandle, "#Acme");
  assert.equal(level(h, "acme-list_orders"), "draft");
  const palette = connectorSteps(h.ctxFor(null, alice));
  assert.equal(palette.find((s) => s["key"] === "acme-create_order")!["app"], "Acme");
  assert.equal(palette.find((s) => s["key"] === "acme-list_orders")!["effects"], "read");
  assert.equal(JSON.stringify(h.db.all("SELECT * FROM automations_connectors")).includes(KEY), false);
});

test("a key in the definition or in the Vault handle is refused and nothing is stored", async () => {
  const h = harness(vaultOnly);
  await assert.rejects(() => h.call("automations.connector.save", { definition: definition({ title: "Acme sk_live_abcdefghijklmnop" }) }, alice), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => h.call("automations.connector.save", { definition: definition(), vaultHandle: "sk_live_abcdefghijklmnop" }, alice), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(h.db.all("SELECT app FROM automations_connectors"), []);
});

test("a safe read by a person earns tested, reports the shape and not the data, and sends the key only in the header", async () => {
  const h = harness(vaultOnly);
  const { sent, fills } = install(() => orders(2, 1));
  await save(h);
  const r = await tried(h);
  assert.equal(r.level, "tested");
  assert.deepEqual(r.shape, { data: [{ id: "number", email: "string" }] });
  assert.equal(JSON.stringify(r).includes("example.test"), false);
  assert.equal(JSON.stringify(r).includes(KEY), false);
  assert.deepEqual(fills, ["#Acme.token"]);
  assert.equal(sent[0]!.headers["Authorization"], `Bearer ${KEY}`);
  assert.equal(sent[0]!.url, "https://api.acme.test/v1/orders");
  assert.equal(level(h, "acme-list_orders"), "tested");
  assert.equal(level(h, "trigger:acme.new_order"), "tested");
  assert.equal(level(h, "acme-create_order"), "draft");
});

test("an action that changes something is not tried", async () => {
  const h = harness(vaultOnly);
  const { sent } = install(() => orders());
  await save(h);
  const r = await tried(h, "create_order", alice, { input: { email: "a@b.test" } });
  assert.deepEqual(r, { level: "draft", reason: "Only a read can be tried." });
  assert.equal(sent.length, 0);
});

test("a read that fails stays a draft and says why; the key is not in the reason", async () => {
  const h = harness(vaultOnly);
  install(() => ({ status: 401, body: { error: `bad key ${KEY}` } }));
  await save(h);
  const r = await tried(h);
  assert.equal(r.level, "draft");
  assert.equal(r.status, 401);
  assert.equal(JSON.stringify(r).includes(KEY), false);
  assert.equal(level(h, "acme-list_orders"), "draft");
});

test("an agent cannot send a key to a host nobody allowed; once a person allows it, it can", async () => {
  const h = harness(vaultOnly);
  const { sent } = install(() => orders(1));
  await save(h, agent);
  await assert.rejects(() => h.call("automations.try_read", { app: "acme", action: "list_orders" }, agent), (e) => reasonOf(e) === "host_not_trusted");
  assert.equal(sent.length, 0, "the key was filled but never sent");
  const allowed = await h.call("automations.connector.trust_host", { app: "acme", host: "api.acme.test" }, alice);
  assert.equal(allowed.allowed, true);
  const r = await h.call("automations.try_read", { app: "acme", action: "list_orders" }, agent);
  assert.equal(r.level, "tested");
  assert.equal(sent.length, 1);
});

test("changing an action sends it back to draft and leaves the others alone", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  await tried(h);
  const changed = definition();
  (changed["actions"] as Record<string, unknown>[])[1]!["path"] = "/v2/orders";
  const out = await h.call("automations.connector.save", { definition: changed }, alice);
  assert.equal(level(h, "acme-list_orders"), "tested");
  assert.equal(level(h, "acme-create_order"), "draft");
  assert.equal(out.connector.vaultHandle, "#Acme", "a save without a handle keeps the item");
  const moved = definition({ domains: ["api.other.test"] });
  await h.call("automations.connector.save", { definition: moved }, alice);
  assert.equal(level(h, "acme-list_orders"), "draft", "a new host resets every action");
});

test("publish needs a proven part, moves tested to published, and leaves a draft a draft", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  await assert.rejects(() => h.call("automations.connector.publish", { app: "acme" }, alice), (e) => reasonOf(e) === "not_tested");
  await tried(h);
  const out = await h.call("automations.connector.publish", { app: "acme" }, alice);
  assert.equal(out.connector.level, "published");
  assert.equal(level(h, "acme-list_orders"), "published");
  assert.equal(level(h, "trigger:acme.new_order"), "published");
  assert.equal(level(h, "acme-create_order"), "draft");
  assert.equal(out.published, 2);
  // an edit that does not touch a published action keeps it published
  const same = definition();
  (same["actions"] as Record<string, unknown>[])[1]!["title"] = "Create an order now";
  await h.call("automations.connector.save", { definition: same }, alice);
  assert.equal(level(h, "acme-list_orders"), "published");
});

test("a step runs a tested read and a draft is refused", async () => {
  const h = harness(vaultOnly);
  const { sent } = install(() => ({ status: 200, body: { data: [{ id: 1 }] } }));
  await save(h);
  await assert.rejects(() => h.call("automations.connector.read", { key: "acme-list_orders" }, alice), (e) => reasonOf(e) === "draft");
  await tried(h);
  const out = await h.call("automations.connector.read", { key: "acme-list_orders", input: { after: "7", connectorLevel: "tested" } }, alice);
  assert.deepEqual(out.output, { data: [{ id: 1 }] });
  assert.equal(sent.at(-1)!.url, "https://api.acme.test/v1/orders?after=7");
  assert.equal((await h.call("automations.connector.read", { key: "acme-list_orders", dryRun: true }, alice)).dryRun, true);
  const info = await h.call("automations.connector.info", { key: "acme-create_order" }, alice);
  assert.deepEqual(info, { found: true, app: "acme", action: "create_order", title: "Acme: Create an order", effect: "outward", level: "draft" });
  assert.deepEqual(await h.call("automations.connector.info", { key: "records.update" }, alice), { found: false });
});

test("a read action cannot go through send, and a status the app refuses with becomes an error", async () => {
  const h = harness(vaultOnly);
  let status = 200;
  install(() => ({ status, body: {} }));
  await save(h);
  await tried(h);
  await assert.rejects(() => h.call("automations.connector.send", { key: "acme-list_orders", idempotencyKey: "k1" }, alice), (e) => reasonOf(e) === "wrong_effect");
  status = 429;
  await assert.rejects(() => h.call("automations.connector.read", { key: "acme-list_orders" }, alice), (e) => codeOf(e) === "provider.rate_limited");
  status = 403;
  await assert.rejects(() => h.call("automations.connector.read", { key: "acme-list_orders" }, alice), (e) => codeOf(e) === "provider.auth_failed");
});

test("a connector in use cannot be removed, and another person cannot change it", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  await assert.rejects(() => h.call("automations.connector.save", { definition: definition({ title: "Hijack" }) }, bob), (e) => codeOf(e) === "permission.not_found");
  await tried(h);
  const made = await h.call("automations.create", { name: "Uses Acme", definition: goodDefinition({ nodes: [{ id: "a", key: "acme-list_orders", input: { connectorLevel: "tested" } }] }) }, alice);
  await assert.rejects(() => h.call("automations.connector.remove", { app: "acme" }, alice), (e) => reasonOf(e) === "in_use");
  await h.call("automations.delete", { automationId: made.automation.id }, alice);
  assert.equal((await h.call("automations.connector.remove", { app: "acme" }, alice)).removed, true);
  assert.equal((await h.call("automations.connectors.list", {}, alice)).connectors.length, 0);
  assert.equal(level(h, "acme-list_orders"), undefined);
});

// ---- polling

async function listening(h: Harness, trigger = "new_order"): Promise<void> {
  const made = await h.call("automations.create", {
    name: "On new order",
    definition: { triggers: [{ key: "app_event", config: { app: "acme", trigger }, filter: { app: "acme", trigger } }], nodes: [{ id: "a", key: "records.update", input: { type: "contact", recordId: "rec_abc", patch: { status: "active" } } }] },
  }, alice);
  await h.call("automations.set_enabled", { automationId: made.automation.id, enabled: true }, alice);
}
const fired = new WeakMap<Harness, string[]>();
/** One pass of the poller as the owner. The items it announced are kept, since the harness forgets events at its next call. */
async function poll(h: Harness): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const start = h.events.length;
  const out = await connectorPoll(h.ctxFor("automations.connector.poll", alice), { app: "acme", trigger: "new_order" });
  const list = fired.get(h) ?? [];
  list.push(...h.events.slice(start).filter((e) => e.name === "app_event.received").map((e) => String((e.payload as { itemId: string }).itemId)));
  fired.set(h, list);
  return out;
}
const itemEvents = (h: Harness): string[] => fired.get(h) ?? [];

test("a polling trigger primes on the first read, then fires once per new item", async () => {
  const h = harness(vaultOnly);
  let reply = orders(2, 1);
  const { sent } = install(() => reply);
  await save(h);
  await tried(h);
  await listening(h);
  assert.equal(pollDue(h.ctxFor(null, alice)).length, 1);

  const first = await poll(h);
  assert.deepEqual([first.polled, first.fired], [true, 0]);
  assert.deepEqual(itemEvents(h), []);

  h.advance(130_000);
  reply = orders(4, 3, 2, 1);
  const second = await poll(h);
  assert.equal(second.fired, 2);
  assert.deepEqual(itemEvents(h), ["3", "4"]);
  assert.equal(sent.at(-1)!.url, "https://api.acme.test/v1/orders?after=2", "the cursor travels in the query");

  h.advance(130_000);
  const third = await poll(h);
  assert.equal(third.fired, 0);
  assert.deepEqual(itemEvents(h), ["3", "4"]);
  const row = (await h.call("automations.connectors.list", {}, alice)).connectors[0].triggers.find((t: any) => t.key === "new_order");   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(row.polling.fired, 2);
  assert.equal(row.polling.failures, 0);
});

test("a trigger nobody listens to is not due, and a due one waits for its interval", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  await tried(h);
  assert.deepEqual(pollDue(h.ctxFor(null, alice)), []);
  await listening(h);
  assert.equal(pollDue(h.ctxFor(null, alice)).length, 1);
  await poll(h);
  assert.equal(pollDue(h.ctxFor(null, alice)).length, 0);
  h.advance(121_000);
  assert.deepEqual(pollDue(h.ctxFor(null, alice)), [{ app: "acme", trigger: "new_order", owner: { kind: "person", id: "usr_alice" } }]);
});

test("a 429 waits for the longer of Retry-After and the backoff, a later success starts over", async () => {
  const h = harness(vaultOnly);
  let reply: Script = orders(1);
  install(() => reply);
  await save(h);
  await tried(h);
  await listening(h);
  await poll(h);
  h.advance(121_000);
  reply = { status: 429, body: {}, retryAfter: "900" };
  const t0 = h.now();
  const limited = await poll(h);
  assert.equal(limited.polled, false);
  assert.equal(limited.status, 429);
  assert.equal(limited.nextAt, t0 + 900_000);
  h.advance(300_000);
  assert.equal(pollDue(h.ctxFor(null, alice)).length, 0, "still waiting");
  reply = { status: 429, body: {} };
  h.advance(700_000);
  const t1 = h.now();
  const again = await poll(h);
  assert.equal(again.nextAt, t1 + 480_000, "no Retry-After: the wait doubled twice");
  h.advance(481_000);
  reply = orders(2, 1);
  const ok = await poll(h);
  assert.equal(ok.polled, true);
  assert.equal(ok.fired, 1);
  const row = (await h.call("automations.connectors.list", {}, alice)).connectors[0].triggers.find((t: any) => t.key === "new_order");   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(row.polling.failures, 0);
  assert.equal(row.polling.lastError, undefined);
});

test("a refused key and a host nobody allowed are kept as the reason, the wait grows, and nothing fires", async () => {
  const h = harness(vaultOnly);
  let reply: Script = orders(1);
  install(() => reply);
  await save(h);
  await tried(h);
  await listening(h);
  await poll(h);
  h.advance(121_000);
  reply = { status: 401, body: {} };
  const r = await poll(h);
  assert.equal(r.polled, false);
  assert.match(r.reason, /refused the key/);
  const row = (await h.call("automations.connectors.list", {}, alice)).connectors[0].triggers.find((t: any) => t.key === "new_order");   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(row.polling.lastStatus, 401);
  assert.equal(row.polling.failures, 1);
  assert.deepEqual(itemEvents(h), []);
  h.db.run("DELETE FROM automations_connector_hosts");
  h.advance(10 * 3_600_000);
  const blocked = await poll(h);
  assert.equal(blocked.polled, false);
  assert.match(blocked.reason, /has not been allowed/);
});

// ---- webhook

test("a webhook trigger has an address with a secret, takes a delivery once per id, and rotating the secret retires the old address", async () => {
  const h = harness(vaultOnly);
  await save(h);
  const got = await h.call("automations.connector.webhook_url.get", { app: "acme", trigger: "order_paid" }, alice);
  assert.match(got.url, /^https:\/\/acme\.example\.com\/hooks\/app\/acme\/order_paid\/[0-9a-f]{48}$/);
  const secret = got.url.split("/").pop() as string;
  const ctx = h.ctxFor("automations.connector.poll", alice);
  assert.equal(await acceptAppHook(ctx, { app: "acme", trigger: "order_paid", secret: "wrong-secret-value", payload: { id: "o1" } }), null);
  assert.equal(await acceptAppHook(ctx, { app: "acme", trigger: "new_order", secret, payload: { id: "o1" } }), null, "a polling trigger has no address");
  assert.deepEqual(await acceptAppHook(ctx, { app: "acme", trigger: "order_paid", secret, payload: { id: "o1", total: 5 } }), { accepted: true });
  assert.deepEqual(await acceptAppHook(ctx, { app: "acme", trigger: "order_paid", secret, payload: { id: "o1", total: 5 } }), { accepted: true, duplicate: true });
  assert.deepEqual(await acceptAppHook(ctx, { app: "acme", trigger: "order_paid", secret, payload: { id: "o2" } }), { accepted: true });
  const taken = h.events.filter((e) => e.name === "app_event.received").map((e) => e.payload as { itemId: string; source: string; item: { total?: number } });
  assert.deepEqual(taken.map((t) => [t.itemId, t.source]), [["o1", "webhook"], ["o2", "webhook"]], "the repeat of o1 started nothing");
  assert.equal(taken[0]!.item.total, 5);
  assert.equal(level(h, "trigger:acme.order_paid"), "tested", "a delivery proves the trigger");
  const rotated = await h.call("automations.connector.webhook_url.rotate", { app: "acme", trigger: "order_paid", confirm: true }, alice);
  assert.notEqual(rotated.url, got.url);
  assert.equal(await acceptAppHook(ctx, { app: "acme", trigger: "order_paid", secret, payload: { id: "o3" } }), null);
});

test("the step palette lists written actions with their app and level", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  await tried(h);
  const palette = (await h.call("automations.steps.list", {}, alice)).steps as { key: string; app?: string; level?: string; effects: string }[];
  const row = palette.find((s) => s.key === "acme-list_orders")!;
  assert.deepEqual([row.app, row.level, row.effects], ["Acme", "tested", "read"]);
  assert.equal(palette.find((s) => s.key === "acme-create_order")!.level, "draft");
  assert.ok(palette.some((s) => s.key === "records.update"), "built-in steps are still there");
});

test("an automation waiting on a trigger no read has proven cannot be turned on, one on a proven trigger can", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  const made = await h.call("automations.create", {
    name: "On new order",
    definition: { triggers: [{ key: "app_event", config: { app: "acme", trigger: "new_order" }, filter: { app: "acme", trigger: "new_order" } }], nodes: [{ id: "a", key: "records.update", input: { type: "contact", recordId: "rec_abc", patch: { status: "active" } } }] },
  }, alice);
  await assert.rejects(() => h.call("automations.set_enabled", { automationId: made.automation.id, enabled: true }, alice), (e) => reasonOf(e) === "draft");
  await tried(h);
  assert.equal((await h.call("automations.set_enabled", { automationId: made.automation.id, enabled: true }, alice)).automation.status, "on");
  const bad = await h.call("automations.validate", { definition: { triggers: [{ key: "app_event" }], nodes: [] } }, alice);
  assert.ok(bad.issues.some((i: { message: string }) => /needs the app and the trigger/.test(i.message)));
  const unknown = await h.call("automations.create", { name: "Nobody home", definition: { triggers: [{ key: "app_event", config: { app: "nope", trigger: "x" } }], nodes: [{ id: "a", key: "records.update", input: { type: "contact", recordId: "rec_abc", patch: { status: "active" } } }] } }, alice);
  await assert.rejects(() => h.call("automations.set_enabled", { automationId: unknown.automation.id, enabled: true }, alice), (e) => /no trigger x on a connector called nope/.test(JSON.stringify(e)));
});

test("a person's first read of a host must name the host; said once, it is allowed from then on", async () => {
  const h = harness(vaultOnly);
  const { sent } = install(() => orders(1));
  await save(h);
  const bare = await h.call("automations.try_read", { app: "acme", action: "list_orders" }, alice).catch((e) => e);
  assert.equal(reasonOf(bare), "host_not_trusted");
  assert.equal(((bare as { error: { details: { next: string } } }).error.details).next, "allowHost");
  await assert.rejects(() => h.call("automations.try_read", { app: "acme", action: "list_orders", allowHost: "api.other.test" }, alice), (e) => reasonOf(e) === "host_not_trusted");
  assert.equal(sent.length, 0, "the key was filled and never sent");
  assert.equal((await tried(h)).level, "tested");
  assert.equal((await h.call("automations.try_read", { app: "acme", action: "list_orders" }, alice)).level, "tested", "no need to say it again");
  assert.equal(sent.length, 2);
});

test("a tested part is its author's; everyone else sees and uses only what a person published", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  await tried(h);
  // bob has the right to use the Vault item (the harness grants that) but is not the author
  assert.deepEqual((await h.call("automations.connectors.list", {}, bob)).connectors, []);
  await assert.rejects(() => h.call("automations.connector.get", { app: "acme" }, bob), (e) => codeOf(e) === "validation.not_found");
  assert.equal((await h.call("automations.steps.list", {}, bob)).steps.some((s: { key: string }) => s.key.startsWith("acme-")), false);
  assert.deepEqual(await h.call("automations.connector.info", { key: "acme-list_orders" }, bob), { found: false });
  await assert.rejects(() => h.call("automations.connector.read", { key: "acme-list_orders" }, bob), (e) => reasonOf(e) === "not_published");
  await assert.rejects(() => h.call("automations.connector.webhook_url.get", { app: "acme", trigger: "order_paid" }, bob), (e) => codeOf(e) === "permission.not_found");
  await assert.rejects(() => h.call("automations.connector.trust_host", { app: "acme", host: "api.acme.test" }, bob), (e) => codeOf(e) === "permission.not_found");

  await h.call("automations.connector.publish", { app: "acme" }, alice);
  const seen = (await h.call("automations.connectors.list", {}, bob)).connectors;
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].actions.map((a: { key: string; level: string }) => [a.key, a.level]), [["list_orders", "published"]], "the drafts stay with the author");
  assert.deepEqual(seen[0].triggers.map((t: { key: string }) => t.key), ["new_order"]);
  assert.equal((await h.call("automations.connector.read", { key: "acme-list_orders" }, bob)).status, 200);
  assert.equal((await h.call("automations.steps.list", {}, bob)).steps.filter((s: { key: string }) => s.key.startsWith("acme-")).length, 1);
});

test("a Space automation, which runs as its own service, can use only what was published", async () => {
  const h = harness(vaultOnly);
  install(() => orders(1));
  await save(h);
  await tried(h);
  const made = await h.call("automations.create", { name: "Reads orders", definition: goodDefinition({ nodes: [{ id: "a", key: "acme-list_orders", input: { connectorLevel: "tested" } }] }) }, alice);
  h.db.run("UPDATE automations_defs SET kind = 'space' WHERE id = ?", made.automation.id);
  await assert.rejects(() => h.call("automations.set_enabled", { automationId: made.automation.id, enabled: true }, alice), (e) => /only tested/.test(JSON.stringify(e)));
  await h.call("automations.connector.publish", { app: "acme" }, alice);
  assert.equal((await h.call("automations.set_enabled", { automationId: made.automation.id, enabled: true }, alice)).automation.status, "on");
});
