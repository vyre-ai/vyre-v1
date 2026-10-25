// Events module behaviour: webhook definitions, signed delivery, retry and give-up, replay, health, the event reads and the webhooks_out consumer.
// Handlers run for real over the in-memory engine and the real host ports (createEventLogPort, createWebhookPostPort) with a scripted network.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { hmacSha256Hex, signWebhook } from "../../../host/src/seams/events-ports.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { addEvent, codeOf, harness, logged, NOW, seedExampleWorld, TRACE } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { handlers } from "../handlers/index.ts";
import { hostSeams } from "../impl.ts";
import { backoffMs, dueDeliveries, fanOut, filterMatches, migrationSql, setEventsHost, typeMatches, webhooksOut } from "../projections.ts";
import type { DeliveryRec, EventsCtx, WebhookRec } from "../projections.ts";

const H = handlers;
const admin = (h: Harness): EventsCtx => h.as("usr_a1b2c3");
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp): Promise<void> =>
  p.then(() => assert.fail(`expected ${code}`), (e: unknown) => { assert.equal(codeOf(e), code); if (msg) assert.match((e as { error: { message: string } }).error.message, msg); });

async function create(h: Harness, o: Partial<{ name: string; url: string; eventTypes: string[]; filter: unknown }> = {}) {
  return H["webhooks.create"](admin(h), { name: "Orders", url: "https://hooks.example.com/orders", eventTypes: ["record.*"], idempotencyKey: "k", ...o } as never);
}
const row = <T>(h: Harness, sql: string, ...a: unknown[]): T => h.raw.all(sql, ...a)[0] as T;
const hook = (h: Harness, id: string): WebhookRec => row<WebhookRec>(h, `SELECT * FROM events_webhook WHERE id = ?`, id);
const deliveries = (h: Harness, webhookId: string): DeliveryRec[] => h.raw.all(`SELECT * FROM events_delivery WHERE webhook_id = ? ORDER BY at ASC, id ASC`, webhookId) as DeliveryRec[];
const names = (h: Harness): string[] => h.emitted.map((e) => e.name);
const sendDelivery = (h: Harness, webhookId: string, eventId: string, attempt = 1) =>
  H["webhooks.send_delivery"](h.system(), { webhookId, eventId, attempt, idempotencyKey: `${webhookId}:${eventId}:${attempt}` } as never);

// ---------------------------------------------------------------- definitions

test("webhooks.create: shows the secret once, keeps only a sealed copy, and emits webhook.created", async () => {
  const h = harness();
  const out = await create(h, { filter: { "/type": "contact" } });
  assert.match(out.secret, /^whsec_[0-9a-f]{48}$/);
  assert.equal(out.webhook.secretHint, out.secret.slice(-4));
  assert.deepEqual(out.webhook.eventTypes, ["record.*"]);
  assert.deepEqual(out.webhook.filter, { "/type": "contact" });
  assert.equal(out.webhook.active, true); assert.equal(out.webhook.failureStreak, 0); assert.equal(out.webhook.createdBy, "usr_a1b2c3");
  assert.equal(JSON.stringify(out.webhook).includes(out.secret), false);
  const stored = hook(h, out.webhook.id);
  assert.equal(stored.secret.includes(out.secret), false, "the clear secret is not stored");
  assert.match(JSON.parse(stored.secret).keyId, /^k1\/events\.webhook$/);
  assert.deepEqual(h.emitted, [{ name: "webhook.created", subject: out.webhook.id, payload: { webhookId: out.webhook.id, name: "Orders", eventTypes: ["record.*"] } }]);
  const listed = await H["webhooks.get"](admin(h), { webhookId: out.webhook.id });
  assert.equal(JSON.stringify(listed).includes(out.secret), false);
});

test("webhooks.create: refuses an address that is not https, has credentials or is private; and bad names, types and filters", async () => {
  const h = harness();
  for (const url of ["http://hooks.example.com/x", "https://user:pw@hooks.example.com/x", "https://localhost/x", "https://10.0.0.1/x", "https://169.254.169.254/", "not a url"]) {
    await rejects(create(h, { url }), "validation.bad_input");
  }
  await rejects(create(h, { name: "   " }), "validation.bad_input");
  await rejects(create(h, { eventTypes: [] }), "validation.bad_input");
  await rejects(create(h, { eventTypes: ["Record Updated"] }), "validation.bad_input", /not an event type/);
  await rejects(create(h, { filter: ["a"] }), "validation.bad_input");
  await rejects(create(h, { filter: { type: "x" } }), "validation.bad_input", /pointer/);
  await rejects(create(h, { filter: { "/a": { b: 1 } } }), "validation.bad_input");
  assert.equal(h.raw.rows("events_webhook").length, 0);
  assert.deepEqual(h.emitted, []);
});

test("webhooks.create: duplicate event types collapse and an empty filter is no filter", async () => {
  const h = harness();
  const out = await create(h, { eventTypes: ["record.*", "record.*", "task.completed"], filter: {} });
  assert.deepEqual(out.webhook.eventTypes, ["record.*", "task.completed"]);
  assert.equal("filter" in out.webhook, false);
});

test("webhooks.list pages newest first and webhooks.get hides a deleted one", async () => {
  const h = harness();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) { h.advance(1000); ids.push((await create(h, { name: `W${i}` })).webhook.id); }
  const p1 = await H["webhooks.list"](admin(h), { limit: 2 });
  assert.deepEqual(p1.webhooks.map((w) => w.name), ["W2", "W1"]);
  assert.equal(p1.next, "2"); assert.equal(p1.total, 3);
  const p2 = await H["webhooks.list"](admin(h), { limit: 2, cursor: p1.next! });
  assert.deepEqual(p2.webhooks.map((w) => w.name), ["W0"]); assert.equal(p2.next, undefined);
  await H["webhooks.delete"](admin(h), { webhookId: ids[0]! });
  await rejects(H["webhooks.get"](admin(h), { webhookId: ids[0]! }), "validation.not_found");
  assert.equal((await H["webhooks.list"](admin(h), {})).total, 2);
});

test("webhooks.update: records only what changed, validates, and switching on again starts clean", async () => {
  const h = harness();
  const w = (await create(h)).webhook;
  h.emitted.length = 0;
  const same = await H["webhooks.update"](admin(h), { webhookId: w.id, name: "Orders", url: w.url, eventTypes: ["record.*"], active: true });
  assert.equal(same.webhook.name, "Orders"); assert.deepEqual(h.emitted, []);
  const out = await H["webhooks.update"](admin(h), { webhookId: w.id, name: "Renamed", eventTypes: ["task.*"], filter: { "/x": [1, 2] } });
  assert.equal(out.webhook.name, "Renamed"); assert.deepEqual(out.webhook.eventTypes, ["task.*"]); assert.deepEqual(out.webhook.filter, { "/x": [1, 2] });
  assert.deepEqual(h.emitted.map((e) => e.payload), [{ webhookId: w.id, fields: ["name", "eventTypes", "filter"] }]);
  const cleared = await H["webhooks.update"](admin(h), { webhookId: w.id, filter: null });
  assert.equal("filter" in cleared.webhook, false);
  await rejects(H["webhooks.update"](admin(h), { webhookId: w.id, url: "http://x.example.com" }), "validation.bad_input");
  await rejects(H["webhooks.update"](admin(h), { webhookId: "whk_nope" }), "validation.not_found");
  h.raw.run(`UPDATE events_webhook SET active = ?, failure_streak = ?, gave_up_streak = ? WHERE id = ?`, 0, 7, 19, w.id);
  const on = await H["webhooks.update"](admin(h), { webhookId: w.id, active: true });
  assert.equal(on.webhook.active, true); assert.equal(on.webhook.failureStreak, 0); assert.equal(hook(h, w.id).gave_up_streak, 0);
});

test("webhooks.delete: drops pending and retrying deliveries, keeps the finished ones, emits webhook.deleted", async () => {
  const h = harness(); seedExampleWorld(h);
  for (const [id, state] of [["dlv_p", "pending"], ["dlv_r", "retrying"]] as const) {
    h.raw.run(`INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, state, attempts, at, first_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "whk_a1b2c3", `evt_${id}`, "record.updated", "event", state, 0, NOW, NOW);
  }
  assert.deepEqual(await H["webhooks.delete"](admin(h), { webhookId: "whk_a1b2c3" }), { deleted: true });
  assert.deepEqual(deliveries(h, "whk_a1b2c3").map((d) => d.id), ["dlv_a1b2c3"]);
  assert.deepEqual(h.emitted, [{ name: "webhook.deleted", subject: "whk_a1b2c3", payload: { webhookId: "whk_a1b2c3" } }]);
  await rejects(H["webhooks.delete"](admin(h), { webhookId: "whk_a1b2c3" }), "validation.not_found");
});

// ---------------------------------------------------------------- signature and send

function verify(h: Harness, i: number, secret: string): { t: number; body: string } {
  const { init } = h.sent[i]!;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(init.headers["x-vyre-signature"]!);
  assert.ok(m, "signature header shape");
  assert.equal(m[2], hmacSha256Hex(secret, `${m[1]}.${init.body}`), "signature matches HMAC-SHA256 of t.body under the secret");
  assert.equal(m[2], signWebhook(secret, Number(m[1]), init.body).split("v1=")[1]);
  assert.equal(init.headers["x-vyre-trace"], TRACE);
  return { t: Number(m[1]), body: init.body };
}

test("webhooks.test: one signed POST of a sample event, trace and event headers, the answer read back", async () => {
  const h = harness();
  const { webhook, secret } = await create(h);
  const out = await H["webhooks.test"](admin(h), { webhookId: webhook.id, idempotencyKey: "t1" });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0]!.url, "https://hooks.example.com/orders");
  assert.equal(h.sent[0]!.init.headers["x-vyre-event"], "webhook.test");
  const { t, body } = verify(h, 0, secret);
  assert.equal(t, NOW / 1000);
  const sent = JSON.parse(body);
  assert.equal(sent.type, "webhook.test"); assert.equal(sent.webhookId, webhook.id); assert.match(sent.id, /^evt_[a-z0-9]+$/);
  assert.equal(out.delivery.state, "delivered"); assert.equal(out.delivery.attempts, 1); assert.equal(out.delivery.httpStatus, 200);
  assert.deepEqual(names(h), ["webhook.created", "webhook.delivered"]);
  assert.equal(hook(h, webhook.id).last_delivery_at, NOW);
});

test("webhooks.test: a failing endpoint is reported once, with no retry scheduled", async () => {
  const h = harness();
  const { webhook } = await create(h);
  h.replies.push({ status: 500, body: "boom" });
  const out = await H["webhooks.test"](admin(h), { webhookId: webhook.id, idempotencyKey: "t1" });
  assert.equal(out.delivery.state, "failed"); assert.equal(out.delivery.httpStatus, 500); assert.match(out.delivery.lastError!, /500/);
  assert.deepEqual(h.scheduled, []);
  assert.equal(hook(h, webhook.id).failure_streak, 1);
  const f = h.emitted.at(-1)!;
  assert.equal(f.name, "webhook.delivery_failed"); assert.equal((f.payload as { willRetry: boolean }).willRetry, false);
});

test("webhooks.rotate_secret: a new secret is shown once; deliveries after it are signed with the new one only", async () => {
  const h = harness();
  const { webhook, secret } = await create(h);
  const rot = await H["webhooks.rotate_secret"](admin(h), { webhookId: webhook.id });
  assert.notEqual(rot.secret, secret); assert.equal(rot.webhook.secretHint, rot.secret.slice(-4));
  assert.deepEqual(h.emitted.at(-1), { name: "webhook.secret_rotated", subject: webhook.id, payload: { webhookId: webhook.id, by: "usr_a1b2c3" } });
  assert.equal(JSON.stringify(h.emitted).includes(rot.secret), false, "the secret is not in any event");
  await H["webhooks.test"](admin(h), { webhookId: webhook.id, idempotencyKey: "t" });
  verify(h, 0, rot.secret);
  const m = /v1=([0-9a-f]+)/.exec(h.sent[0]!.init.headers["x-vyre-signature"]!)!;
  assert.notEqual(m[1], hmacSha256Hex(secret, `${NOW / 1000}.${h.sent[0]!.init.body}`));
});

// ---------------------------------------------------------------- delivery of events, retry, give up

async function hooked(h: Harness, o: Parameters<typeof create>[1] = {}) {
  const c = await create(h, { eventTypes: ["*"], ...o });
  h.emitted.length = 0;
  return c;
}

test("webhooks.send_delivery: reads the event as the webhook's owner, sends its body signed, logs the delivery, and a repeat sends nothing", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook, secret } = await hooked(h);
  const e = addEvent(h, { type: "record.updated", entity: "record", entity_id: "rec_9", payload: { fields: { name: "A" } } });
  const out = await sendDelivery(h, webhook.id, e.id);
  assert.equal(out.delivery.state, "delivered"); assert.equal(out.delivery.attempts, 1); assert.equal(out.delivery.eventId, e.id); assert.equal(out.delivery.eventType, "record.updated");
  const { body } = verify(h, 0, secret);
  const sent = JSON.parse(body);
  assert.equal(sent.id, e.id); assert.equal(sent.type, "record.updated"); assert.equal(sent.seq, e.seq); assert.deepEqual(sent.payload, { fields: { name: "A" } });
  assert.deepEqual(sent.subject, { type: "record", id: "rec_9" }); assert.equal(sent.webhookId, webhook.id);
  assert.deepEqual(names(h), ["webhook.delivered"]);
  assert.deepEqual((h.emitted[0]!.payload as Record<string, unknown>), { deliveryId: out.delivery.id, webhookId: webhook.id, eventId: e.id, httpStatus: 200, attempts: 1 });
  const again = await sendDelivery(h, webhook.id, e.id);
  assert.deepEqual(again, out); assert.equal(h.sent.length, 1);
  assert.equal(deliveries(h, webhook.id).length, 1);
  assert.equal(hook(h, webhook.id).last_delivery_at, NOW);
});

test("webhooks.send_delivery: a failure retries after 30 s, 60 s, 120 s; success on a later attempt clears the streak", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const e = addEvent(h, { type: "task.completed", payload: {} });
  h.replies.push({ status: 503 }, { status: 502 }, { status: 429 });
  let out = await sendDelivery(h, webhook.id, e.id, 1);
  assert.equal(out.delivery.state, "retrying"); assert.equal(out.delivery.nextAttemptAt, NOW + 30_000);
  assert.deepEqual(h.scheduled.at(-1), { at: NOW + 30_000, cap: "webhooks.send_delivery", input: { webhookId: webhook.id, eventId: e.id, attempt: 2, idempotencyKey: `${webhook.id}:${e.id}:2` } });
  h.advance(30_000);
  out = await sendDelivery(h, webhook.id, e.id, 2);
  assert.equal(out.delivery.state, "retrying"); assert.equal(out.delivery.attempts, 2); assert.equal(out.delivery.nextAttemptAt, NOW + 30_000 + 60_000);
  h.advance(60_000);
  out = await sendDelivery(h, webhook.id, e.id, 3);
  assert.equal(out.delivery.nextAttemptAt, NOW + 90_000 + 120_000);
  assert.equal(hook(h, webhook.id).failure_streak, 3);
  assert.deepEqual(h.scheduled.map((s) => (s.input as { attempt: number }).attempt), [2, 3, 4]);
  const fails = h.emitted.filter((x) => x.name === "webhook.delivery_failed");
  assert.deepEqual(fails.map((f) => (f.payload as { willRetry: boolean; attempts: number }).attempts), [1, 2, 3]);
  assert.equal(fails.every((f) => (f.payload as { willRetry: boolean }).willRetry), true);
  h.advance(120_000);
  out = await sendDelivery(h, webhook.id, e.id, 4);
  assert.equal(out.delivery.state, "delivered"); assert.equal(out.delivery.attempts, 4); assert.equal(out.delivery.nextAttemptAt, undefined);
  assert.equal(hook(h, webhook.id).failure_streak, 0);
  // an attempt the scheduler repeats changes nothing
  await sendDelivery(h, webhook.id, e.id, 3);
  assert.equal(h.sent.length, 4);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(backoffMs), [30e3, 60e3, 120e3, 240e3, 480e3, 960e3, 1920e3, 3840e3, 7680e3, 15360e3].map((x) => Math.min(x, 6 * 3_600_000)));
});

test("webhooks.send_delivery: timeouts and network failures retry; the error text never leaks a host detail", async () => {
  const h = harness({ timeoutMs: 25 }); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const e1 = addEvent(h, { type: "a.one", payload: {} }), e2 = addEvent(h, { type: "a.two", payload: {} });
  h.replies.push("hang", "down");
  const t = await sendDelivery(h, webhook.id, e1.id);
  assert.equal(t.delivery.state, "retrying"); assert.match(t.delivery.lastError!, /No answer/); assert.equal(t.delivery.httpStatus, undefined);
  const d = await sendDelivery(h, webhook.id, e2.id);
  assert.equal(d.delivery.state, "retrying"); assert.equal(d.delivery.lastError, "The endpoint could not be reached.");
});

test("webhooks.send_delivery: a 4xx other than 408 and 429, and a redirect, end the delivery as failed without a retry", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const evs = [addEvent(h, { type: "a.one", payload: {} }), addEvent(h, { type: "a.two", payload: {} }), addEvent(h, { type: "a.three", payload: {} })];
  h.replies.push({ status: 410 }, { status: 301, location: "https://elsewhere.example.com/" }, { status: 408 });
  assert.equal((await sendDelivery(h, webhook.id, evs[0]!.id)).delivery.state, "failed");
  const red = await sendDelivery(h, webhook.id, evs[1]!.id);
  assert.equal(red.delivery.state, "failed"); assert.match(red.delivery.lastError!, /redirect/);
  assert.equal((await sendDelivery(h, webhook.id, evs[2]!.id)).delivery.state, "retrying");
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.sent.length, 3, "a redirect is never followed");
});

test("webhooks.send_delivery: an address the egress policy refuses ends as failed, with nothing sent", async () => {
  const h = harness({ allow: ["only-this.example.org"] }); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const e = addEvent(h, { type: "a.one", payload: {} });
  const out = await sendDelivery(h, webhook.id, e.id);
  assert.equal(out.delivery.state, "failed"); assert.match(out.delivery.lastError!, /may not reach/);
  assert.equal(h.sent.length, 0); assert.deepEqual(h.scheduled, []);
});

test("webhooks.send_delivery: gives up after 24 hours of retrying, and 20 give-ups in a row switch the webhook off", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const old = NOW - 25 * 3_600_000;
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) {
    const e = addEvent(h, { type: "a.one", payload: { i } });
    ids.push(e.id);
    // as the consumer leaves it: queued a long time ago, never tried
    h.raw.run(`INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, state, attempts, at, first_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, `dlv_q${i}`, webhook.id, e.id, "a.one", "event", "pending", 0, old, old, old);
    h.replies.push({ status: 503 });
  }
  for (let i = 0; i < 19; i++) {
    const out = await sendDelivery(h, webhook.id, ids[i]!);
    assert.equal(out.delivery.state, "gave_up"); assert.equal(out.delivery.nextAttemptAt, undefined);
  }
  assert.equal(hook(h, webhook.id).active, 1); assert.equal(hook(h, webhook.id).gave_up_streak, 19);
  assert.deepEqual(h.scheduled, []);
  await sendDelivery(h, webhook.id, ids[19]!);
  assert.equal(hook(h, webhook.id).active, 0);
  const off = h.emitted.filter((x) => x.name === "webhook.disabled");
  assert.equal(off.length, 1); assert.match((off[0]!.payload as { reason: string }).reason, /20 deliveries/);
  const last = h.emitted.filter((x) => x.name === "webhook.delivery_failed").at(-1)!;
  assert.equal((last.payload as { willRetry: boolean }).willRetry, false);
});

test("webhooks.send_delivery: a delivery that succeeds resets the give-up count", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  h.raw.run(`UPDATE events_webhook SET gave_up_streak = ?, failure_streak = ? WHERE id = ?`, 5, 5, webhook.id);
  await sendDelivery(h, webhook.id, addEvent(h, { type: "a.one", payload: {} }).id);
  assert.equal(hook(h, webhook.id).gave_up_streak, 0); assert.equal(hook(h, webhook.id).failure_streak, 0);
});

test("webhooks.send_delivery: a switched-off webhook sends nothing; an unknown webhook or event is not found", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const e = addEvent(h, { type: "a.one", payload: {} });
  await H["webhooks.update"](admin(h), { webhookId: webhook.id, active: false });
  const out = await sendDelivery(h, webhook.id, e.id);
  assert.equal(out.delivery.state, "failed"); assert.match(out.delivery.lastError!, /switched off/);
  assert.equal(h.sent.length, 0);
  await rejects(sendDelivery(h, "whk_nope", e.id), "validation.not_found");
  await H["webhooks.update"](admin(h), { webhookId: webhook.id, active: true });
  await rejects(sendDelivery(h, webhook.id, "evt_nope"), "validation.not_found");
});

test("webhooks.send_delivery: the event is read as the webhook's owner, so one they may not see is not sent", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  h.raw.run(`UPDATE events_webhook SET created_by = ? WHERE id = ?`, "usr_member", webhook.id);
  const secret = addEvent(h, { type: "a.secret", label: 3, payload: {} });
  await rejects(sendDelivery(h, webhook.id, secret.id), "validation.not_found");
  // a queued row for an event that has since become unreadable ends as failed
  h.raw.run(`INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, state, attempts, at, first_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "dlv_gone", webhook.id, secret.id, "a.secret", "event", "pending", 0, NOW, NOW, NOW);
  const out = await sendDelivery(h, webhook.id, secret.id);
  assert.equal(out.delivery.state, "failed"); assert.match(out.delivery.lastError!, /no longer be read/);
  assert.equal(h.sent.length, 0);
});

test("webhooks.send_delivery: without the host ports it says so instead of sending", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const e = addEvent(h, { type: "a.one", payload: {} });
  setEventsHost(null);
  await rejects(sendDelivery(h, webhook.id, e.id), "internal.unavailable");
});

// ---------------------------------------------------------------- replay a delivery, the log

test("webhooks.replay_delivery: sends the stored body again with a fresh signature, once, as a new delivery", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook, secret } = await hooked(h);
  const e = addEvent(h, { type: "a.one", payload: { n: 1 } });
  const first = await sendDelivery(h, webhook.id, e.id);
  h.advance(90_000);
  const out = await H["webhooks.replay_delivery"](admin(h), { deliveryId: first.delivery.id, idempotencyKey: "r1" });
  assert.notEqual(out.delivery.id, first.delivery.id); assert.equal(out.delivery.state, "delivered"); assert.equal(out.delivery.attempts, 1); assert.equal(out.delivery.eventId, e.id);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1]!.init.body, h.sent[0]!.init.body, "same body");
  const a = verify(h, 0, secret), b = verify(h, 1, secret);
  assert.equal(b.t, a.t + 90, "fresh timestamp and signature");
  const rows = deliveries(h, webhook.id).filter((d) => d.event_id === e.id);
  assert.deepEqual(rows.map((d) => [d.kind, d.replay_of]), [["event", null], ["replay", first.delivery.id]]);
  assert.equal(rows[0]!.state, "delivered");
});

test("webhooks.replay_delivery: one attempt only; a never-sent or unknown delivery is refused", async () => {
  const h = harness(); seedExampleWorld(h);
  h.replies.push({ status: 500 });
  const out = await H["webhooks.replay_delivery"](admin(h), { deliveryId: "dlv_a1b2c3", idempotencyKey: "r" });
  assert.equal(out.delivery.state, "failed"); assert.deepEqual(h.scheduled, []);
  h.raw.run(`INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, state, attempts, at, first_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, "dlv_unsent", "whk_a1b2c3", "evt_x", "a.b", "event", "pending", 0, NOW, NOW);
  await rejects(H["webhooks.replay_delivery"](admin(h), { deliveryId: "dlv_unsent", idempotencyKey: "r2" }), "validation.bad_input");
  await rejects(H["webhooks.replay_delivery"](admin(h), { deliveryId: "dlv_nope", idempotencyKey: "r3" }), "validation.not_found");
});

test("webhooks.deliveries: newest first, filtered by state, paged", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  const evs = [] as string[];
  for (let i = 0; i < 4; i++) { h.advance(1000); const e = addEvent(h, { type: "a.one", payload: { i } }); evs.push(e.id); h.replies.push({ status: i % 2 ? 410 : 200 }); await sendDelivery(h, webhook.id, e.id); }
  const all = await H["webhooks.deliveries"](admin(h), { webhookId: webhook.id });
  assert.deepEqual(all.deliveries.map((d) => d.eventId), [...evs].reverse());
  const failed = await H["webhooks.deliveries"](admin(h), { webhookId: webhook.id, states: ["failed"] });
  assert.deepEqual(failed.deliveries.map((d) => d.state), ["failed", "failed"]);
  const p = await H["webhooks.deliveries"](admin(h), { webhookId: webhook.id, limit: 3 });
  assert.equal(p.deliveries.length, 3); assert.equal(p.next, "3"); assert.equal(p.total, 4);
  await rejects(H["webhooks.deliveries"](admin(h), { webhookId: "whk_nope" }), "validation.not_found");
});

test("webhooks.health: down when the ports are missing, degraded for failures, lag or a stuck queue, healthy otherwise", async () => {
  const h = harness(); seedExampleWorld(h);
  const { webhook } = await hooked(h);
  h.raw.run(`INSERT INTO events_state (key, value) VALUES (?, ?)`, "last_seq", 1);
  assert.deepEqual(await H["webhooks.health"](admin(h), {}), { state: "healthy", latencyMs: 12, lagEvents: 0, failing: 0 });
  h.raw.run(`UPDATE events_webhook SET failure_streak = ? WHERE id = ?`, 2, webhook.id);
  const f = await H["webhooks.health"](admin(h), {});
  assert.equal(f.state, "degraded"); assert.equal(f.failing, 1); assert.match(f.detail!, /failing/);
  h.raw.run(`UPDATE events_webhook SET failure_streak = ? WHERE id = ?`, 0, webhook.id);
  for (let i = 0; i < 150; i++) addEvent(h, { type: "a.one", payload: {} });
  const lag = await H["webhooks.health"](admin(h), {});
  assert.equal(lag.state, "degraded"); assert.equal(lag.lagEvents, 150);
  for (let i = 0; i < 900; i++) addEvent(h, { type: "a.one", payload: {} });
  assert.equal((await H["webhooks.health"](admin(h), {})).state, "down");
  h.raw.run(`UPDATE events_state SET value = ? WHERE key = ?`, h.log.at(-1)!.seq, "last_seq");
  h.raw.run(`INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, state, attempts, at, first_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "dlv_stuck", webhook.id, "evt_s", "a.b", "event", "pending", 0, NOW - 600_000, NOW - 600_000, NOW - 600_000);
  const stuck = await H["webhooks.health"](admin(h), {});
  assert.equal(stuck.state, "degraded"); assert.match(stuck.detail!, /waited/);
  setEventsHost(null);
  const down = await H["webhooks.health"](admin(h), {});
  assert.equal(down.state, "down"); assert.equal(down.lagEvents, 0);
});

// ---------------------------------------------------------------- event reads

test("events.list, get and since: read the log for the asker, page by seq, and open nothing sealed", async () => {
  const h = harness(); seedExampleWorld(h);
  const a = addEvent(h, { type: "record.created", entity: "record", entity_id: "rec_1", payload: { n: 1 } });
  addEvent(h, { type: "task.created", entity: "task", entity_id: "tsk_1", payload: { n: 2 } });
  addEvent(h, { type: "dm.sent", enc: 1, payload: new Uint8Array([1, 2, 3]) as never });
  addEvent(h, { type: "chat.said", entity: "message", entity_id: "msg_1", payload: {} });
  addEvent(h, { type: "mine.only", vis: "private", actor: "usr_a1b2c3", payload: {} });
  const ctx = h.as("usr_member");
  const all = await H["events.list"](ctx, {});
  assert.deepEqual(all.events.map((e) => e.type), ["record.updated", "record.created", "task.created", "dm.sent", "chat.said"]);
  assert.deepEqual(all.events.find((e) => e.type === "dm.sent")!.payload, { sealed: true });
  assert.equal("subject" in all.events.find((e) => e.type === "chat.said")!, false, "a subject outside the resource types is left off");
  assert.deepEqual(all.events.find((e) => e.type === "record.created")!.subject, { type: "record", id: "rec_1" });
  const own = await H["events.list"](admin(h), { types: ["mine.only"] });
  assert.equal(own.events.length, 1);
  assert.deepEqual((await H["events.list"](ctx, { types: ["mine.only"] })).events, []);
  const p1 = await H["events.list"](ctx, { limit: 2 });
  assert.equal(p1.events.length, 2); assert.equal(p1.next, "2");
  const p2 = await H["events.list"](ctx, { limit: 2, cursor: p1.next! });
  assert.deepEqual(p2.events.map((e) => e.seq), [3, 4]);
  assert.equal((await H["events.list"](ctx, { subject: { type: "task", id: "tsk_1" } })).events.length, 1);
  assert.equal((await H["events.get"](ctx, { eventId: a.id })).event.type, "record.created");
  await rejects(H["events.get"](ctx, { eventId: "evt_nope" }), "validation.not_found");
  const since = await H["events.since"](ctx, { after: 2, types: ["dm.*", "chat.*"] });
  assert.deepEqual(since.events.map((e) => e.type), ["dm.sent", "chat.said"]); assert.equal(since.head, h.log.at(-1)!.seq); assert.equal(since.next, since.head);
  assert.deepEqual((await H["events.since"](ctx, { after: since.head })).events, []);
});

test("events.list: a person sees their own private events, and someone who is not a member sees nothing", async () => {
  const h = harness(); seedExampleWorld(h);
  addEvent(h, { type: "x.private", vis: "private", actor: "usr_a1b2c3", payload: {} });
  assert.equal((await H["events.list"](admin(h), {})).events.length, 2);
  assert.equal((await H["events.list"](h.as("usr_member"), {})).events.length, 1);
  assert.deepEqual((await H["events.list"](h.as("usr_nobody"), {})).events, []);
});

test("events.list and events.get: without the host ports they answer internal.unavailable", async () => {
  const h = harness();
  setEventsHost(null);
  await rejects(H["events.list"](admin(h), {}), "internal.unavailable");
  await rejects(H["events.get"](admin(h), { eventId: "evt_a1b2c3" }), "internal.unavailable");
  await rejects(H["events.since"](admin(h), { after: 0 }), "internal.unavailable");
});

test("events.types: the catalogue from the registry, by prefix, sorted, with the trigger flag", async () => {
  const h = harness();
  const w = await H["events.types"](admin(h), { prefix: "webhook." });
  assert.deepEqual(w.types.map((t) => t.name), ["webhook.created", "webhook.deleted", "webhook.delivered", "webhook.delivery_failed", "webhook.disabled", "webhook.secret_rotated", "webhook.updated"]);
  assert.equal(w.types.every((t) => t.sv === 1 && t.summary.length > 0 && t.trigger === false), true);
  const r = await H["events.types"](admin(h), { prefix: "record.updated" });
  assert.equal(r.types.length, 1); assert.equal(r.types[0]!.trigger, true);
  const all = await H["events.types"](admin(h), {});
  assert.equal(all.types.length > 500, true);
  assert.deepEqual((await H["events.types"](admin(h), { prefix: "zzz" })).types, []);
});

// ---------------------------------------------------------------- replay entry

test("events.replay: resolves the events the asker can read, starts a replay Run once for the same scope, and records the scope", async () => {
  const h = harness(); seedExampleWorld(h);
  const t2 = "b".repeat(32);
  for (let i = 0; i < 4; i++) addEvent(h, { type: "a.one", trace_id: t2, payload: {} });
  addEvent(h, { type: "a.two", payload: {} });
  const out = await H["events.replay"](admin(h), { traceId: t2 });
  assert.deepEqual(out, { runId: "run_a1b2c3" });
  const call = h.calls.at(-1)!;
  assert.equal(call.cap, "runs.start");
  const input = call.input as Record<string, unknown>;
  assert.equal(input["kind"], "replay"); assert.equal(input["owner"], "usr_a1b2c3"); assert.deepEqual(input["subject"], { type: "space", id: "spc_test" }); assert.equal(input["name"], "Replay of 4 events");
  assert.equal(input["idempotencyKey"], `replay:${t2}:::2:5:4`);
  assert.deepEqual(call.opts, { idempotencyKey: input["idempotencyKey"] });
  const rec = row<{ selector: string; from_seq: number; to_seq: number; event_count: number; with_clearance: number; requested_by: string }>(h, `SELECT * FROM events_replay WHERE run_id = ?`, "run_a1b2c3");
  assert.deepEqual([rec.from_seq, rec.to_seq, rec.event_count, rec.with_clearance, rec.requested_by], [2, 5, 4, 0, "usr_a1b2c3"]);
  assert.equal(JSON.parse(rec.selector).traceId, t2);
  const ranged = await H["events.replay"](admin(h), { fromSeq: 3, toSeq: 4, withClearance: true });
  assert.equal(ranged.runId, "run_a1b2c3");
  const r2 = row<{ from_seq: number; to_seq: number; event_count: number; with_clearance: number }>(h, `SELECT * FROM events_replay WHERE run_id = ?`, "run_a1b2c3");
  assert.deepEqual([r2.from_seq, r2.to_seq, r2.event_count, r2.with_clearance], [3, 4, 2, 1]);
});

test("events.replay: needs a scope, a sane range and at least one readable event", async () => {
  const h = harness(); seedExampleWorld(h);
  await rejects(H["events.replay"](admin(h), {}), "validation.bad_input", /Name a trace/);
  await rejects(H["events.replay"](admin(h), { fromSeq: 5, toSeq: 2 }), "validation.bad_input", /ends before/);
  await rejects(H["events.replay"](admin(h), { traceId: "c".repeat(32) }), "validation.not_found");
  addEvent(h, { type: "x.hidden", vis: "private", actor: "usr_a1b2c3", trace_id: "d".repeat(32), payload: {} });
  await rejects(H["events.replay"](h.as("usr_member"), { traceId: "d".repeat(32) }), "validation.not_found");
  assert.deepEqual(h.calls, []);
  setEventsHost(null);
  await rejects(H["events.replay"](admin(h), { traceId: TRACE }), "internal.unavailable");
});

// ---------------------------------------------------------------- the consumer

/** A Tx over the in-memory engine. */
function txOf(h: Harness): Tx {
  return {
    run: (sql, ...a) => ({ changes: h.raw.run(sql, ...a).changes, lastInsertRowid: 0 }),
    get: <T,>(sql: string, ...a: unknown[]) => h.raw.all(sql, ...a)[0] as T | undefined,
    all: <T,>(sql: string, ...a: unknown[]) => h.raw.all(sql, ...a) as T[],
    exec: () => { throw new Error("not used"); },
  } as Tx;
}
const bytes = (x: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(x));
const stored = (o: Partial<ReturnType<typeof logged>> & { type: string }, payload: unknown = {}) => logged({ ...o, payload });

test("the pure matchers: type patterns, payload pointer filters, backoff", () => {
  assert.equal(typeMatches(["record.*"], "record.updated"), true);
  assert.equal(typeMatches(["record.*"], "records.updated"), false);
  assert.equal(typeMatches(["record.updated"], "record.updated"), true);
  assert.equal(typeMatches(["*"], "anything.at_all"), true);
  assert.equal(typeMatches([], "x.y"), false);
  const p = { type: "contact", fields: { stage: "won", tags: ["a"] }, "a/b": 1 };
  assert.equal(filterMatches(null, p), true);
  assert.equal(filterMatches({ "/type": "contact" }, p), true);
  assert.equal(filterMatches({ "/type": "company" }, p), false);
  assert.equal(filterMatches({ "/fields/stage": ["lost", "won"] }, p), true);
  assert.equal(filterMatches({ "/type": "contact", "/fields/stage": "lost" }, p), false);
  assert.equal(filterMatches({ "/missing": "x" }, p), false);
  assert.equal(filterMatches({ "/a~1b": 1 }, p), true);
  assert.equal(filterMatches("x", p), false);
});

test("the consumer queues one pending delivery per matching webhook and event, and starts each", async () => {
  const h = harness();
  const all = (await create(h, { name: "All", eventTypes: ["*"] })).webhook;
  const recs = (await create(h, { name: "Recs", eventTypes: ["record.*"], filter: { "/type": "contact" } })).webhook;
  const tasks = (await create(h, { name: "Tasks", eventTypes: ["task.*"] })).webhook;
  const off = (await create(h, { name: "Off", eventTypes: ["*"] })).webhook;
  await H["webhooks.update"](admin(h), { webhookId: off.id, active: false });
  const gone = (await create(h, { name: "Gone", eventTypes: ["*"] })).webhook;
  await H["webhooks.delete"](admin(h), { webhookId: gone.id });
  const started: unknown[] = [];
  const dispatch = async (cap: string, input: unknown) => { started.push([cap, input]); };
  const tx = txOf(h);
  const e = stored({ type: "record.updated", seq: 41, id: "evt_41" }, { type: "contact" });
  e.payload = bytes({ type: "contact" });
  assert.equal(await fanOut(tx, e, dispatch, NOW), 2);
  assert.deepEqual(deliveries(h, all.id).map((d) => [d.state, d.event_id, d.kind, d.attempts]), [["pending", "evt_41", "event", 0]]);
  assert.equal(deliveries(h, recs.id).length, 1); assert.equal(deliveries(h, tasks.id).length, 0); assert.equal(deliveries(h, off.id).length, 0); assert.equal(deliveries(h, gone.id).length, 0);
  assert.deepEqual(started.map((s) => (s as [string, { webhookId: string }])[1].webhookId).sort(), [all.id, recs.id].sort());
  assert.deepEqual((started[0] as [string, unknown])[0], "webhooks.send_delivery");
  assert.equal((started[0] as [string, { attempt: number; eventId: string }])[1].attempt, 1);
  assert.equal(row<{ value: number }>(h, `SELECT value FROM events_state WHERE key = ?`, "last_seq").value, 41);
  // the same event again (a crash before the cursor moved) queues nothing new
  assert.equal(await fanOut(tx, e, dispatch, NOW), 0);
  assert.equal(deliveries(h, all.id).length, 1);
  // the payload filter keeps a different contact type out
  const other = stored({ type: "record.updated", seq: 42, id: "evt_42" }); other.payload = bytes({ type: "company" });
  assert.equal(await fanOut(tx, other, dispatch, NOW), 1);
  assert.equal(deliveries(h, recs.id).length, 1);
});

test("the consumer never queues private, owner or participant events, Confidential or Restricted ones, encrypted ones, or webhook.* events", async () => {
  const h = harness();
  const w = (await create(h, { eventTypes: ["*"] })).webhook;
  const tx = txOf(h);
  const skips = [
    stored({ type: "a.private", seq: 1, id: "evt_1", vis: "private" }), stored({ type: "a.owner", seq: 2, id: "evt_2", vis: "owner" }), stored({ type: "a.part", seq: 3, id: "evt_3", vis: "participants" }),
    stored({ type: "a.conf", seq: 4, id: "evt_4", label: 2 }), stored({ type: "a.rest", seq: 5, id: "evt_5", label: 3 }), stored({ type: "a.enc", seq: 6, id: "evt_6", enc: 1 }),
    stored({ type: "webhook.delivered", seq: 7, id: "evt_7" }), stored({ type: "webhook.delivery_failed", seq: 8, id: "evt_8" }),
  ];
  for (const e of skips) assert.equal(await fanOut(tx, e, null, NOW), 0, e.type);
  assert.equal(deliveries(h, w.id).length, 0);
  assert.equal(row<{ value: number }>(h, `SELECT value FROM events_state WHERE key = ?`, "last_seq").value, 8, "the cursor still moves");
  assert.equal(await fanOut(tx, stored({ type: "a.internal", seq: 9, id: "evt_9", label: 1 }), null, NOW), 1);
});

test("the consumer survives a dispatcher that fails and one that is missing: the row stays pending and is found as due", async () => {
  const h = harness();
  const w = (await create(h, { eventTypes: ["*"] })).webhook;
  const tx = txOf(h);
  assert.equal(await fanOut(tx, stored({ type: "a.one", seq: 1, id: "evt_1" }), async () => { throw new Error("boom"); }, NOW), 1);
  assert.equal(await fanOut(tx, stored({ type: "a.two", seq: 2, id: "evt_2" }), null, NOW), 1);
  assert.deepEqual(deliveries(h, w.id).map((d) => d.state), ["pending", "pending"]);
  assert.deepEqual(dueDeliveries(h.system(), NOW).map((d) => d.event_id), ["evt_1", "evt_2"]);
  assert.deepEqual(dueDeliveries(h.system(), NOW - 1), []);
});

test("webhooksOut: a durable async consumer that answers for every event name and creates its tables from the migration", () => {
  assert.equal(webhooksOut.name, "events.webhooks_out"); assert.equal(webhooksOut.mode, "async"); assert.equal(webhooksOut.rebuild, "replay");
  assert.equal(typeof webhooksOut.on["record.updated"], "function"); assert.equal(typeof webhooksOut.on["anything.else"], "function");
  const sql = migrationSql();
  for (const t of ["events_webhook", "events_delivery", "events_replay", "events_state"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} `));
  assert.deepEqual(Object.keys(hostSeams).sort(), ["setEventsDispatch", "setEventsHost"]);
});

test("end to end: an event reaches a webhook through the consumer, the dispatcher and the handler, signed, and shows in the delivery log", async () => {
  const h = harness();
  const { webhook, secret } = await hooked(h, { eventTypes: ["record.*"] });
  const e = addEvent(h, { type: "record.created", entity: "record", entity_id: "rec_5", payload: { recordId: "rec_5" } });
  const dispatch = async (cap: string, input: unknown) => (H as unknown as Record<string, (c: EventsCtx, i: never) => Promise<unknown>>)[cap]!(h.system(), input as never);
  assert.equal(await fanOut(txOf(h), e, dispatch, NOW), 1);
  assert.equal(h.sent.length, 1);
  assert.equal(JSON.parse(verify(h, 0, secret).body).payload.recordId, "rec_5");
  const log = await H["webhooks.deliveries"](admin(h), { webhookId: webhook.id });
  assert.deepEqual(log.deliveries.map((d) => [d.eventId, d.state, d.attempts]), [[e.id, "delivered", 1]]);
});
