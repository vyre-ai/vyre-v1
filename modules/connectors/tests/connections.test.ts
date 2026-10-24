// @reads /modules/connectors/migrations/0001_connectors.sql
// Connections: owner, pause, Pending, OAuth sign-in, probes; and the replay harness that drives recorded responses through the same path a live call takes.
import test from "node:test";
import assert from "node:assert/strict";
import { ACME, OAUTHAPP } from "../fixtures/acme.ts";
import { NOW, kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";
import type { ConnectorDef } from "../projections.ts";

const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};
const SECRET = "sk_live_SECRET123";
const KEYS = { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" };
const create = (k: Kit, extra: Record<string, unknown> = {}) =>
  k.hs["connections.create"](k.ctx, { connector: "acme", title: "Acme", ownerKind: "space", secrets: KEYS, ...extra } as never);
const noRate: ConnectorDef = { ...ACME, rate: undefined };

test("a connection starts Pending where the sign-in or consent is still to come", async () => {
  const k = kit();
  k.install({ ...ACME, key: "hookonly", mode: "webhook_only", secrets: [], auth: { type: "none" }, actions: [], health: undefined, tests: [] });
  k.install({ ...ACME, key: "admin", mode: "dwd" });
  k.install({ ...ACME, key: "tools", mode: "mcp" });
  k.install(ACME);
  k.install(OAUTHAPP);
  const state = async (connector: string, extra: Record<string, unknown> = {}) =>
    (await k.hs["connections.create"](k.ctx, { connector, title: connector, ownerKind: connector === "oauthapp" ? "person" : "space", ...extra } as never)).connection.state;
  assert.equal(await state("hookonly"), "active");
  assert.equal(await state("acme", { secrets: KEYS }), "active", "an api key connector with every secret named is usable");
  assert.equal(await state("acme", { secrets: { Acme_Key: "#AcmeKey" } }), "pending", "one secret is missing");
  assert.equal(await state("acme"), "pending");
  assert.equal(await state("admin", { secrets: KEYS }), "pending", "waits for the admin to authorize");
  assert.equal(await state("tools", { secrets: KEYS }), "pending");
  assert.equal(await state("oauthapp"), "pending", "waits for the sign-in");
});

test("create: owner, scope, secret names; events", async () => {
  const k = kit();
  k.install(ACME);
  k.install({ ...ACME, key: "mine", scope: "person", title: "Mine" });
  const made = await create(k);
  assert.deepEqual(made.connection.owner, { kind: "space", id: "space" });
  assert.equal(made.connection.createdAt, NOW);
  assert.equal(made.authUrl, undefined);
  assert.deepEqual(k.events2("connection.created"), [{ connectionId: made.connection.connectionId, connector: "acme", ownerKind: "space" }]);
  const person = await k.hs["connections.create"](k.ctx, { connector: "mine", title: "Mine", ownerKind: "person", secrets: KEYS });
  assert.deepEqual(person.connection.owner, { kind: "person", id: "usr_dana" });

  await assert.rejects(create(k, { ownerKind: "person" }), code("validation.precondition_failed"));
  await assert.rejects(k.hs["connections.create"](k.ctx, { connector: "mine", title: "x", ownerKind: "space" }), code("validation.precondition_failed"));
  await assert.rejects(create(k, { connector: "nope" }), code("validation.not_found"));
  await assert.rejects(create(k, { title: " " }), code("validation.bad_input"));
  await assert.rejects(create(k, { secrets: { Nope: "#AcmeKey" } }), code("validation.bad_input"));
  await assert.rejects(create(k, { secrets: { Acme_Key: SECRET } }), (e: unknown) => /name of a Vault item such as #Name, not a value/.test((e as Error).message));
  assert.equal(JSON.stringify(k.tx.all("SELECT * FROM cn_connections")).includes(SECRET), false);
});

test("visibility: your own connections and the Space's, nobody else's", async () => {
  const k = kit();
  k.install(ACME);
  k.install({ ...ACME, key: "mine", scope: "person", title: "Mine" });
  const bo = k.mk("usr_bo");
  const space = (await create(k)).connection;
  const dana = (await k.hs["connections.create"](k.ctx, { connector: "mine", title: "Dana's", ownerKind: "person", secrets: KEYS })).connection;
  const boConn = (await k.hs["connections.create"](bo, { connector: "mine", title: "Bo's", ownerKind: "person", secrets: KEYS })).connection;
  const ids = async (ctx: typeof k.ctx, input: Record<string, unknown> = {}) => (await k.hs["connections.list"](ctx, input as never)).connections.map((c) => c.connectionId).sort();
  assert.deepEqual(await ids(k.ctx), [space.connectionId, dana.connectionId].sort());
  assert.deepEqual(await ids(k.ctx, { whose: "mine" }), [dana.connectionId]);
  assert.deepEqual(await ids(k.ctx, { whose: "space" }), [space.connectionId]);
  assert.deepEqual(await ids(bo), [space.connectionId, boConn.connectionId].sort());
  assert.deepEqual(await ids(k.ctx, { connector: "mine" }), [dana.connectionId]);
  await assert.rejects(k.hs["connections.get"](k.ctx, { connectionId: boConn.connectionId }), code("validation.not_found"));
  await assert.rejects(k.hs["connections.pause"](k.ctx, { connectionId: boConn.connectionId }), code("validation.not_found"));
  await assert.rejects(k.hs["connections.delete"](k.ctx, { connectionId: boConn.connectionId }), code("validation.not_found"));
  assert.equal((await k.hs["connections.get"](bo, { connectionId: space.connectionId })).connection.title, "Acme");
  const page = await k.hs["connections.list"](k.ctx, { limit: 1 });
  assert.deepEqual([page.connections.length, page.total, page.next], [1, 2, "1"]);
});

test("the owner pauses and resumes; a paused connection remembers what it was", async () => {
  const k = kit();
  k.install(ACME);
  const active = (await create(k)).connection.connectionId;
  const pending = (await create(k, { title: "Pending", secrets: {} })).connection.connectionId;
  k.events.length = 0;
  await k.hs["connections.pause"](k.ctx, { connectionId: active });
  await k.hs["connections.pause"](k.ctx, { connectionId: active });
  assert.deepEqual(k.events2("connection.paused"), [{ connectionId: active }], "pausing twice is one pause");
  const paused = (await k.hs["connections.get"](k.ctx, { connectionId: active })).connection;
  assert.deepEqual([paused.state, paused.pausedBy], ["paused", "usr_dana"]);
  await k.hs["connections.resume"](k.ctx, { connectionId: active });
  assert.deepEqual([(await k.hs["connections.get"](k.ctx, { connectionId: active })).connection.state, k.events2("connection.resumed").length], ["active", 1]);
  await k.hs["connections.resume"](k.ctx, { connectionId: active });
  assert.equal(k.events2("connection.resumed").length, 1);

  await k.hs["connections.pause"](k.ctx, { connectionId: pending });
  await k.hs["connections.resume"](k.ctx, { connectionId: pending });
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: pending })).connection.state, "pending", "pausing does not make a pending connection usable");

  const upd = (await k.hs["connections.update"](k.ctx, { connectionId: active, title: "Renamed", scopes: ["contacts.read"] })).connection;
  assert.deepEqual([upd.title, upd.scopes], ["Renamed", ["contacts.read"]]);
  assert.deepEqual((await k.hs["connections.update"](k.ctx, { connectionId: active, title: "Again" })).connection.scopes, ["contacts.read"]);
  await assert.rejects(k.hs["connections.update"](k.ctx, { connectionId: active, title: " " }), code("validation.bad_input"));

  k.events.length = 0;
  assert.deepEqual(await k.hs["connections.delete"](k.ctx, { connectionId: active }), { deleted: true });
  assert.deepEqual(k.events2("connection.deleted"), [{ connectionId: active, connector: "acme" }]);
  await assert.rejects(k.hs["connections.get"](k.ctx, { connectionId: active }), code("validation.not_found"));
});

test("a probe makes a pending connection active, and reports what went wrong", async () => {
  const k = kit();
  k.install(noRate);
  const id = (await create(k, { secrets: { Acme_Key: "#AcmeKey" } })).connection.connectionId;
  const stateOf = async () => (await k.hs["connections.get"](k.ctx, { connectionId: id })).connection.state;
  assert.equal(await stateOf(), "pending");
  k.state.reply = () => { k.clock.t += 40; return { status: 200, body: { ok: true } }; };
  assert.deepEqual(await k.hs["connections.test"](k.ctx, { connectionId: id }), { state: "healthy", latencyMs: 40 });
  assert.equal(await stateOf(), "active", "the first good answer");
  assert.equal(k.sent[0]!.headers["X-Api-Key"], SECRET);

  k.state.reply = () => ({ status: 503 });
  const down = await k.hs["connections.test"](k.ctx, { connectionId: id });
  assert.deepEqual([down.state, await stateOf()], ["down", "failing"]);
  assert.match(down.detail!, /503/);
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  assert.equal((await k.hs["connections.test"](k.ctx, { connectionId: id })).state, "healthy");
  assert.equal(await stateOf(), "active", "failing clears with a good answer");

  k.state.reply = () => ({ status: 429 });
  assert.equal((await k.hs["connections.test"](k.ctx, { connectionId: id })).state, "degraded");
  assert.equal(await stateOf(), "active", "rate limited is not broken");
  k.state.reply = () => new Error("ECONNREFUSED");
  assert.equal((await k.hs["connections.test"](k.ctx, { connectionId: id })).state, "down");
  assert.equal(await stateOf(), "failing");

  k.events.length = 0;
  k.state.reply = () => ({ status: 401 });
  const rejected = await k.hs["connections.test"](k.ctx, { connectionId: id });
  assert.deepEqual([rejected.state, rejected.detail], ["down", "The app rejected the key or sign-in."]);
  assert.equal(await stateOf(), "needs_reconnect");
  assert.equal(k.events2("connection.needs_reconnect").length, 1);
  const again = await k.hs["connections.test"](k.ctx, { connectionId: id });
  assert.equal(again.state, "down", "a connection waiting for a sign-in is not probed");

  // Reconnect without a provider sign-in: back to Pending, the person fixes the Vault item, the next probe activates it.
  assert.deepEqual(await k.hs["connections.reconnect"](k.ctx, { connectionId: id }), {});
  assert.equal(await stateOf(), "pending");
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  assert.equal((await k.hs["connections.test"](k.ctx, { connectionId: id })).state, "healthy");
  assert.equal(await stateOf(), "active");

  await k.hs["connections.pause"](k.ctx, { connectionId: id });
  const before = k.sent.length;
  assert.deepEqual(await k.hs["connections.test"](k.ctx, { connectionId: id }), { state: "down", detail: "Paused by usr_dana." });
  assert.equal(k.sent.length, before);

  k.install({ ...noRate, key: "nohealth", health: undefined });
  const nh = (await k.hs["connections.create"](k.ctx, { connector: "nohealth", title: "nh", ownerKind: "space", secrets: KEYS })).connection.connectionId;
  assert.equal((await k.hs["connections.test"](k.ctx, { connectionId: nh })).state, "healthy");
});

test("OAuth: the sign-in address, the code exchange, tokens in the Vault and only their names here", async () => {
  const k = kit();
  k.install(OAUTHAPP);
  k.vault["#AppClientSecret"] = "client-secret-VALUE";
  const made = await k.hs["connections.create"](k.ctx, { connector: "oauthapp", title: "My app", ownerKind: "person", secrets: { App_ClientSecret: "#AppClientSecret" } });
  assert.equal(made.connection.state, "pending");
  assert.deepEqual(k.events2("connection.created"), [], "made when the sign-in comes back");
  const url = new URL(made.authUrl!);
  assert.equal(`${url.origin}${url.pathname}`, "https://login.oauthapp.test/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://acme.vyre.run/oauth/callback");
  assert.equal(url.searchParams.get("scope"), "read write");
  const state = url.searchParams.get("state")!;
  assert.match(state, /^oas_[a-z0-9]+$/);

  k.state.reply = (req) => {
    if (req.url === "https://login.oauthapp.test/token") return { status: 200, body: { access_token: "at_ACCESSTOKEN9", refresh_token: "rt_REFRESH999" } };
    return { status: 200, body: { user: { name: "Dana" } } };
  };
  const done = await k.hs["connections.complete_auth"](k.ctx, { state, code: "code-ABCDEF" });
  assert.equal(done.connectionId, made.connection.connectionId);
  const req = k.sent[0]!;
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(req.body);
  assert.deepEqual([form.get("grant_type"), form.get("code"), form.get("client_id"), form.get("client_secret"), form.get("redirect_uri")], ["authorization_code", "code-ABCDEF", "client-123", "client-secret-VALUE", "https://acme.vyre.run/oauth/callback"]);
  assert.deepEqual(k.stored.map((s) => s.value), ["at_ACCESSTOKEN9", "rt_REFRESH999"]);
  const conn = (await k.hs["connections.get"](k.ctx, { connectionId: done.connectionId })).connection;
  assert.equal(conn.state, "active");
  assert.deepEqual(k.events2("connection.created"), [{ connectionId: done.connectionId, connector: "oauthapp", ownerKind: "person" }]);
  assert.deepEqual(k.events2("connection.reconnected"), []);
  const dump = JSON.stringify([k.tx.all("SELECT * FROM cn_connections"), k.tx.all("SELECT * FROM cn_oauth"), k.events, k.logs]);
  for (const v of ["at_ACCESSTOKEN9", "rt_REFRESH999", "client-secret-VALUE", "code-ABCDEF"]) assert.equal(dump.includes(v), false, `${v} is not stored here`);
  const names = JSON.parse(k.tx.get<{ secrets: string }>("SELECT secrets FROM cn_connections")!.secrets) as Record<string, string>;
  assert.deepEqual(Object.keys(names).sort(), ["App_ClientSecret", "App_Token", "App_Token_refresh"]);

  // the token is used as a bearer, and a probe works
  k.sent.length = 0;
  assert.equal((await k.hs["connections.test"](k.ctx, { connectionId: done.connectionId })).state, "healthy");
  assert.equal(k.sent[0]!.headers["Authorization"], "Bearer at_ACCESSTOKEN9");

  // the state is single use
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state, code: "again" }), code("auth.invalid_code"));
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: "oas_unknown", code: "x" }), code("auth.invalid_code"));

  // sign in again after the app rejected the token
  k.state.reply = () => ({ status: 401 });
  await k.hs["connections.test"](k.ctx, { connectionId: done.connectionId });
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: done.connectionId })).connection.state, "needs_reconnect");
  const re = await k.hs["connections.reconnect"](k.ctx, { connectionId: done.connectionId });
  const state2 = new URL(re.authUrl!).searchParams.get("state")!;
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: done.connectionId })).connection.state, "pending");
  k.state.reply = () => ({ status: 200, body: { access_token: "at_SECOND_TOKEN" } });
  await k.hs["connections.complete_auth"](k.ctx, { state: state2, code: "c2" });
  assert.deepEqual(k.events2("connection.reconnected"), [{ connectionId: done.connectionId }]);
  assert.equal(k.events2("connection.created").length, 1);
});

test("OAuth: expired, refused, unreachable and broken token exchanges", async () => {
  const k = kit();
  k.install(OAUTHAPP);
  k.vault["#AppClientSecret"] = "client-secret-VALUE";
  const start = async () => {
    const made = await k.hs["connections.create"](k.ctx, { connector: "oauthapp", title: "My app", ownerKind: "person", secrets: { App_ClientSecret: "#AppClientSecret" } });
    return new URL(made.authUrl!).searchParams.get("state")!;
  };
  let s = await start();
  k.clock.t += 11 * 60_000;
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s, code: "x" }), (e: unknown) => /expired/.test((e as Error).message));
  k.clock.t = NOW;

  s = await start();
  k.state.reply = () => ({ status: 400, body: { error: "invalid_grant client-secret-VALUE" } });
  const refused = await k.hs["connections.complete_auth"](k.ctx, { state: s, code: "bad-CODE1" }).catch((e: unknown) => e);
  assert.equal((refused as { error: { code: string } }).error.code, "provider.auth_failed");
  s = await start();
  k.state.reply = () => new Error("ECONNRESET with client-secret-VALUE and bad-CODE2");
  const net = await k.hs["connections.complete_auth"](k.ctx, { state: s, code: "bad-CODE2" }).catch((e: unknown) => e);
  assert.equal((net as { error: { code: string } }).error.code, "provider.network");
  assert.equal(JSON.stringify([refused, net]).includes("client-secret-VALUE"), false);
  assert.equal(JSON.stringify([refused, net]).includes("bad-CODE2"), false);
  s = await start();
  k.state.reply = () => ({ status: 200, body: "not json" });
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s, code: "c" }), code("provider.bad_response"));
  s = await start();
  k.state.reply = () => ({ status: 200, body: { nothing: true } });
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s, code: "c" }), code("provider.bad_response"));
  assert.equal(k.stored.length, 0, "nothing was kept");

  // a sign-in address or token address outside the connector's domains is refused
  k.install({ ...OAUTHAPP, auth: { ...OAUTHAPP.auth, tokenUrl: "https://evil.example.com/token" } });
  s = await start();
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s, code: "c" }), code("permission.no_grant"));
  k.install({ ...OAUTHAPP, auth: { ...OAUTHAPP.auth, authUrl: "https://evil.example.com/authorize" } });
  await assert.rejects(k.hs["connections.create"](k.ctx, { connector: "oauthapp", title: "x", ownerKind: "person" }), code("permission.no_grant"));
});

// ---- the replay harness ----

test("the replay harness drives a recorded response set through the live path", async () => {
  const k = kit();
  k.install(ACME);
  const res = (await k.hs["connectors.test"](k.ctx, { key: "acme" })).result;
  assert.equal(res.failed, 0, JSON.stringify(res.cases.filter((c) => !c.ok)));
  assert.equal(res.passed, 8);
  assert.deepEqual(res.cases.map((c) => c.name).slice(0, 3), ["egress: every action stays inside the declared domains", "secrets: every secret an action reads is declared", "health: the health action exists"]);
  assert.deepEqual(res.cases.slice(3).map((c) => c.name), ACME.tests!.map((t) => t.name));
  assert.equal(k.sent.length, 0, "the harness sends nothing");
  assert.equal(k.tx.all("SELECT * FROM cn_log").length, 0, "and logs nothing");
  assert.equal(k.tx.all("SELECT * FROM cn_connections").length, 0, "and needs no connection");
});

test("the harness fails a case that does not match its recording", async () => {
  const k = kit();
  const ping = (extra: Record<string, unknown>) => ({ name: "t", action: "ping", responses: [{ url: "https://api.acme.test/v1/ping", body: { ok: true } }], ...extra });
  const failing = async (t: unknown): Promise<string> => {
    k.install({ ...ACME, tests: [t as never] });
    const cases = (await k.hs["connectors.test"](k.ctx, { key: "acme" })).result.cases;
    const c = cases.find((x) => x.name === "t")!;
    assert.equal(c.ok, false);
    return c.message!;
  };
  assert.match(await failing(ping({ expect: { output: false } })), /output differs: got true/);
  assert.match(await failing(ping({ responses: [] })), /no recorded response for GET https:\/\/api\.acme\.test\/v1\/ping/);
  assert.match(await failing(ping({ responses: [{ method: "POST", url: "https://api.acme.test/v1/ping" }] })), /no recorded response for GET/);
  assert.match(await failing(ping({ expect: { requests: 3 } })), /expected 3 requests, made 1/);
  assert.match(await failing(ping({ expect: { error: "provider.auth_failed" } })), /expected the error provider\.auth_failed, got an output/);
  assert.match(await failing(ping({ responses: [{ url: "https://api.acme.test/v1/ping", status: 500 }] })), /provider\.unavailable/);
  assert.match(await failing(ping({ action: "nope" })), /validation\.bad_input.*no action nope/);
  k.install({ ...ACME, tests: [ping({ responses: [{ url: "https://api.acme.test/v1/ping", status: 500 }], expect: { error: "provider.unavailable" } }) as never] });
  assert.equal((await k.hs["connectors.test"](k.ctx, { key: "acme" })).result.failed, 0, "an expected error is a pass");
});

test("the harness refuses a definition that breaks the rules before any call", async () => {
  const k = kit();
  const result = async (def: Partial<ConnectorDef>) => {
    const merged = { ...ACME, tests: [], ...def } as ConnectorDef;
    k.install(merged);
    return (await k.hs["connectors.test"](k.ctx, { key: merged.key })).result;
  };
  const bad = (r: Awaited<ReturnType<typeof result>>, name: RegExp) => r.cases.find((c) => name.test(c.name) && !c.ok)?.message ?? "";
  assert.match(bad(await result({ actions: [...ACME.actions, { name: "x", url: "https://evil.example.com/x" }] }), /egress/), /x: evil\.example\.com is not one of this connector's domains/);
  assert.match(bad(await result({ actions: [...ACME.actions, { name: "x", url: "http://api.acme.test/x" }] }), /egress/), /x: http is not allowed/);
  assert.match(bad(await result({ actions: [...ACME.actions, { name: "x", url: "https://api.acme.test/{secret.Acme_Key}" }] }), /egress/), /x: a secret in the address/);
  assert.match(bad(await result({ actions: [...ACME.actions, { name: "x", url: "https://api.acme.test/x", headers: { A: "{secret.Nope}" } }] }), /secrets/), /undeclared: Nope/);
  assert.match(bad(await result({ health: "missing" }), /health/), /no action missing/);
  const oauth = await result({ ...OAUTHAPP, tests: [] });
  assert.equal(oauth.failed, 0);
  assert.match(bad(await result({ ...OAUTHAPP, tests: [], auth: { ...OAUTHAPP.auth, tokenUrl: "https://evil.example.com/t" } }), /auth/), /evil\.example\.com/);
  assert.match(bad(await result({ ...OAUTHAPP, tests: [], auth: { ...OAUTHAPP.auth, tokenUrl: undefined } }), /auth/), /missing/);
});
