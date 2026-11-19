// connectors.define gaps found building real connectors (lane r42-mcp, 19 Nov 2026, from meier-apps): a declared and validated body, optional {input.x?} parameters, pagination and a health action, an init that
// agrees with its contract, and two more ways to sign in (HTTP Basic and a header template). Each test is red on the line before this change.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";
import * as proj from "../projections.ts";

const { fillString, fillValue } = proj;
const fillOptional = (proj as unknown as { fillOptional: (s: string, scope: unknown) => string | undefined }).fillOptional;

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as {
  capabilities: { name: string; input: { required?: string[]; properties?: Record<string, any> } }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const cap = (name: string) => registry.capabilities.find((c) => c.name === name)!;
const msg = (e: unknown): string => JSON.stringify(e);

const BASE = {
  domains: ["api.shop.test"],
  auth: { type: "bearer" as const, secret: "Shop_Key" },
  secrets: [{ name: "Shop_Key", description: "Shop key" }],
};

/** A connector made the agent's way (init without a folder, define, publish) and a connection to it with the Vault items the test names. */
async function made(k: Kit, key: string, define: Record<string, unknown>, slots: Record<string, string> = { Shop_Key: "#ShopKey" }) {
  k.vault["#ShopKey"] = "shop-key-value-1";
  await k.hs["connectors.init"](k.ctx, { key, title: key, mode: "api", source: false } as never);
  const out = await k.hs["connectors.define"](k.ctx, { key, ...BASE, ...define } as never);
  await k.hs["connectors.publish"](k.ctx, { key });
  const conn = await k.hs["connections.create"](k.ctx, { connector: key, title: key, ownerKind: "space", secrets: slots } as never);
  const id = conn.connection.connectionId as string;
  return {
    out,
    id,
    run: (action: string, input: unknown = {}, dryRun?: boolean) =>
      k.hs["connectors.run"](k.ctx, { key, action, connectionId: id, input, ...(dryRun !== undefined ? { dryRun } : {}) } as never),
  };
}

// ---- (1) body

test("define declares body and form on an action, in the contract, and validates them", async () => {
  const props = cap("connectors.define").input.properties!["actions"].items.properties;
  assert.ok(props["body"], "body is a field of an action in the contract");
  assert.ok(props["form"], "form is a field of an action in the contract");
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "bodies", title: "Bodies", mode: "api", source: false } as never);
  const def = (a: Record<string, unknown>) =>
    k.hs["connectors.define"](k.ctx, { key: "bodies", ...BASE, actions: [{ name: "x", url: "https://api.shop.test/x", ...a }] } as never);
  await assert.rejects(def({ body: { a: 1 } }), (e) => /GET carries no body/.test(msg(e)), "a GET with a body");
  await assert.rejects(def({ method: "POST", write: true, body: { a: 1 }, form: { b: "2" } }), (e) => /either a body or a form/.test(msg(e)));
  await assert.rejects(def({ method: "POST", write: true, body: { a: "{secret.Nope}" } }), (e) => /Nope/.test(msg(e)), "a secret the connector does not declare");
  await assert.rejects(def({ method: "POST", write: true, body: "x".repeat(60_000) }), (e) => /too large/.test(msg(e)));
  const ok = await def({ method: "POST", write: true, body: { name: "{input.name}", key: "{secret.Shop_Key}" } });
  assert.deepEqual(ok.actions, ["x"]);
});

test("a defined body is sent: filled from the input and the secret, as JSON, with the content type", async () => {
  const k = kit();
  const c = await made(k, "shop", {
    actions: [{ name: "add", method: "POST", write: true, url: "https://api.shop.test/items", body: { name: "{input.name}", tags: ["{input.tag}"], by: "{secret.Shop_Key}" } }],
  });
  k.state.reply = () => ({ status: 201, body: { id: "i1" } });
  await c.run("add", { name: "Mug", tag: "kitchen" });
  const req = k.sent[0]!;
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(req.body!), { name: "Mug", tags: ["kitchen"], by: "shop-key-value-1" });
});

// ---- (2) optional parameters

test("an optional {input.x?} that has no value drops its query key, header or body key; a missing required one still stops the call", async () => {
  assert.equal(fillOptional("{input.a?}", { input: {}, secret: {}, connection: { id: "c" } }), undefined);
  assert.equal(fillOptional("p-{input.a?}", { input: { a: 1 }, secret: {}, connection: { id: "c" } }), "p-1");
  assert.throws(() => fillString("{input.a?}", { input: {}, secret: {}, connection: { id: "c" } }), /no value/, "never in an address");
  assert.deepEqual(JSON.parse(JSON.stringify(fillValue({ a: "{input.a?}", b: ["{input.b?}", "x"], c: { d: "{input.d?}" } }, { input: {}, secret: {}, connection: { id: "c" } }))), { b: ["x"], c: {} });
  const k = kit();
  const c = await made(k, "optional", {
    actions: [
      { name: "find", url: "https://api.shop.test/find", query: { q: "{input.q}", page: "{input.page?}", size: "n{input.size?}" }, headers: { "X-Trace": "{input.trace?}" } },
      { name: "make", method: "POST", write: true, url: "https://api.shop.test/make", body: { name: "{input.name}", note: "{input.note?}" } },
    ],
  });
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  await c.run("find", { q: "mug" });
  assert.equal(k.sent[0]!.url, "https://api.shop.test/find?q=mug");
  assert.equal(k.sent[0]!.headers["X-Trace"], undefined, "an optional header with no value is not sent");
  await c.run("find", { q: "mug", page: 2, size: 5, trace: "t1" });
  assert.equal(k.sent[1]!.url, "https://api.shop.test/find?q=mug&page=2&size=n5");
  assert.equal(k.sent[1]!.headers["X-Trace"], "t1");
  await assert.rejects(c.run("find", {}), (e) => /input\.q has no value/.test(msg(e)));
  await c.run("make", { name: "Mug" });
  assert.deepEqual(JSON.parse(k.sent[2]!.body!), { name: "Mug" });
  await c.run("make", { name: "Mug", note: "hi" });
  assert.deepEqual(JSON.parse(k.sent[3]!.body!), { name: "Mug", note: "hi" });
});

test("define refuses an optional placeholder in the address and an optional secret", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "optbad", title: "Optbad", mode: "api", source: false } as never);
  const def = (a: Record<string, unknown>) =>
    k.hs["connectors.define"](k.ctx, { key: "optbad", ...BASE, actions: [{ name: "x", url: "https://api.shop.test/x", ...a }] } as never);
  await assert.rejects(def({ url: "https://api.shop.test/items/{input.id?}" }), (e) => /optional/.test(msg(e)));
  await assert.rejects(def({ headers: { "X-K": "{secret.Shop_Key?}" } }), (e) => /secret.*optional|optional.*secret/.test(msg(e)));
});

// ---- (3) pagination and health

test("define declares pagination and a health action: a list answers rows and the next cursor, and the cursor goes back as a query parameter", async () => {
  const props = cap("connectors.define").input.properties!["actions"].items.properties;
  assert.ok(props["paginate"], "paginate is a field of an action in the contract");
  assert.ok(cap("connectors.define").input.properties!["health"], "health is a field of define");
  const k = kit();
  const c = await made(k, "paged", {
    health: "ping",
    actions: [
      { name: "ping", url: "https://api.shop.test/ping" },
      { name: "list", url: "https://api.shop.test/items", paginate: { kind: "cursor", param: "after", next: "/meta/next", items: "/data", id: "/id" } },
      { name: "pages", url: "https://api.shop.test/pages", paginate: { kind: "page", param: "page", start: 1, size: 2, items: "/data", id: "/id" } },
      { name: "linked", url: "https://api.shop.test/linked", paginate: { kind: "link", items: "/data", id: "/id" } },
    ],
  });
  assert.equal((await k.hs["connectors.get"](k.ctx, { key: "paged" })).connector.actions.includes("ping"), true);
  const def = JSON.parse(k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = 'paged'")!.def);
  assert.equal(def.health, "ping");
  k.state.reply = () => ({ status: 200, body: { data: [{ id: "a" }, { id: "b" }], meta: { next: "tok2" } } });
  const first = await c.run("list");
  assert.deepEqual(first.output, { rows: [{ id: "a", data: {} }, { id: "b", data: {} }], next: "tok2" });
  assert.equal(k.sent[0]!.url, "https://api.shop.test/items");
  await c.run("list", { after: "tok2" });
  assert.equal(k.sent[1]!.url, "https://api.shop.test/items?after=tok2");
  k.state.reply = () => ({ status: 200, body: { data: [{ id: "a" }, { id: "b" }] } });
  const p1 = await c.run("pages");
  assert.equal((p1.output as { next?: string }).next, "2", "a full page means there may be another");
  assert.equal(k.sent[2]!.url, "https://api.shop.test/pages?page=1", "the first page is asked for by its start");
  await c.run("pages", { after: "2" });
  assert.equal(k.sent[3]!.url, "https://api.shop.test/pages?page=2");
  k.state.reply = () => ({ status: 200, body: { data: [{ id: "a" }] } });
  assert.equal(((await c.run("pages", { after: "2" })).output as { next?: string }).next, undefined, "a short page is the last");
});

test("define refuses a health action that is not a declared read, and a pagination that does not say where the list is", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "hbad", title: "Hbad", mode: "api", source: false } as never);
  const def = (o: Record<string, unknown>) =>
    k.hs["connectors.define"](k.ctx, { key: "hbad", ...BASE, actions: [{ name: "ping", url: "https://api.shop.test/ping" }, { name: "mk", method: "POST", write: true, url: "https://api.shop.test/mk" }], ...o } as never);
  await assert.rejects(def({ health: "nope" }), (e) => /health.*nope|nope.*health/i.test(msg(e)));
  await assert.rejects(def({ health: "mk" }), (e) => /health.*read|read.*health/i.test(msg(e)));
  await assert.rejects(
    def({ actions: [{ name: "l", url: "https://api.shop.test/l", paginate: { kind: "cursor", param: "after" } }] }),
    (e) => /items|next/.test(msg(e)),
  );
  await assert.rejects(
    def({ actions: [{ name: "l", url: "https://api.shop.test/l", paginate: { kind: "bogus", items: "/d", id: "/id" } }] }),
    (e) => /kind/.test(msg(e)),
  );
});

// ---- (4) init agrees with its contract

test("connectors.init does not ask for an idempotency key its contract never shows: the connector key is the natural one", () => {
  const init = cap("connectors.init");
  assert.deepEqual(init.input.required, ["key", "title", "mode"], JSON.stringify(init.input.required));
  assert.equal(init.input.properties!["idempotencyKey"], undefined);
});

// ---- (5) HTTP Basic and a header template

test("auth basic: user and password come from declared secrets and travel as an HTTP Basic header, scrubbed from answers", async () => {
  const k = kit();
  k.vault["#ShopUser"] = "api-user-7";
  k.vault["#ShopPass"] = "p4ssw0rd-secret";
  const c = await made(
    k,
    "basicshop",
    {
      auth: { type: "basic", user: "{secret.Shop_User}", password: "{secret.Shop_Pass}" },
      secrets: [{ name: "Shop_User", description: "user" }, { name: "Shop_Pass", description: "password" }],
      actions: [{ name: "me", url: "https://api.shop.test/me" }],
    },
    { Shop_User: "#ShopUser", Shop_Pass: "#ShopPass" },
  );
  k.state.reply = (req) => ({ status: 200, body: { echoed: req.headers["Authorization"], user: "api-user-7" } });
  const out = await c.run("me");
  const want = `Basic ${Buffer.from("api-user-7:p4ssw0rd-secret").toString("base64")}`;
  assert.equal(k.sent[0]!.headers["Authorization"], want);
  assert.ok(!JSON.stringify(out).includes("p4ssw0rd-secret") && !JSON.stringify(out).includes(want), "what the app echoes back is scrubbed");
});

test("auth header template: several secrets in one header value, in the form the app wants", async () => {
  const k = kit();
  k.vault["#GdKey"] = "gd-key-123";
  k.vault["#GdSecret"] = "gd-secret-456";
  const c = await made(
    k,
    "godaddy",
    {
      auth: { type: "header", header: "Authorization", template: "sso-key {secret.Gd_Key}:{secret.Gd_Secret}" },
      secrets: [{ name: "Gd_Key", description: "key" }, { name: "Gd_Secret", description: "secret" }],
      actions: [{ name: "domains", url: "https://api.shop.test/domains" }],
    },
    { Gd_Key: "#GdKey", Gd_Secret: "#GdSecret" },
  );
  k.state.reply = (req) => ({ status: 200, body: { seen: req.headers["Authorization"] } });
  const out = await c.run("domains");
  assert.equal(k.sent[0]!.headers["Authorization"], "sso-key gd-key-123:gd-secret-456");
  assert.ok(!JSON.stringify(out).includes("gd-secret-456"), "the filled header is scrubbed from the answer");
  const tok = await made(
    k,
    "tokenhdr",
    { auth: { type: "header", header: "X-Auth", template: 'Token token="{secret.Shop_Key}"' }, actions: [{ name: "x", url: "https://api.shop.test/x" }] },
  );
  await tok.run("x");
  assert.equal(k.sent[1]!.headers["X-Auth"], 'Token token="shop-key-value-1"');
});

test("define refuses an auth that names a secret it does not declare, and a header template with no secret in it", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "authbad", title: "Authbad", mode: "api", source: false } as never);
  const def = (auth: Record<string, unknown>) =>
    k.hs["connectors.define"](k.ctx, { key: "authbad", ...BASE, auth, actions: [{ name: "x", url: "https://api.shop.test/x" }] } as never);
  await assert.rejects(def({ type: "basic", user: "{secret.Nope}", password: "{secret.Shop_Key}" }), (e) => /Nope/.test(msg(e)));
  await assert.rejects(def({ type: "header", header: "X-A", template: "plain words" }), (e) => /secret/.test(msg(e)));
  await assert.rejects(def({ type: "header", template: "{secret.Shop_Key}" }), (e) => /header/.test(msg(e)));
});

// ---- r-review lows on 30bedfadd

test("a template key that would reach a prototype is refused at define, and a filled body has no prototype to change", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "proto", title: "Proto", mode: "api", source: false } as never);
  const def = (a: Record<string, unknown>) =>
    k.hs["connectors.define"](k.ctx, { key: "proto", ...BASE, actions: [{ name: "x", method: "POST", write: true, url: "https://api.shop.test/x", ...a }] } as never);
  for (const bodyText of ['{"__proto__":{"admin":true}}', '{"a":{"constructor":{"x":1}}}', '{"prototype":1}'])
    await assert.rejects(def({ body: JSON.parse(bodyText) }), (e) => /cannot be a key/.test(msg(e)), bodyText);
  await assert.rejects(def({ headers: JSON.parse('{"__proto__":"x"}') }), (e) => /cannot be a key|header name|__proto__/.test(msg(e)));
  const filled = fillValue(JSON.parse('{"__proto__":"x","a":"{input.a}"}'), { input: { a: 1 }, secret: {}, connection: { id: "c" } }) as object;
  assert.equal(Object.getPrototypeOf(filled), null, "a filled body is a plain table with no prototype");
  assert.equal(({} as { admin?: boolean }).admin, undefined);
});

test("a path through {input.__proto__} finds no value, so it can reach nothing inherited", () => {
  assert.throws(() => fillString("{input.__proto__.polluted}", { input: {}, secret: {}, connection: { id: "c" } }), /no value/);
  assert.throws(() => fillString("{input.constructor.name}", { input: {}, secret: {}, connection: { id: "c" } }), /no value/);
});

test("auth.header is a header name, and Host, Content-Length, Transfer-Encoding, Connection and Cookie are refused", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "hdrs", title: "Hdrs", mode: "api", source: false } as never);
  const def = (auth: Record<string, unknown>, headers?: Record<string, string>) =>
    k.hs["connectors.define"](k.ctx, { key: "hdrs", ...BASE, auth, actions: [{ name: "x", url: "https://api.shop.test/x", ...(headers ? { headers } : {}) }] } as never);
  for (const h of ["Host", "content-length", "Transfer-Encoding", "CONNECTION", "Cookie"])
    await assert.rejects(def({ type: "api_key", secret: "Shop_Key", header: h }), (e) => /cannot be/.test(msg(e)), h);
  for (const h of ["X Bad", "X:Bad", "a\r\nb", "X-Ünï"])
    await assert.rejects(def({ type: "api_key", secret: "Shop_Key", header: h }), (e) => /header name/.test(msg(e)), JSON.stringify(h));
  await assert.rejects(def({ type: "bearer", secret: "Shop_Key" }, { Host: "evil.example" }), (e) => /cannot be/.test(msg(e)), "an action header too");
  await def({ type: "api_key", secret: "Shop_Key", header: "X-Api-Key" }, { "X-Trace": "{input.t?}" });
});

test("a header template reads secrets only: an input or the connection id in it is refused", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "tplbad", title: "Tplbad", mode: "api", source: false } as never);
  const def = (template: string) =>
    k.hs["connectors.define"](k.ctx, { key: "tplbad", ...BASE, auth: { type: "header", header: "Authorization", template }, actions: [{ name: "x", url: "https://api.shop.test/x" }] } as never);
  await assert.rejects(def("Token {secret.Shop_Key}-{input.who}"), (e) => /secrets only/.test(msg(e)));
  await assert.rejects(def("Token {secret.Shop_Key} {connection.id}"), (e) => /secrets only/.test(msg(e)));
  await def("Token {secret.Shop_Key}");
});

test("a safety flag cannot be optional: dry_run, dryRun, confirm, force and preview keys in a query, form or body are refused when their value may be absent", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "flags", title: "Flags", mode: "api", source: false } as never);
  const def = (a: Record<string, unknown>) =>
    k.hs["connectors.define"](k.ctx, { key: "flags", ...BASE, actions: [{ name: "x", method: "POST", write: true, url: "https://api.shop.test/x", ...a }] } as never);
  for (const key of ["dry_run", "dryRun", "DRY-RUN", "dryrun", "confirm", "Force", "preview", "simulate", "validate_only", "check-only", "noop", "sandbox", "test_mode", "live"]) {
    await assert.rejects(def({ query: { [key]: "{input.v?}" } }), (e) => /cannot be optional/.test(msg(e)), `query ${key}`);
    await assert.rejects(def({ body: { nested: { [key]: "{input.v?}" } } }), (e) => /cannot be optional/.test(msg(e)), `body ${key}`);
    await assert.rejects(def({ form: { [key]: "x{input.v?}" } }), (e) => /cannot be optional/.test(msg(e)), `form ${key}`);
  }
  await def({ query: { dry_run: "{input.dry}" }, body: { confirm: true, note: "{input.note?}" } });
  // ordinary keys that only contain a flag's letters stay allowed
  await def({ query: { previews: "{input.p?}", preview_text: "{input.t?}", confirmed_by: "{input.c?}", delivered: "{input.d?}" } });
});

test("an action cannot set Authorization or the connector's own sign-in header, and the extra framing headers are refused", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "hdrs", title: "Hdrs", mode: "api", source: false } as never);
  const def = (headers: Record<string, string>, auth: Record<string, unknown> = { type: "bearer", secret: "Shop_Key" }) =>
    k.hs["connectors.define"](k.ctx, { key: "hdrs", ...BASE, auth, actions: [{ name: "x", url: "https://api.shop.test/x", headers }] } as never);
  for (const h of ["Proxy-Authorization", "TE", "Upgrade", "Expect", "Trailer", "Keep-Alive", "Proxy-Connection", "Set-Cookie", "Origin", "Referer"])
    await assert.rejects(def({ [h]: "x" }), (e) => /cannot be/.test(msg(e)), h);
  await assert.rejects(def({ authorization: "Bearer x" }), (e) => /sign-in/.test(msg(e)));
  await assert.rejects(def({ "X-Shop-Token": "x" }, { type: "api_key", secret: "Shop_Key", header: "x-shop-token" }), (e) => /sign-in/.test(msg(e)));
  await def({ "X-Other": "ok" }, { type: "api_key", secret: "Shop_Key", header: "X-Shop-Token" });
});
