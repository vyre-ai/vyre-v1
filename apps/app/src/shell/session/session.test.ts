// The real session path with no network: a fake gateway behind `fetch`, a fake socket behind the live link. Every claim here is about what a place would see.
import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenIndexEntry } from "../../../../../generated/screens.ts";
import { CapError, createCapCaller, indexByCap, queryString } from "./caps.ts";
import type { RouteRow } from "./caps.ts";
import { fakeServer, settle } from "../../../../../client/src/connection/testing.ts";
import { createLiveLink, socketBase, socketPath } from "./live.ts";
import { createRemoteScreenHooks, stableJson } from "./remote-hooks.ts";
import { openRealSession, targetHash } from "./session.ts";
import { clearStored, readStored, spaceAddress, writeStored } from "./stored.ts";
import type { KeyValueStore } from "./stored.ts";

const ROUTES: RouteRow[] = [
  { method: "POST", path: "/v1/identity/whoami", cap: "identity.whoami", v: 1 },
  { method: "GET", path: "/v1/spaces/get", cap: "spaces.get", v: 1 },
  { method: "GET", path: "/v1/spaces/switcher", cap: "spaces.switcher", v: 1 },
  { method: "GET", path: "/v1/files/list", cap: "files.list", v: 1 },
  { method: "POST", path: "/v1/files/rename", cap: "files.rename", v: 1 },
  { method: "POST", path: "/v1/old", cap: "old.cap", v: 1 },
  { method: "POST", path: "/v2/old", cap: "old.cap", v: 2 },
];

const screen = (queries: ScreenIndexEntry["queries"]): ScreenIndexEntry => ({ id: "files.list", module: "files", place: "files", slot: "main", builtin: null, caller: "principal", queries, actions: {}, needs: [], perf: null });
const SCREENS = new Map<string, ScreenIndexEntry>([
  ["files.list", screen({ items: { cap: "files.list", input: { folder: "/state/folder" }, live: true }, once: { cap: "files.list", input: {}, live: false } })],
]);

interface Seen { method: string; url: string; headers: Record<string, string>; body: unknown }

/** A gateway: answers by "METHOD path", records what it was sent. */
function gateway(answers: Record<string, (seen: Seen) => { status?: number; body: unknown }>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input));
    const s: Seen = { method: init?.method ?? "GET", url: u.pathname + u.search, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    seen.push(s);
    const a = answers[`${s.method} ${u.pathname}`];
    const r = a ? a(s) : { status: 404, body: { error: { code: "validation.unknown_capability", message: "nope", traceId: "t0" } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "x-vyre-trace": "trace-1" } });
  }) as typeof fetch;
  return { fetch: f, seen };
}
const wait = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("caps: a GET sends the query string and the bearer token, a POST sends the JSON body", async () => {
  const gw = gateway({
    "GET /v1/files/list": () => ({ body: { data: { items: [] } } }),
    "POST /v1/files/rename": () => ({ body: { data: { ok: true } } }),
  });
  const call = createCapCaller({ baseUrl: "http://s.test/", token: () => "vst_abc", fetch: gw.fetch, routes: async () => ROUTES });
  assert.deepEqual(await call("files.list", { folder: "root", limit: 5, flags: { a: 1 } }), { items: [] });
  assert.deepEqual(await call("files.rename", { id: "f1", name: "x" }, { idempotencyKey: "k1" }), { ok: true });
  assert.equal(gw.seen[0]!.url, "/v1/files/list?folder=root&limit=5&flags=%7B%22a%22%3A1%7D");
  assert.equal(gw.seen[0]!.headers["authorization"], "Bearer vst_abc");
  assert.equal(gw.seen[0]!.body, undefined);
  assert.deepEqual(gw.seen[1]!.body, { id: "f1", name: "x" });
  assert.equal(gw.seen[1]!.headers["idempotency-key"], "k1");
});

test("caps: an anonymous call sends no Authorization header", async () => {
  const gw = gateway({ "POST /v1/identity/whoami": () => ({ body: { data: {} } }) });
  await createCapCaller({ baseUrl: "http://s.test", token: () => null, fetch: gw.fetch, routes: async () => ROUTES })("identity.whoami", {});
  assert.equal(gw.seen[0]!.headers["authorization"], undefined);
});

test("caps: an error answer becomes a CapError with the code, the message and the trace id", async () => {
  const gw = gateway({ "GET /v1/files/list": () => ({ status: 403, body: { error: { code: "auth.forbidden", message: "You cannot open this.", traceId: "abc123" } } }) });
  const call = createCapCaller({ baseUrl: "http://s.test", token: () => "t", fetch: gw.fetch, routes: async () => ROUTES });
  await assert.rejects(call("files.list", {}), (e: unknown) => e instanceof CapError && e.code === "auth.forbidden" && e.message === "You cannot open this." && e.traceId === "abc123" && e.status === 403);
});

test("caps: a 401 with a token tells the session it is over; an unknown capability is a 404 CapError", async () => {
  let out = 0;
  const gw = gateway({ "GET /v1/files/list": () => ({ status: 401, body: { error: { code: "auth.unauthenticated", message: "Sign in.", traceId: "t" } } }) });
  const call = createCapCaller({ baseUrl: "http://s.test", token: () => "t", fetch: gw.fetch, routes: async () => ROUTES, onUnauthenticated: () => { out++; } });
  await assert.rejects(call("files.list", {}), CapError);
  assert.equal(out, 1);
  await assert.rejects(call("nope.nothing", {}), (e: unknown) => e instanceof CapError && e.status === 404);
});

test("caps: the newest version of a capability's route wins, and a query string leaves out missing values", () => {
  assert.equal(indexByCap(ROUTES).get("old.cap")!.path, "/v2/old");
  assert.equal(queryString({ a: "x", b: undefined, c: null, d: true }), "?a=x&d=true");
  assert.equal(queryString(undefined), "");
});

test("hooks: a query is loading, then ready with the data; a second read of the same query is the same object", async () => {
  const hooks = createRemoteScreenHooks({ screens: SCREENS, read: async () => ({ items: [{ id: "f1" }] }) });
  const q = hooks.query("files.list", "items", { folder: "root" });
  assert.equal(q.getSnapshot().status, "loading");
  let told = 0;
  const off = q.subscribe(() => { told++; });
  await wait();
  const first = q.getSnapshot();
  assert.equal(first.status, "ready");
  assert.equal(told, 1);
  assert.equal(hooks.query("files.list", "items", { folder: "root" }), q);
  hooks.invalidate();
  await wait();
  assert.equal(q.getSnapshot(), first, "identical data keeps the same snapshot object");
  assert.equal(told, 1);
  off();
  hooks.close();
});

test("hooks: changed data replaces the snapshot and tells the listener; an unwatched query is re-read when watched again", async () => {
  let v = 1;
  let reads = 0;
  const hooks = createRemoteScreenHooks({ screens: SCREENS, read: async () => { reads++; return { v }; } });
  const q = hooks.query("files.list", "items");
  const off = q.subscribe(() => undefined);
  await wait();
  const a = q.getSnapshot();
  v = 2;
  hooks.invalidate();
  await wait();
  const b = q.getSnapshot();
  assert.notEqual(a, b);
  assert.deepEqual(b.status === "ready" ? b.data : null, { v: 2 });
  off();
  assert.equal(hooks.watching(), 0);
  v = 3;
  hooks.invalidate();
  await wait();
  assert.equal(reads, 2, "nobody watched, so nothing was read");
  q.subscribe(() => undefined);
  await wait();
  assert.deepEqual((q.getSnapshot() as { data: unknown }).data, { v: 3 });
  hooks.close();
});

test("hooks: a failed read keeps the last answer and reports the error; unknown screens and non-live queries throw", async () => {
  let fail = false;
  const errors: string[] = [];
  const hooks = createRemoteScreenHooks({ screens: SCREENS, read: async () => { if (fail) throw new Error("down"); return { ok: 1 }; }, onError: (cap) => errors.push(cap) });
  const q = hooks.query("files.list", "items");
  q.subscribe(() => undefined);
  await wait();
  const good = q.getSnapshot();
  fail = true;
  hooks.invalidate();
  await wait();
  assert.equal(q.getSnapshot(), good);
  assert.deepEqual(errors, ["files.list"]);
  assert.throws(() => hooks.query("nope", "items"), /unknown screen/);
  assert.throws(() => hooks.query("files.list", "missing"), /no query/);
  assert.throws(() => hooks.query("files.list", "once"), /not live/);
  hooks.close();
});

test("hooks: key order does not change a query's identity", () => {
  assert.equal(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }), stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

const change = (seq: number) => ({ seq, entity: "contact", id: `r${seq}`, op: "upsert" as const, fields: { name: { v: `n${seq}`, hlc: "000000000001-0000-srv", actor: "usr_a" } } });

test("live: the manager says hello with this device and the cursor, reaches live, reports each batch and acks it", async () => {
  const srv = fakeServer();
  const changes: number[] = [];
  const states: string[] = [];
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "vst_1", deviceId: "dev_web", epoch: 3, registryHash: "h1", onChange: (n) => changes.push(n), onStatus: (x) => states.push(x), dial: srv.dial });
  link.start();
  await settle();
  assert.equal(link.status(), "live");
  assert.deepEqual(srv.sockets[0]!.hellos, [{ cursor: 0, deviceId: "dev_web" }]);
  srv.broadcast({ t: "ev", seq: 5, items: [change(5)] });
  await settle();
  assert.deepEqual(changes, [5]);
  assert.deepEqual(srv.got("ack"), [{ t: "ack", seq: 5 }]);
  link.stop();
  assert.equal(link.status(), "offline");
  assert.equal(states[0], "connecting");
  assert.ok(states.includes("live"));
});

test("live: a server that is not live (update required) leaves the link offline, so the session polls", async () => {
  const srv = fakeServer();
  srv.mode = "update_required";
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "t", deviceId: "d", epoch: 0, registryHash: "old", onChange: () => undefined, dial: srv.dial });
  link.start();
  await settle();
  assert.equal(link.status(), "offline");
  link.stop();
});

test("live: a revoked device (purge) tells the session", async () => {
  const srv = fakeServer();
  let purged = 0;
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "t", deviceId: "d", epoch: 0, registryHash: "h", onChange: () => undefined, onPurge: () => { purged++; }, dial: srv.dial });
  link.start();
  await settle();
  srv.broadcast({ t: "purge", epoch: 4 });
  await settle();
  assert.equal(purged, 1);
  link.stop();
});

test("live: the socket address swaps http for ws, drops the path and carries the token", () => {
  assert.equal(socketBase("http://127.0.0.1:7777/x?y=1"), "ws://127.0.0.1:7777");
  assert.equal(socketBase("https://s.test"), "wss://s.test");
  assert.equal(socketPath("ws://127.0.0.1:7777", "a b"), "ws://127.0.0.1:7777/sync/v1/ws?token=a%20b");
});

const WHOAMI = { principal: { kind: "person", id: "usr_irfad" }, name: "Irfad Imtiaz", roles: ["owner"], groups: [], epoch: 1, spaceId: "spc_nw" };
const SPACE = { space: { id: "spc_nw", name: "Northwind", kind: "team", owner: "usr_irfad", fingerprint: "ab", address: { mode: "relay" }, defaults: {} } };

function sessionGateway(extra: Record<string, (s: Seen) => { status?: number; body: unknown }> = {}): ReturnType<typeof gateway> {
  return gateway({
    "POST /v1/identity/whoami": () => ({ body: { data: WHOAMI } }),
    "GET /v1/spaces/get": () => ({ body: { data: SPACE } }),
    "GET /v1/spaces/switcher": () => ({ body: { data: { name: "Northwind", kind: "team", role: "Owner", needsYou: 2, unread: 3 } } }),
    ...extra,
  });
}

test("session: opens the Space as the signed-in person and builds the card the shell draws", async () => {
  const gw = sessionGateway();
  const s = await openRealSession({ baseUrl: "http://s.test", token: "vst_1", fetch: gw.fetch, routes: async () => ROUTES, screens: async () => SCREENS, dial: fakeServer().dial, pollMs: 1_000_000 });
  assert.equal(s.me.id, "usr_irfad");
  assert.equal(s.runtime.me.name, "Irfad Imtiaz");
  assert.equal(s.def.spaceId, "spc_nw");
  assert.equal(s.def.name, "Northwind");
  assert.equal(s.def.role, "Owner");
  assert.equal(s.def.needsYou, true);
  assert.equal(s.def.console, true);
  assert.deepEqual(s.def.counts, { chats: 3 });
  assert.equal(s.runtime.space.kind, "team");
  assert.equal(gw.seen[0]!.headers["authorization"], "Bearer vst_1");
  s.close();
});

test("session: a place's screen query reads the Space, and a successful call re-reads it", async () => {
  let names = ["a.docx"];
  const gw = sessionGateway({
    "GET /v1/files/list": () => ({ body: { data: { items: names.map((name) => ({ name })) } } }),
    "POST /v1/files/rename": () => { names = ["b.docx"]; return { body: { data: { ok: true } } }; },
  });
  const s = await openRealSession({ baseUrl: "http://s.test", token: "t", fetch: gw.fetch, routes: async () => ROUTES, screens: async () => SCREENS, dial: fakeServer().dial, pollMs: 1_000_000 });
  const q = s.runtime.screens.query("files.list", "items", { folder: "root" });
  q.subscribe(() => undefined);
  await wait(20);
  assert.deepEqual((q.getSnapshot() as { data: unknown }).data, { items: [{ name: "a.docx" }] });
  await s.runtime.call("files.rename", { id: "f1", name: "b.docx" });
  await wait(250);
  assert.deepEqual((q.getSnapshot() as { data: unknown }).data, { items: [{ name: "b.docx" }] });
  s.close();
});

test("session: a 401 on any call ends the session and tells the shell once", async () => {
  let out = 0;
  const gw = sessionGateway({ "POST /v1/files/rename": () => ({ status: 401, body: { error: { code: "auth.unauthenticated", message: "Sign in.", traceId: "t" } } }) });
  const s = await openRealSession({ baseUrl: "http://s.test", token: "t", fetch: gw.fetch, routes: async () => ROUTES, screens: async () => SCREENS, dial: fakeServer().dial, onSignedOut: () => { out++; }, pollMs: 1_000_000 });
  await assert.rejects(s.runtime.call("files.rename", {}), CapError);
  await assert.rejects(s.runtime.call("files.rename", {}), CapError);
  assert.equal(out, 1);
  s.close();
});

test("session: a network failure marks the Space offline for the title bar, and the next answer brings it back", async () => {
  let down = false;
  const gw = sessionGateway({ "GET /v1/files/list": () => ({ body: { data: { items: [] } } }) });
  const flaky = (async (...a: Parameters<typeof fetch>) => { if (down) throw new TypeError("fetch failed"); return gw.fetch(...a); }) as typeof fetch;
  const s = await openRealSession({ baseUrl: "http://s.test", token: "t", fetch: flaky, routes: async () => ROUTES, screens: async () => SCREENS, dial: fakeServer().dial, pollMs: 1_000_000 });
  assert.equal(s.runtime.connection.get(), "online");
  let told = 0;
  s.runtime.connection.subscribe(() => { told++; });
  down = true;
  await assert.rejects(s.runtime.call("files.list", {}));
  assert.equal(s.runtime.connection.get(), "offline");
  down = false;
  await s.runtime.call("files.list", {});
  assert.equal(s.runtime.connection.get(), "online");
  assert.ok(told >= 2);
  s.close();
});

test("session: opening a target maps the screen to its rail place and passes the item in the hash", async () => {
  const gw = sessionGateway();
  const opened: [string, string][] = [];
  const s = await openRealSession({ baseUrl: "http://s.test", token: "t", fetch: gw.fetch, routes: async () => ROUTES, screens: async () => SCREENS, dial: fakeServer().dial, navigate: (p, h) => opened.push([p, h]), pollMs: 1_000_000 });
  s.runtime.open({ screen: "files.list", args: { upload: true } });
  s.runtime.open({ screen: "nowhere.screen" });
  s.runtime.open({ subject: { type: "record", id: "rec_1" } });
  s.runtime.open({ subject: { type: "spaceship", id: "x" } });
  assert.deepEqual(opened, [["files", "screen=files.list&upload=true"], ["records", "subject=record%3Arec_1"]]);
  const shellOpened: string[] = [];
  const s2 = await openRealSession({ baseUrl: "http://s.test", token: "t", fetch: gw.fetch, routes: async () => ROUTES, screens: async () => new Map([["shell.cmdk", { ...SCREENS.get("files.list")!, id: "shell.cmdk", place: "shell" }]]), dial: fakeServer().dial, shell: (sc) => shellOpened.push(sc), pollMs: 1_000_000 });
  s2.runtime.open({ screen: "shell.cmdk" });
  assert.deepEqual(shellOpened, ["shell.cmdk"]);
  s2.close();
  assert.equal(targetHash({ subject: { type: "record", id: "rec_1" } }), "subject=record%3Arec_1");
  s.close();
});

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

test("stored: a session is kept, read back, and cleared; junk reads as no session", () => {
  const store = memoryStore();
  assert.equal(readStored(store), null);
  const def = { spaceId: "spc_nw", name: "Northwind" } as never;
  writeStored({ baseUrl: "http://s.test", token: "t", def, personId: "usr_1" }, store);
  assert.equal(readStored(store)?.token, "t");
  store.setItem("vyre.session.v1", "{not json");
  assert.equal(readStored(store), null);
  writeStored({ baseUrl: "http://s.test", token: "t", def, personId: "usr_1" }, store);
  clearStored(store);
  assert.equal(readStored(store), null);
});

test("stored: the Space address is ?space= when it is a URL, else the page origin", () => {
  assert.equal(spaceAddress({ origin: "http://127.0.0.1:3000", search: "?space=http%3A%2F%2F10.0.0.2%3A7777%2F" }), "http://10.0.0.2:7777");
  assert.equal(spaceAddress({ origin: "https://northwind.vyre.run", search: "" }), "https://northwind.vyre.run");
  assert.equal(spaceAddress({ origin: "https://x.test", search: "?space=javascript:alert(1)" }), "https://x.test");
});

test("hooks: a read that fails leaves the query loading, with the error available to the place that asked", async () => {
  const hooks = createRemoteScreenHooks({ screens: SCREENS, read: async () => { throw new CapError({ code: "validation.not_found", message: "no", traceId: "t", status: 404 }); } });
  const q = hooks.query("files.list", "items");
  let told = 0;
  q.subscribe(() => { told++; });
  assert.equal(hooks.errorFor(q), null);
  await wait();
  assert.equal(q.getSnapshot().status, "loading");
  assert.ok(hooks.errorFor(q) instanceof CapError);
  assert.equal(told, 1, "the listener looked again once");
  hooks.close();
});

test("hooks: pointers outside /state read from the state's own section, so a place hands over its route", async () => {
  const seen: Record<string, unknown>[] = [];
  const screens = new Map<string, ScreenIndexEntry>([["a.canvas", { ...screen({ automation: { cap: "automations.get", input: { automationId: "/route/automationId", q: "/state/q", gone: "/draft/none" }, live: true } }), id: "a.canvas" }]]);
  const hooks = createRemoteScreenHooks({ screens, read: async (_c, input) => { seen.push(input); return {}; } });
  hooks.query("a.canvas", "automation", { q: "x", route: { automationId: "aut_1" } }).subscribe(() => undefined);
  await wait();
  assert.deepEqual(seen, [{ automationId: "aut_1", q: "x" }]);
  hooks.close();
});

test("hooks: prefetch reads a live query once with nobody watching, and the first watcher finds the answer", async () => {
  let reads = 0;
  const hooks = createRemoteScreenHooks({ screens: SCREENS, read: async () => { reads++; return { items: [] }; } });
  hooks.prefetch("files.list", "items", { folder: "root" });
  hooks.prefetch("files.list", "items", { folder: "root" });
  hooks.prefetch("files.list", "once");
  hooks.prefetch("nope", "items");
  await wait();
  assert.equal(reads, 1);
  const q = hooks.query("files.list", "items", { folder: "root" });
  assert.equal(q.getSnapshot().status, "ready", "ready on the first read, no loading frame");
  q.subscribe(() => undefined);
  await wait();
  assert.equal(reads, 1, "watching a warmed query does not read it again");
  hooks.close();
});
