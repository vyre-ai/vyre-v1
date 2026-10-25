// P-H_05: the events module's host ports. The read port over a real log store (filters, cursor, vis, label, agent and service readers, sealed payloads) and the signed POST port
// against a fake network (allowlist, private addresses, redirects, timeout, body cap, signature header).
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import { LogStore } from "../../kernel/src/log/store.ts";
import type { NewEvent, ReadQuery, StoredEvent } from "../../kernel/src/log/types.ts";
import { HostError } from "../src/routes/errors.ts";
import {
  createEventLogPort, createEventsHost, createWebhookPostPort, hmacSha256Hex, isPrivateHost, signWebhook, wireEventsSeam,
} from "../src/seams/events-ports.ts";
import type { EventLogSource, EventsHostSeam, PostFetch, PostInit } from "../src/seams/events-ports.ts";

const NOW = 1_760_000_000_000;
const TRACE = "a".repeat(32);
const code = (c: string) => (e: unknown): boolean => e instanceof HostError && e.error.code === c;

// ---------------------------------------------------------------- HMAC

test("events-ports: hmacSha256Hex matches node's HMAC for short, block-size and long keys", () => {
  const keys = ["Jefe", "k", "x".repeat(64), "y".repeat(65), "z".repeat(131), "whsec_" + "ab12".repeat(10)];
  for (const k of keys) for (const m of ["", "what do ya want for nothing?", `${NOW}.{"a":1}`, "é ü ✓"]) {
    assert.equal(hmacSha256Hex(k, m), createHmac("sha256", k).update(m).digest("hex"), `key ${k.length} message ${m.length}`);
  }
  assert.equal(hmacSha256Hex("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});

test("events-ports: signWebhook is t=<ts>,v1=<hmac of ts.body>", () => {
  const body = '{"x":1}';
  const sig = signWebhook("sek", 1_760_000_000, body);
  assert.equal(sig, `t=1760000000,v1=${createHmac("sha256", "sek").update(`1760000000.${body}`).digest("hex")}`);
});

// ---------------------------------------------------------------- read port

function snapshot(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 1, perms: [], name: "Member" });
  s.putRole({ id: "owner", clearance: 3, perms: [], name: "Owner" });
  s.putPrincipal({ id: "usr_owner", kind: "person", status: "active" });
  s.putPrincipal({ id: "usr_maya", kind: "person", status: "active" });
  s.putPrincipal({ id: "usr_sam", kind: "person", status: "active" });
  s.putPrincipal({ id: "usr_gone", kind: "person", status: "removed" });
  s.putPrincipal({ id: "agt_helper", kind: "agent", owner: "usr_maya", status: "active" });
  s.putPrincipal({ id: "svc_hook", kind: "svc", owner: "usr_maya", status: "active" });
  s.addPrincipalRole({ holder: "usr_owner", role: "owner" });
  for (const h of ["usr_maya", "usr_sam", "usr_gone", "agt_helper", "svc_hook"]) s.addPrincipalRole({ holder: h, role: "member" });
  return s;
}

let counter = 0;
function ev(o: Partial<NewEvent> & { type: string }): NewEvent {
  counter++;
  return { sv: 1, trace_id: TRACE, actor: "usr_maya", vis: "space", payload: { n: counter }, ...o };
}

function world(events: NewEvent[]) {
  const db = new DatabaseSync(":memory:");
  const store = new LogStore({ db, space: "spc_1", clock: () => NOW });
  store.appendBatch(events);
  const reads: ReadQuery[] = [];
  const source: EventLogSource = { read: (q) => { reads.push(q); return store.read(q); }, head: () => store.head.seq };
  const snap = snapshot();
  const port = createEventLogPort({ source, access: () => snap, owner: () => "usr_owner", now: () => NOW });
  return { port, store, reads, snap, source };
}

const maya = { principal: "usr_maya" };
const types = (r: { events: { type: string }[] }): string[] => r.events.map((e) => e.type);

test("events-ports: list reads from a cursor in order, filters by type, pattern, actor, run, trace and time, and pages", async () => {
  const w = world([
    ev({ type: "record.created", entity: "record", entity_id: "rec_1" }),
    ev({ type: "record.updated", entity: "record", entity_id: "rec_1", actor: "usr_sam", run_id: "run_1" }),
    ev({ type: "task.created", entity: "task", entity_id: "tsk_1" }),
    ev({ type: "task.completed", entity: "task", entity_id: "tsk_1", trace_id: "b".repeat(32) }),
  ]);
  const all = await w.port.list(maya);
  assert.deepEqual(types(all), ["record.created", "record.updated", "task.created", "task.completed"]);
  assert.deepEqual(all.events.map((e) => e.seq), [1, 2, 3, 4]);
  assert.equal(all.head, 4); assert.equal(all.more, false);
  assert.deepEqual(types(await w.port.list(maya, { types: ["record.*"] })), ["record.created", "record.updated"]);
  assert.deepEqual(types(await w.port.list(maya, { types: ["task.created", "record.updated"] })), ["record.updated", "task.created"]);
  assert.deepEqual(types(await w.port.list(maya, { actor: "usr_sam" })), ["record.updated"]);
  assert.deepEqual(types(await w.port.list(maya, { runId: "run_1" })), ["record.updated"]);
  assert.deepEqual(types(await w.port.list(maya, { traceId: "b".repeat(32) })), ["task.completed"]);
  assert.deepEqual(types(await w.port.list(maya, { subject: { type: "task", id: "tsk_1" } })), ["task.created", "task.completed"]);
  assert.deepEqual(types(await w.port.list(maya, { fromAt: NOW + 1 })), []);
  assert.equal((await w.port.list(maya, { toAt: NOW })).events.length, 4);
  const p1 = await w.port.list(maya, { limit: 3 });
  assert.equal(p1.events.length, 3); assert.equal(p1.more, true); assert.equal(p1.next, 3);
  const p2 = await w.port.list(maya, { limit: 3, after: p1.next });
  assert.deepEqual(p2.events.map((e) => e.seq), [4]); assert.equal(p2.more, false);
});

test("events-ports: a row carries the envelope fields and the decoded payload", async () => {
  const w = world([ev({ type: "record.updated", entity: "record", entity_id: "rec_9", on_behalf: "usr_sam", run_id: "run_7", origin: "automation:aut_1", payload: { fields: { name: "A" } } })]);
  const [row] = (await w.port.list(maya)).events;
  assert.equal(row!.type, "record.updated");
  assert.equal(row!.traceId, TRACE);
  assert.equal(row!.onBehalf, "usr_sam"); assert.equal(row!.runId, "run_7"); assert.equal(row!.origin, "automation:aut_1");
  assert.deepEqual(row!.subject, { type: "record", id: "rec_9" });
  assert.deepEqual(row!.payload, { fields: { name: "A" } });
  assert.equal(row!.sealed, undefined);
});

test("events-ports: since moves the cursor past events the reader may not see", async () => {
  const w = world([
    ev({ type: "a.one" }),
    ev({ type: "a.two", vis: "private", actor: "usr_sam" }),
    ev({ type: "a.three", vis: "private", actor: "usr_sam" }),
  ]);
  const r = await w.port.since(maya, 0);
  assert.deepEqual(types(r), ["a.one"]);
  assert.equal(r.next, 3); assert.equal(r.head, 3);
  const none = await w.port.since(maya, 3);
  assert.deepEqual(none.events, []); assert.equal(none.next, 3);
  assert.deepEqual(types(await w.port.since({ principal: "usr_sam" }, 0, { types: ["a.*"] })), ["a.one", "a.two", "a.three"]);
});

test("events-ports: label above the reader's clearance leaves the event out", async () => {
  const w = world([ev({ type: "note.created", label: 0 }), ev({ type: "note.sealed_off", label: 2 }), ev({ type: "note.top", label: 3 })]);
  assert.deepEqual(types(await w.port.list(maya)), ["note.created"]);
  assert.deepEqual(types(await w.port.list({ principal: "usr_owner" })), ["note.created", "note.sealed_off", "note.top"]);
  assert.equal(await w.port.get(maya, (await w.port.list({ principal: "usr_owner" })).events[1]!.id), null);
});

test("events-ports: vis space, participants, owner and private", async () => {
  const w = world([
    ev({ type: "v.space", vis: "space", actor: "usr_sam" }),
    ev({ type: "v.private", vis: "private", actor: "usr_sam" }),
    ev({ type: "v.private_for", vis: "private", actor: "usr_sam", on_behalf: "usr_maya" }),
    ev({ type: "v.owner", vis: "owner", actor: "usr_sam" }),
    ev({ type: "v.participants", vis: "participants", actor: "usr_sam", entity: "record", entity_id: "rec_x" }),
    ev({ type: "v.participants_mine", vis: "participants", actor: "usr_maya" }),
  ]);
  assert.deepEqual(types(await w.port.list(maya)), ["v.space", "v.private_for", "v.participants_mine"]);
  assert.deepEqual(types(await w.port.list({ principal: "usr_sam" })), ["v.space", "v.private", "v.private_for", "v.owner", "v.participants"]);
  assert.deepEqual((await w.port.list({ principal: "usr_owner" }).then(types)).filter((t) => t !== "v.participants"), ["v.space", "v.owner"]);
});

test("events-ports: participants reach whoever may view the entity", async () => {
  const w = world([ev({ type: "v.participants", vis: "participants", actor: "usr_sam", entity: "record", entity_id: "rec_x" })]);
  assert.equal((await w.port.list(maya)).events.length, 0);
  w.snap.putResource({ id: "rec_x", type: "record", parent_id: null, label: 0, owner_id: "usr_sam", holds: 0 });
  w.snap.putGrant({ id: "grt_1", subject_kind: "actor", subject_id: "usr_maya", resource_type: "record", resource_id: "rec_x", level: "view" });
  assert.equal((await w.port.list(maya)).events.length, 1);
});

test("events-ports: an agent reads for the person it acts for, a service for its owner, anyone else for nobody", async () => {
  const w = world([ev({ type: "v.private_for", vis: "private", actor: "usr_sam", on_behalf: "usr_maya" }), ev({ type: "v.space" })]);
  assert.deepEqual(types(await w.port.list({ principal: "agt_helper", actingFor: "usr_maya" })), ["v.private_for", "v.space"]);
  assert.deepEqual(await w.port.list({ principal: "agt_helper" }).then(types), []);
  assert.deepEqual(types(await w.port.list({ principal: "svc_hook" })), ["v.private_for", "v.space"]);
  assert.deepEqual(await w.port.list({ principal: "usr_nobody" }).then(types), []);
  assert.deepEqual(await w.port.list({ principal: "usr_gone" }).then(types), []);
  assert.deepEqual(await w.port.since({ principal: "usr_gone" }, 0).then(types), []);
});

test("events-ports: an encrypted payload is never opened", async () => {
  const w = world([ev({ type: "dm.sent", enc: 1, key_id: "k1", nonce: "AAAA", payload: new Uint8Array([1, 2, 3, 4]) })]);
  const [row] = (await w.port.list(maya)).events;
  assert.equal(row!.payload, null); assert.equal(row!.sealed, true);
});

test("events-ports: get finds one event by id, with or without the source's own lookup, and hides what the reader may not see", async () => {
  const w = world([ev({ type: "a.one" }), ev({ type: "a.two", vis: "private", actor: "usr_sam" })]);
  const [one, two] = (await w.port.list({ principal: "usr_sam" })).events;
  assert.equal((await w.port.get(maya, one!.id))?.type, "a.one");
  assert.equal(await w.port.get(maya, two!.id), null);
  assert.equal(await w.port.get(maya, "evt_missing"), null);
  assert.equal((await w.port.get({ principal: "usr_sam" }, two!.id))?.type, "a.two");
  let calls = 0;
  const withLookup = createEventLogPort({
    source: { ...w.source, byId: (id) => { calls++; return w.store.read({}).find((e: StoredEvent) => e.id === id) ?? null; } },
    access: () => w.snap, owner: () => "usr_owner", now: () => NOW,
  });
  assert.equal((await withLookup.get(maya, one!.id))?.type, "a.one");
  assert.equal(calls, 1);
});

test("events-ports: a long run of invisible events is scanned in batches and bounded by maxScan", async () => {
  const many: NewEvent[] = [];
  for (let i = 0; i < 450; i++) many.push(ev({ type: "x.hidden", vis: "private", actor: "usr_sam" }));
  many.push(ev({ type: "x.shown" }));
  const w = world(many);
  const r = await w.port.list(maya, { limit: 5 });
  assert.deepEqual(types(r), ["x.shown"]);
  assert.equal(w.reads.length > 1, true);
  const capped = createEventLogPort({ source: w.source, access: () => w.snap, owner: () => null, now: () => NOW, maxScan: 300 });
  const c = await capped.list(maya, { limit: 5 });
  assert.deepEqual(c.events, []); assert.equal(c.more, true); assert.equal(c.next < 451, true);
  assert.deepEqual(types(await capped.list(maya, { limit: 5, after: c.next })), ["x.shown"]);
});

// ---------------------------------------------------------------- POST port

interface Sent { url: string; init: PostInit }
function network(reply: (url: string, init: PostInit) => Promise<{ status: number; body?: string; location?: string }>) {
  const sent: Sent[] = [];
  const fetch: PostFetch = async (url, init) => {
    sent.push({ url, init });
    const r = await reply(url, init);
    return { status: r.status, headers: { get: (n) => (n.toLowerCase() === "location" ? r.location ?? null : null) }, text: async () => r.body ?? "" };
  };
  return { fetch, sent };
}
const ok = async () => ({ status: 200, body: "fine" });
const send = { body: '{"event":"record.updated"}', secret: "whsec_test", eventId: "evt_abc", eventType: "record.updated", traceId: TRACE };

test("events-ports: a delivery is one signed POST with the trace and event headers", async () => {
  const n = network(ok);
  const port = createWebhookPostPort({ allow: () => ["hooks.example.com"], fetch: n.fetch, now: () => NOW });
  const r = await port.post({ ...send, url: "https://hooks.example.com/in/1" });
  assert.equal(r.ok, true); assert.equal(r.status, 200); assert.equal(r.excerpt, "fine"); assert.equal(r.signatureTimestamp, NOW / 1000);
  assert.equal(n.sent.length, 1);
  const { url, init } = n.sent[0]!;
  assert.equal(url, "https://hooks.example.com/in/1");
  assert.equal(init.method, "POST"); assert.equal(init.redirect, "manual"); assert.equal(init.body, send.body);
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.headers["x-vyre-trace"], TRACE); assert.equal(init.headers["x-vyre-event"], "record.updated");
  assert.equal(init.headers["x-vyre-signature"], signWebhook("whsec_test", NOW / 1000, send.body));
  assert.match(init.headers["x-vyre-signature"]!, /^t=\d+,v1=[0-9a-f]{64}$/);
});

test("events-ports: a replay passes a time and signs with it", async () => {
  const n = network(ok);
  const port = createWebhookPostPort({ allow: () => ["example.com"], fetch: n.fetch, now: () => NOW });
  await port.post({ ...send, url: "https://hooks.example.com/x", at: NOW + 60_000 });
  assert.equal(n.sent[0]!.init.headers["x-vyre-signature"], signWebhook("whsec_test", NOW / 1000 + 60, send.body));
});

test("events-ports: the allowlist covers a domain and its subdomains; '*' opens any public host; empty refuses all", async () => {
  const n = network(ok);
  const post = (allow: string[], url: string) => createWebhookPostPort({ allow: () => allow, fetch: n.fetch, now: () => NOW }).post({ ...send, url });
  assert.equal((await post(["example.com"], "https://a.b.example.com/h")).ok, true);
  await assert.rejects(post(["example.com"], "https://evilexample.com/h"), code("permission.no_grant"));
  await assert.rejects(post(["example.com"], "https://example.com.evil.io/h"), code("permission.no_grant"));
  await assert.rejects(post([], "https://example.com/h"), code("permission.no_grant"));
  assert.equal((await post(["*"], "https://anything.test/h")).ok, true);
  assert.equal(n.sent.length, 2);
});

test("events-ports: http, credentials, loopback, private, link-local and internal hosts are refused even with '*'", async () => {
  const n = network(ok);
  const post = (url: string) => createWebhookPostPort({ allow: () => ["*"], fetch: n.fetch, now: () => NOW }).post({ ...send, url });
  for (const url of [
    "http://hooks.example.com/h", "https://user:pw@hooks.example.com/h", "https://localhost/h", "https://127.0.0.1/h", "https://10.0.0.5/h", "https://192.168.1.1/h",
    "https://172.20.0.1/h", "https://169.254.169.254/latest/meta-data", "https://0.0.0.0/h", "https://[::1]/h", "https://db.internal/h", "https://printer.local/h",
    "https://intranet/h", "https://2130706433/h", "https://100.64.0.1/h",
  ]) await assert.rejects(post(url), code("permission.no_grant"), url);
  await assert.rejects(post("not a url"), code("validation.bad_input"));
  assert.equal(n.sent.length, 0);
  assert.equal(isPrivateHost("93.184.216.34"), false);
  assert.equal(isPrivateHost("hooks.example.com"), false);
});

test("events-ports: a body over the cap is refused before anything is sent", async () => {
  const n = network(ok);
  const port = createWebhookPostPort({ allow: () => ["*"], fetch: n.fetch, now: () => NOW, maxBodyBytes: 100 });
  await assert.rejects(port.post({ ...send, url: "https://h.example.com/", body: "x".repeat(101) }), code("validation.too_large"));
  assert.equal((await port.post({ ...send, url: "https://h.example.com/", body: "x".repeat(100) })).ok, true);
  assert.equal(n.sent.length, 1);
});

test("events-ports: a redirect is a failure and is not followed; non-2xx carries its status", async () => {
  const redirect = network(async () => ({ status: 302, location: "https://169.254.169.254/" }));
  const r = await createWebhookPostPort({ allow: () => ["*"], fetch: redirect.fetch, now: () => NOW }).post({ ...send, url: "https://h.example.com/" });
  assert.equal(r.ok, false); assert.equal(r.status, 302); assert.match(r.error!, /redirect/);
  assert.equal(redirect.sent.length, 1);
  const bad = network(async () => ({ status: 500, body: "boom" }));
  const b = await createWebhookPostPort({ allow: () => ["*"], fetch: bad.fetch, now: () => NOW }).post({ ...send, url: "https://h.example.com/" });
  assert.equal(b.ok, false); assert.equal(b.status, 500); assert.equal(b.excerpt, "boom");
});

test("events-ports: the answer kept for the log is capped", async () => {
  const n = network(async () => ({ status: 200, body: "y".repeat(5000) }));
  const r = await createWebhookPostPort({ allow: () => ["*"], fetch: n.fetch, now: () => NOW, maxResponseChars: 50 }).post({ ...send, url: "https://h.example.com/" });
  assert.equal(r.excerpt!.length, 50);
});

test("events-ports: a silent endpoint times out, a network failure is reported, neither throws", async () => {
  let aborted = false;
  const slow = network((_u, init) => new Promise(() => { init.signal.addEventListener("abort", () => { aborted = true; }); }));
  const t0 = Date.now();
  const r = await createWebhookPostPort({ allow: () => ["*"], fetch: slow.fetch, now: () => Date.now(), timeoutMs: 30 }).post({ ...send, url: "https://h.example.com/" });
  assert.equal(r.ok, false); assert.equal(r.status, undefined); assert.match(r.error!, /No answer/);
  assert.equal(Date.now() - t0 < 2000, true); assert.equal(aborted, true);
  const down = network(async () => { throw new Error("ECONNREFUSED secret-host-detail"); });
  const d = await createWebhookPostPort({ allow: () => ["*"], fetch: down.fetch, now: () => NOW }).post({ ...send, url: "https://h.example.com/" });
  assert.equal(d.ok, false); assert.equal(d.error, "The endpoint could not be reached.");
});

test("events-ports: the secret never appears in the result", async () => {
  const n = network(ok);
  const r = await createWebhookPostPort({ allow: () => ["*"], fetch: n.fetch, now: () => NOW }).post({ ...send, url: "https://h.example.com/" });
  assert.equal(JSON.stringify(r).includes("whsec_test"), false);
});

// ---------------------------------------------------------------- seam

test("events-ports: wireEventsSeam hands the module both ports through its setter, and takes them back", async () => {
  const w = world([ev({ type: "a.one" })]);
  const n = network(ok);
  const deps = { reader: { source: w.source, access: () => w.snap, owner: () => null, now: () => NOW }, post: { allow: () => ["*"], fetch: n.fetch, now: () => NOW } };
  let got: EventsHostSeam | null = null;
  const wired = wireEventsSeam({ setEventsHost: (h) => { got = h; } }, deps);
  assert.equal(wired.state, "wired");
  assert.ok(got);
  const host = got as EventsHostSeam;
  assert.equal((await host.events.list(maya)).events.length, 1);
  assert.equal((await host.webhooks.post({ ...send, url: "https://h.example.com/" })).ok, true);
  wired.unwire();
  assert.equal(got, null);
  assert.equal(wireEventsSeam({}, deps).state, "absent");
  assert.ok(createEventsHost(deps).events);
});
