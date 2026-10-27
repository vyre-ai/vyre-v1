// The real session path with no network: a fake gateway behind `fetch`, a fake socket behind the live link. Every claim here is about what a place would see.
import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenIndexEntry } from "../../../../../generated/screens.ts";
import { CapError, createCapCaller, indexByCap, queryString } from "./caps.ts";
import type { RouteRow } from "./caps.ts";
import { memoryLink } from "../../../../../client/src/connection/memory.ts";
import { fakeServer, settle } from "../../../../../client/src/connection/testing.ts";
import { createLiveLink, socketBase, socketPath } from "./live.ts";
import { createRemoteScreenHooks, stableJson } from "./remote-hooks.ts";
import { openRealSession, targetHash } from "./session.ts";
import { clearStored, openVerifiedSession, readStored, signInAndVerify, spaceAddress, verifyStoredSession, writeStored } from "./stored.ts";
import { acceptDesktopJoin, consumeDesktopBootstrap, previewDesktopJoin, redeemDesktopPair, routeDesktopLink } from "./desktop.ts";
import type { DesktopDeepLink } from "../../../../desktop/src/bridge.ts";
import type { KeyValueStore } from "./stored.ts";

const ROUTES: RouteRow[] = [
  { method: "POST", path: "/v1/identity/whoami", cap: "identity.whoami", v: 1 },
  { method: "POST", path: "/v1/identity/sign_in_options", cap: "identity.sign_in_options", v: 1 },
  { method: "POST", path: "/v1/identity/sign_in", cap: "identity.sign_in", v: 1 },
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
  writeStored({ baseUrl: "http://s.test", token: "t", def, personId: "usr_1", marker: "fp" }, store);
  assert.equal(readStored(store)?.token, "t");
  store.setItem("vyre.session.v1", "{not json");
  assert.equal(readStored(store), null);
  writeStored({ baseUrl: "http://s.test", token: "t", def, personId: "usr_1", marker: "fp" }, store);
  clearStored(store);
  assert.equal(readStored(store), null);
});

test("stored: clearing one Space preserves every other saved Space", () => {
  const store = memoryStore();
  const def = { spaceId: "spc_nw", name: "Northwind" } as never;
  const harbor = { ...def, spaceId: "spc_hb", name: "Harbor" };
  writeStored({ baseUrl: "https://northwind.test", token: "nw", def, personId: "usr_1", marker: "northwind-marker" }, store);
  writeStored({ baseUrl: "https://harbor.test", token: "hb", def: harbor, personId: "usr_1", marker: "harbor-marker" }, store);
  clearStored(store, "https://northwind.test");
  assert.equal(readStored(store, "https://northwind.test"), null);
  assert.equal(readStored(store, "https://harbor.test")?.token, "hb");
});

test("the anonymous sign-in route discovers options before normal password sign-in, never spaces.get", async () => {
  const gw = gateway({
    "POST /v1/identity/sign_in_options": (seen) => {
      assert.equal(seen.headers["authorization"], undefined, "options are safe before authentication");
      return { body: { data: { name: "Northwind", fingerprint: "display-only", password: true, github: true, sso: [{ key: "google", title: "Google" }], secondFactorRequired: false } } };
    },
    "POST /v1/identity/sign_in": (seen) => {
      assert.equal(seen.headers["authorization"], undefined);
      return { body: { data: { status: "ok", session: { token: "vst_1" } } } };
    },
    "GET /v1/spaces/get": (seen) => {
      assert.equal(seen.headers["authorization"], "Bearer vst_1", "the Space is read only after authentication");
      return { body: { data: SPACE } };
    },
  });
  const anonymous = createCapCaller({ baseUrl: "https://northwind.test", token: () => null, fetch: gw.fetch, routes: async () => ROUTES });
  const authenticated = createCapCaller({ baseUrl: "https://northwind.test", token: () => "vst_1", fetch: gw.fetch, routes: async () => ROUTES });
  const opened = { def: { spaceId: "spc_nw", name: "Northwind" }, me: { id: "usr_1" }, close: () => undefined } as never;
  const result = await signInAndVerify({
    baseUrl: "https://northwind.test",
    discover: async () => anonymous("identity.sign_in_options", {}) as never,
    signIn: async () => anonymous("identity.sign_in", { username: "dana", password: "harbor-lamp", deviceName: "Web browser", deviceClass: "web" }) as never,
    open: async () => opened,
    getSpace: async () => {
      const space = ((await authenticated("spaces.get", {})) as typeof SPACE).space;
      return { id: space.id, marker: space.fingerprint };
    },
    persist: () => undefined,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(gw.seen.map((s) => s.url), ["/v1/identity/sign_in_options", "/v1/identity/sign_in", "/v1/spaces/get"]);
  assert.equal(result.options.name, "Northwind");
  assert.equal(result.stored?.marker, "ab", "a first sign-in stores the authenticated continuity marker, not the anonymous display value");
});

test("verification persists only after the opened session and authenticated Space IDs agree", async () => {
  const calls: string[] = [];
  const writes: unknown[] = [];
  const real = { def: { spaceId: "spc_nw" }, me: { id: "usr_1" }, close: () => { calls.push("close"); } } as never;
  const stored = await openVerifiedSession({
    baseUrl: "https://northwind.test", token: "vst_1", continuity: { id: "spc_nw", marker: "marker_1" },
    open: async () => { calls.push("open:whoami+spaces.get"); return real; },
    getSpace: async () => { calls.push("get:spaces.get"); return { id: "spc_nw", marker: "marker_1" }; },
    persist: (candidate) => writes.push(candidate),
  });
  assert.deepEqual(calls, ["open:whoami+spaces.get", "get:spaces.get", "close"]);
  assert.equal(writes.length, 1, "storage waits for identity.whoami and both spaces.get checks");
  assert.equal(stored.marker, "marker_1");
});

test("verification never persists when identity.whoami cannot open the real session", async () => {
  let writes = 0;
  await assert.rejects(openVerifiedSession({
    baseUrl: "https://northwind.test", token: "vst_1", continuity: { id: "spc_nw" },
    open: async () => { throw new Error("identity.whoami rejected the session"); },
    getSpace: async () => ({ id: "spc_nw", marker: "marker_1" }),
    persist: () => { writes++; },
  }), /whoami rejected/i);
  assert.equal(writes, 0);
});

test("verification rejects a continuity-marker mismatch without persisting the session", async () => {
  let writes = 0;
  let closed = 0;
  const real = { def: { spaceId: "spc_nw" }, me: { id: "usr_1" }, close: () => { closed++; } } as never;
  await assert.rejects(openVerifiedSession({
    baseUrl: "https://northwind.test", token: "vst_1", continuity: { id: "spc_nw", marker: "marker_expected" },
    open: async () => real,
    getSpace: async () => ({ id: "spc_nw", marker: "marker_other" }),
    persist: () => { writes++; },
  }), /no longer matches/i);
  assert.deepEqual([writes, closed], [0, 1]);
});

test("a returning session rejects a changed continuity marker and closes before shell use", async () => {
  let closed = 0;
  const stored = { baseUrl: "https://northwind.test", token: "vst_1", def: { spaceId: "spc_nw", name: "Northwind" } as never, personId: "usr_1", marker: "marker_saved" };
  await assert.rejects(verifyStoredSession({
    stored,
    open: async () => ({ def: stored.def, me: { id: "usr_1" }, close: () => { closed++; } }),
    getSpace: async () => ({ id: "spc_nw", marker: "marker_changed" }),
  }), /no longer matches/i);
  assert.equal(closed, 1);
});

test("verification blocks persistence when authenticated Space IDs differ", async () => {
  let writes = 0;
  await assert.rejects(openVerifiedSession({
    baseUrl: "https://northwind.test", token: "vst_1",
    open: async () => ({ def: { spaceId: "spc_nw" }, me: { id: "usr_1" }, close: () => undefined } as never),
    getSpace: async () => ({ id: "spc_other", marker: "marker_1" }),
    persist: () => { writes++; },
  }), /no longer matches/i);
  assert.equal(writes, 0);
});

test("stored: the Space address is HTTP(S), never the packaged shell origin", () => {
  assert.equal(spaceAddress({ origin: "http://127.0.0.1:3000", search: "?space=http%3A%2F%2F10.0.0.2%3A7777%2F" }), "http://10.0.0.2:7777");
  assert.equal(spaceAddress({ origin: "https://northwind.vyre.run", search: "" }), "https://northwind.vyre.run");
  assert.equal(spaceAddress({ origin: "https://x.test", search: "?space=javascript:alert(1)" }), "https://x.test");
  assert.equal(spaceAddress({ origin: "tauri://localhost", search: "" }), null);
  assert.equal(spaceAddress({ origin: "tauri://localhost", search: "?space=tauri%3A%2F%2Flocalhost" }), null);
});
test("desktop bootstrap routes its pending link before live links and unsubscribes safely", async () => {
  let live: ((link: DesktopDeepLink) => void) | undefined;
  let unlistened = 0;
  const seen: unknown[] = [];
  const stop = await consumeDesktopBootstrap({
    bootstrap: async () => ({ info: {} as never, pendingLink: { action: "join", params: { address: "https://northwind.vyre.run", code: "one-time-code", fp: "ab12" } } }),
    listenLinks: async (listener) => { live = listener; return () => { unlistened++; }; },
  }, (route) => seen.push(route));
  live?.({ action: "signin", params: { address: "https://northwind.vyre.run" } });
  assert.deepEqual(seen, [
    { kind: "join", address: "https://northwind.vyre.run", code: "one-time-code", fingerprint: "ab12" },
    { kind: "signin", address: "https://northwind.vyre.run" },
  ]);
  stop();
  stop();
  assert.equal(unlistened, 1);
});

test("desktop links only route verified Space addresses into the existing flows", () => {
  assert.deepEqual(routeDesktopLink({ action: "open", params: { address: "http://127.0.0.1:7777" } }), { kind: "signin", address: "http://127.0.0.1:7777" });
  assert.deepEqual(routeDesktopLink({ action: "pair", params: { address: "https://northwind.vyre.run", code: "pairing-code" } }), { kind: "pair", address: "https://northwind.vyre.run", code: "pairing-code" });
  assert.equal(routeDesktopLink({ action: "join", params: { address: "http://127.0.0.1:7777", code: "one-time-code", fp: "ab12" } }), null, "join links require HTTPS");
  assert.equal(routeDesktopLink({ action: "join", params: { address: "https://northwind.vyre.run", code: "", fp: "ab12" } }), null);
  assert.equal(routeDesktopLink({ action: "signin", params: { address: "tauri://localhost" } }), null);
});

test("desktop pairing redeems anonymously, verifies the Space, then persists without key ciphertext", async () => {
  const route = routeDesktopLink({ action: "pair", params: { address: "https://northwind.vyre.run", code: "pair-code" } });
  assert.ok(route && route.kind === "pair");
  const calls: { cap: string; input: unknown }[] = [];
  let persisted: unknown;
  const stored = await redeemDesktopPair(route, {
    anonymous: async (cap, input) => { calls.push({ cap, input }); return { status: "ok", session: { token: "vst_pair", epoch: 4 }, keys: { privateKeyWrapped: "ciphertext" } }; },
    open: async (token) => ({ def: { spaceId: "spc_nw", name: "Northwind" }, me: { id: "usr_1" }, close: () => undefined, token } as never),
    getSpace: async () => ({ id: "spc_nw", marker: "current-display-marker" }),
    persist: (s) => { persisted = s; },
  });
  assert.deepEqual(calls, [{ cap: "identity.pair_redeem", input: { code: "pair-code", deviceName: "Vyre desktop", deviceClass: "desktop" } }]);
  assert.deepEqual(stored, { baseUrl: "https://northwind.vyre.run", token: "vst_pair", def: { spaceId: "spc_nw", name: "Northwind" }, personId: "usr_1", marker: "current-display-marker", syncEpoch: 4 });
  assert.deepEqual(persisted, stored);
  assert.equal("keys" in stored, false, "pairing ciphertext never reaches ordinary session storage");
});

test("desktop joining previews first and accepts with a real Space-key bundle", async () => {
  const route = routeDesktopLink({ action: "join", params: { address: "https://northwind.vyre.run", code: "invite-code", fp: "untrusted-link-display" } });
  assert.ok(route && route.kind === "join");
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const anonymous = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "members.invites.preview") return { spaceId: "spc_nw", spaceName: "Northwind", invitedBy: "Maya", role: "Member", expiresAt: 1, fingerprint: "server-display-marker" };
    return { status: "ok", session: { token: "vst_join", epoch: 2 } };
  };
  const invite = await previewDesktopJoin(route, anonymous);
  const stored = await acceptDesktopJoin(invite, { username: "dana", displayName: "Dana", password: "a good password", deviceName: "Dana's Mac", trustDevice: true, ai: { choice: "none" } }, {
    anonymous,
    open: async () => ({ def: { spaceId: "spc_nw", name: "Northwind" }, me: { id: "usr_dana" }, close: () => undefined } as never),
    getSpace: async () => ({ id: "spc_nw", marker: "authenticated-marker" }),
    persist: () => undefined,
  });
  assert.equal(invite.preview.fingerprint, "server-display-marker", "the link fingerprint is never a trust pin");
  const accept = calls.find((c) => c.cap === "invites.accept_create_account")!;
  assert.equal(accept.input["code"], "invite-code");
  assert.equal((accept.input["keys"] as { spaceKeys: unknown[] }).spaceKeys.length, 1);
  assert.equal("personKey" in (accept.input["keys"] as object), false, "only wrapped key material leaves the client");
  assert.equal(stored.marker, "authenticated-marker");
});

test("desktop joining never persists when the post-accept authenticated Space differs from the preview", async () => {
  const route = routeDesktopLink({ action: "join", params: { address: "https://northwind.vyre.run", code: "invite-code", fp: "display-only" } });
  assert.ok(route && route.kind === "join");
  const invite = await previewDesktopJoin(route, async () => ({ spaceId: "spc_preview", spaceName: "Northwind", invitedBy: "Maya", role: "Member", expiresAt: 1, fingerprint: "server-display-marker" }));
  let writes = 0;
  await assert.rejects(acceptDesktopJoin(invite, { username: "dana", displayName: "Dana", password: "a good password", deviceName: "Dana's Mac", trustDevice: true, ai: { choice: "none" } }, {
    anonymous: async () => ({ status: "ok", session: { token: "vst_join" } }),
    open: async () => ({ def: { spaceId: "spc_authenticated", name: "Elsewhere" }, me: { id: "usr_dana" }, close: () => undefined } as never),
    getSpace: async () => ({ id: "spc_authenticated", marker: "authenticated-marker" }),
    persist: () => { writes++; },
  }), /Space no longer matches/);
  assert.equal(writes, 0);
});

test("desktop pair and invite failures redact one-time codes", async () => {
  const pair = routeDesktopLink({ action: "pair", params: { address: "https://northwind.vyre.run", code: "pair-secret" } });
  const join = routeDesktopLink({ action: "join", params: { address: "https://northwind.vyre.run", code: "invite-secret", fp: "display-only" } });
  assert.ok(pair && pair.kind === "pair");
  assert.ok(join && join.kind === "join");
  await assert.rejects(redeemDesktopPair(pair, {
    anonymous: async () => { throw new Error("pair-secret was refused"); },
    open: async () => { throw new Error("not reached"); }, getSpace: async () => ({ id: "", marker: "" }),
  }), (error: unknown) => error instanceof Error && !error.message.includes("pair-secret"));
  await assert.rejects(previewDesktopJoin(join, async () => { throw new Error("invite-secret was refused"); }), (error: unknown) => error instanceof Error && !error.message.includes("invite-secret"));
});

test("hooks: a read that fails leaves the query loading, with the error available to the place that asked", async () => {
  const hooks = createRemoteScreenHooks({ screens: SCREENS, read: async () => { throw new CapError({ code: "validation.not_found", message: "no", traceId: "t", status: 404 }); } });
  const q = hooks.query("files.list", "items");
  let told = 0;
  q.subscribe(() => { told++; });
  assert.equal((q.getSnapshot() as { error?: unknown }).error, undefined);
  await wait();
  const snap = q.getSnapshot() as { status: string; error?: { code?: string; message?: string; traceId?: string } };
  assert.equal(snap.status, "loading");
  assert.deepEqual(snap.error, { message: "no", code: "validation.not_found", traceId: "t" });
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

/** A server with its own sync epoch: a hello with a lower epoch is answered purge (what sync's decideMode does), anything else live. Records each hello's epoch. */
function epochServer(serverEpoch: number): { dial: Parameters<typeof createLiveLink>[0]["dial"]; hellos: number[] } {
  const hellos: number[] = [];
  const dial: NonNullable<Parameters<typeof createLiveLink>[0]["dial"]> = async () => {
    const link = memoryLink();
    link.server.onFrame((f) => {
      const h = (f as { t?: string; hello?: { epoch: number } });
      if (h.t === "hello" && h.hello) {
        hellos.push(h.hello.epoch);
        link.server.send({ t: "hello_ok", ok: { serverVersion: "t", epoch: serverEpoch, serverHlc: "000000000001-0000-srv", mode: h.hello.epoch < serverEpoch ? "purge" : "live", head: 0, entityVersions: {} } });
      }
    });
    return link.client;
  };
  return { dial, hellos };
}

test("live: a fresh sign-in is never purged for a stale epoch: it adopts the server's sync epoch, says hello again and reaches live", async () => {
  const srv = epochServer(7);
  let purged = 0;
  const adopted: number[] = [];
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "t", deviceId: "dev_new", registryHash: "h", onChange: () => undefined, onPurge: () => { purged++; }, onEpoch: (e) => adopted.push(e), dial: srv.dial });
  link.start();
  await settle(30);
  assert.equal(purged, 0, "no wipe, no sign-out for a device that has nothing local");
  assert.deepEqual(adopted, [7]);
  assert.deepEqual(srv.hellos, [0, 7], "hello with no epoch, then again with the server's");
  assert.equal(link.status(), "live");
  link.stop();
});

test("live: a device that agreed an epoch before and is now behind it (revoked, bumped) is still purged", async () => {
  const srv = epochServer(9);
  let purged: number[] = [];
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "t", deviceId: "dev_old", epoch: 4, registryHash: "h", onChange: () => undefined, onPurge: (e) => { purged = [...purged, e]; }, onEpoch: () => { throw new Error("a known device never adopts"); }, dial: srv.dial });
  link.start();
  await settle(30);
  assert.deepEqual(purged, [9]);
  assert.deepEqual(srv.hellos, [4], "no second hello");
  link.stop();
});

test("live: a device that agreed the current epoch reaches live with no purge", async () => {
  const srv = epochServer(5);
  let purged = 0;
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "t", deviceId: "d", epoch: 5, registryHash: "h", onChange: () => undefined, onPurge: () => { purged++; }, dial: srv.dial });
  link.start();
  await settle(30);
  assert.equal(purged, 0);
  assert.equal(link.status(), "live");
  link.stop();
});

test("live: a device with no agreed epoch but something stored locally is purged for real: no adopting, no second hello", async () => {
  const srv = epochServer(7);
  let purged: number[] = [];
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "t", deviceId: "dev_data", registryHash: "h", hasLocalData: () => true, onChange: () => undefined, onPurge: (e) => { purged = [...purged, e]; }, onEpoch: () => { throw new Error("a device with local data never adopts"); }, dial: srv.dial });
  link.start();
  await settle(30);
  assert.deepEqual(purged, [7]);
  assert.deepEqual(srv.hellos, [0], "one hello, no retry");
  link.stop();
});

test("live: adoption happens once per session: a second purge answer after adopting is a real purge", async () => {
  let n = 0;
  const hellos: number[] = [];
  const dial: NonNullable<Parameters<typeof createLiveLink>[0]["dial"]> = async () => {
    const link = memoryLink();
    link.server.onFrame((f) => {
      const h = (f as { t?: string; hello?: { epoch: number } });
      if (h.t === "hello" && h.hello) { hellos.push(h.hello.epoch); n++; link.server.send({ t: "hello_ok", ok: { serverVersion: "t", epoch: 10 + n, serverHlc: "000000000001-0000-srv", mode: "purge", head: 0, entityVersions: {} } }); }
    });
    return link.client;
  };
  let purged: number[] = [];
  const link = createLiveLink({ baseUrl: "https://s.test", token: () => "t", deviceId: "d", registryHash: "h", onChange: () => undefined, onPurge: (e) => { purged = [...purged, e]; }, dial });
  link.start();
  await settle(40);
  assert.deepEqual(hellos, [0, 11], "adopted once");
  assert.deepEqual(purged, [12], "the server moved the epoch again: real purge");
  link.stop();
});

test("hooks: a read that fails the same way again keeps the same snapshot and does not tell the listener again", async () => {
  const hooks = createRemoteScreenHooks({ screens: SCREENS, read: async () => { throw new CapError({ code: "validation.bad_input", message: "bad", traceId: `t${Math.random()}`, status: 422 }); } });
  const q = hooks.query("files.list", "items");
  let told = 0;
  q.subscribe(() => { told++; });
  await wait();
  const first = q.getSnapshot();
  hooks.invalidate();
  await wait();
  hooks.invalidate();
  await wait();
  assert.equal(q.getSnapshot(), first, "same failure, same snapshot object, whatever the trace id");
  assert.equal(told, 1);
  hooks.close();
});

test("session: after a 401 the session makes no further calls to the Space, and a 401 never becomes a failure a screen reacts to", async () => {
  let out = 0;
  let renameCalls = 0;
  const gw = sessionGateway({
    "GET /v1/files/list": () => ({ status: 401, body: { error: { code: "auth.unauthenticated", message: "Sign in.", traceId: "t" } } }),
    "POST /v1/files/rename": () => { renameCalls++; return { body: { data: { ok: true } } }; },
  });
  const s = await openRealSession({ baseUrl: "http://s.test", token: "t", fetch: gw.fetch, routes: async () => ROUTES, screens: async () => SCREENS, dial: fakeServer().dial, onSignedOut: () => { out++; }, pollMs: 1_000_000 });
  const q = s.runtime.screens.query("files.list", "items", { folder: "root" });
  let told = 0;
  q.subscribe(() => { told++; });
  await wait(30);
  assert.equal(out, 1, "signed out once");
  assert.equal(told, 0, "the listener was not told of a failure");
  assert.equal(q.getSnapshot().status, "loading");
  assert.deepEqual((q.getSnapshot() as { error?: unknown }).error, undefined);
  await assert.rejects(s.runtime.call("files.rename", {}), (e: unknown) => e instanceof CapError && e.status === 401);
  assert.equal(renameCalls, 0, "no call reaches the Space after the session ended");
  s.close();
});
