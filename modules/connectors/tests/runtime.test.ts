// @reads /modules/connectors/migrations/0001_connectors.sql
// The ConnectorDef runtime: egress only to declared domains, secrets read from the Vault by name and never written anywhere, status mapping, connection gating, rate limits,
// and the connector framework (init, build, test, publish, diff, versions, rollback, export, remove, list, health).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACME } from "../fixtures/acme.ts";
import { NOW, kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";
import { checkEgress, domainAllowed, fillString, fillValue, pointerGet, scrubber, secretsIn, takeToken } from "../projections.ts";
import type { ConnectorDef } from "../projections.ts";
import { handlers as loaderHandlers } from "../impl.ts";
import { executeAction } from "../handlers/runtime.ts";

const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};
const SECRET = "sk_live_SECRET123";
const HOOK = "whsec_HOOKVALUE9";

async function withAcme(extra: Partial<ConnectorDef> = {}): Promise<{ k: Kit; id: string }> {
  const k = kit();
  k.install({ ...ACME, ...extra });
  const made = await k.hs["connections.create"](k.ctx, { connector: "acme", title: "Acme", ownerKind: "space", secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" } });
  return { k, id: made.connection.connectionId };
}
const run = (k: Kit, id: string, action: string, input: unknown = {}, dryRun?: boolean) =>
  k.hs["connectors.run"](k.ctx, { key: "acme", action, connectionId: id, input, ...(dryRun !== undefined ? { dryRun } : {}) });

test("every capability of the manifest for connectors and connections has a handler", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: { name: string; module: string }[] };
  const names = raw.capabilities.filter((c) => c.module === "connectors" && /^(connectors|connections)\./.test(c.name)).map((c) => c.name).filter((n) => !/^connectors\.(sync_now|outbox\.|push)/.test(n)).sort();
  assert.deepEqual(Object.keys(loaderHandlers).sort(), names);
  assert.deepEqual(Object.keys(kit().hs).sort(), names);
});

test("egress: https to a declared domain, nothing else", () => {
  const d = ["api.acme.test", "*.cdn.acme.test"];
  const ok = (u: string) => checkEgress(u, d).ok;
  assert.ok(ok("https://api.acme.test/v1/x?y=1"));
  assert.ok(ok("https://a.cdn.acme.test/file"));
  assert.ok(ok("https://a.b.cdn.acme.test/file"));
  assert.ok(!ok("https://cdn.acme.test/file"), "the wildcard is for subdomains");
  assert.ok(!ok("https://api.acme.test.evil.com/"), "a suffix trick");
  assert.ok(!ok("https://evilapi.acme.test/"));
  assert.ok(!ok("https://evil.com/"));
  assert.ok(!ok("https://api.acme.test@evil.com/"));
  assert.ok(!ok("https://user:pw@api.acme.test/"), "credentials in the address");
  assert.ok(!ok("http://api.acme.test/"), "plain http");
  assert.ok(!ok("ftp://api.acme.test/"));
  assert.ok(!ok("not an address"));
  assert.ok(checkEgress("http://documenso.internal/api", ["documenso.internal"]).ok, "internal services may use http");
  assert.ok(checkEgress("http://localhost/api", ["localhost"]).ok);
  assert.ok(!checkEgress("http://documenso.internal/api", ["other.internal"]).ok);
  assert.equal(domainAllowed("API.ACME.TEST", d), true);
});

test("templates, pointers and scrubbing", () => {
  const scope = { input: { id: "a b/c", n: 3, deep: { x: true } }, secret: { K: "kkkk-1234" }, connection: { id: "con_1" } };
  assert.equal(fillString("https://h/{input.id}/{connection.id}", scope, true), "https://h/a%20b%2Fc/con_1");
  assert.equal(fillString("Bearer {secret.K}", scope), "Bearer kkkk-1234");
  assert.throws(() => fillString("{input.missing}", scope), /input\.missing has no value/);
  assert.deepEqual(fillValue({ a: "{input.n}", b: "n={input.n}", c: ["{input.deep.x}"] }, scope), { a: 3, b: "n=3", c: [true] });
  assert.deepEqual([...secretsIn({ h: "{secret.A}", b: ["x {secret.B}"] })].sort(), ["A", "B"]);
  assert.equal(pointerGet({ a: [{ b: 1 }] }, "/a/0/b"), 1);
  assert.equal(pointerGet({ a: 1 }, "/zzz"), undefined);
  const s = scrubber(["secretvalue", "abc"]);
  assert.equal(s.text("x secretvalue y abc"), "x *** y abc", "values under 4 characters are not scrubbed");
  assert.deepEqual(s.value({ a: ["secretvalue"], b: { c: "no secretvalue here" } }), { a: ["***"], b: { c: "no *** here" } });
  assert.equal(takeToken("k1", { rps: 1, burst: 1 }, 0), true);
  assert.equal(takeToken("k1", { rps: 1, burst: 1 }, 100), false);
  assert.equal(takeToken("k1", { rps: 1, burst: 1 }, 1200), true);
  assert.equal(takeToken("k2", undefined, 0), true);
});

test("run: the request is built from the template, the secret travels in the header, the output comes from the pointer", async () => {
  const { k, id } = await withAcme();
  k.state.reply = () => ({ status: 200, body: { data: { name: "Ann" } } });
  const out = await run(k, id, "get_contact", { id: "c 1", expand: "notes" });
  assert.deepEqual(out, { output: { name: "Ann" }, dryRun: false });
  assert.equal(k.sent.length, 1);
  assert.equal(k.sent[0]!.url, "https://api.acme.test/v1/contacts/c%201?expand=notes");
  assert.equal(k.sent[0]!.method, "GET");
  assert.equal(k.sent[0]!.headers["X-Api-Key"], SECRET);
  assert.equal(k.sent[0]!.body, undefined);

  k.state.reply = () => ({ status: 201, body: { data: { id: "n1" } } });
  const note = await run(k, id, "add_note", { id: "c1", text: "hello", pinned: true });
  assert.deepEqual(note.output, { id: "n1" });
  const req = k.sent[1]!;
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.equal(req.headers["X-Hook"], HOOK);
  assert.deepEqual(JSON.parse(req.body!), { text: "hello", pinned: true });

  const conn = (await k.hs["connections.get"](k.ctx, { connectionId: id })).connection;
  assert.equal(conn.lastSyncAt, NOW, "a live call stamps the connection");
  const log = k.tx.all<{ action: string; method: string; host: string; path: string; status: number; actor: string }>("SELECT action, method, host, path, status, actor FROM cn_log ORDER BY id");
  assert.deepEqual(log, [
    { action: "get_contact", method: "GET", host: "api.acme.test", path: "/v1/contacts/c%201", status: 200, actor: "usr_dana" },
    { action: "add_note", method: "POST", host: "api.acme.test", path: "/v1/contacts/c1/notes", status: 201, actor: "usr_dana" },
  ]);
});

test("egress: a call outside the declared domains never leaves", async () => {
  const evil: ConnectorDef = { ...ACME, actions: [
    ...ACME.actions,
    { name: "elsewhere", url: "https://evil.example.com/steal" },
    { name: "plain", url: "http://api.acme.test/v1/ping" },
    { name: "suffix", url: "https://api.acme.test.evil.com/v1" },
    { name: "hosted", url: "https://{input.sub}.cdn.acme.test/f" },
    { name: "injected", url: "https://{input.host}/f" },
    { name: "redirect_param", url: "https://api.acme.test/v1/go", query: { to: "https://evil.example.com" } },
  ] };
  const { k, id } = await withAcme({ actions: evil.actions });
  for (const a of ["elsewhere", "plain", "suffix"]) {
    await assert.rejects(run(k, id, a), code("permission.no_grant"), a);
  }
  await assert.rejects(run(k, id, "injected", { host: "evil.example.com" }), code("permission.no_grant"));
  await assert.rejects(run(k, id, "injected", { host: "evil.com#" }), (e: unknown) => ["permission.no_grant", "validation.bad_input"].includes((e as { error: { code: string } }).error.code));
  await assert.rejects(run(k, id, "hosted", { sub: "a.evil.com/x" }), (e: unknown) => ["permission.no_grant", "validation.bad_input"].includes((e as { error: { code: string } }).error.code));
  assert.equal(k.sent.length, 0, "nothing was sent");
  await assert.rejects(run(k, id, "elsewhere"), (e: unknown) => /evil\.example\.com is not one of this connector's domains/.test((e as Error).message));
  // a declared domain may take an input subdomain; a query value that is an address is just a value
  assert.equal((await run(k, id, "hosted", { sub: "files" })).dryRun, false);
  assert.equal(k.sent[0]!.url, "https://files.cdn.acme.test/f");
  await run(k, id, "redirect_param");
  assert.equal(k.sent[1]!.url, "https://api.acme.test/v1/go?to=https%3A%2F%2Fevil.example.com");
});

test("secrets are read by name at call time and never written anywhere", async () => {
  const { k, id } = await withAcme({ rate: undefined });
  // The app echoes the key back, in a body, in an error, and in a network failure message.
  k.state.reply = () => ({ status: 200, body: { data: { echo: `key ${SECRET} and ${HOOK}` } } });
  const out = await run(k, id, "get_contact", { id: "1", expand: "x" });
  assert.deepEqual(out.output, { echo: "key *** and ***" });
  k.state.reply = () => ({ status: 400, body: { error: `bad request with ${SECRET}` } });
  const bad = await run(k, id, "get_contact", { id: "1", expand: "x" }).catch((e: unknown) => e);
  assert.equal((bad as { error: { code: string } }).error.code, "provider.bad_response");
  k.state.reply = () => new Error(`ECONNRESET talking to api.acme.test with ${SECRET}`);
  const net = await run(k, id, "get_contact", { id: "1", expand: "x" }).catch((e: unknown) => e);
  assert.equal((net as { error: { code: string } }).error.code, "provider.network");
  const dry = await run(k, id, "add_note", { id: "c1", text: "hi", pinned: false }, true);
  assert.equal(JSON.stringify(dry).includes(SECRET), false);
  assert.equal(JSON.stringify(dry).includes(HOOK), false);
  assert.match(JSON.stringify(dry), /\*\*\*/);

  const everywhere = JSON.stringify({
    err: [bad, net], dry, out,
    log: k.tx.all("SELECT * FROM cn_log"), conns: k.tx.all("SELECT * FROM cn_connections"), defs: k.tx.all("SELECT * FROM cn_connectors"),
    events: k.events, logs: k.logs, calls: k.calls,
  });
  assert.equal(everywhere.includes(SECRET), false, "the key is nowhere");
  assert.equal(everywhere.includes(HOOK), false, "nor the signing secret");
  assert.ok(everywhere.includes("#AcmeKey"), "the connection holds the Vault item's name");
  assert.match(JSON.stringify(k.tx.all("SELECT error FROM cn_log WHERE error IS NOT NULL")), /\*\*\*/);
});

test("secrets: a missing item, an empty item and an undeclared secret are refused before anything is sent", async () => {
  const { k, id } = await withAcme();
  delete k.vault["#AcmeKey"];
  await assert.rejects(run(k, id, "ping"), code("validation.precondition_failed"));
  k.vault["#AcmeKey"] = SECRET;
  k.tx.run("UPDATE cn_connections SET secrets = ? WHERE connection_id = ?", JSON.stringify({ Acme_Key: "#AcmeKey" }), id);
  await assert.rejects(run(k, id, "add_note", { id: "1", text: "t", pinned: true }), (e: unknown) => /no Vault item for Acme_Hook/.test((e as Error).message));
  const bad = { ...ACME, actions: [{ name: "x", url: "https://api.acme.test/x", headers: { A: "{secret.Nope}" } }] };
  k.install(bad);
  await assert.rejects(run(k, id, "x"), code("validation.bad_input"));
  const inUrl = { ...ACME, actions: [{ name: "x", url: "https://api.acme.test/x/{secret.Acme_Key}" }] };
  k.install(inUrl);
  await assert.rejects(run(k, id, "x"), (e: unknown) => /secret cannot be part of the address/.test((e as Error).message));
  assert.equal(k.sent.length, 0);
});

test("the answer maps to the catalogue: auth, rate limit, outage, refusal", async () => {
  const { k, id } = await withAcme({ rate: undefined });
  const call = () => run(k, id, "ping");
  k.state.reply = () => ({ status: 429 });
  await assert.rejects(call(), code("provider.rate_limited"));
  k.state.reply = () => ({ status: 503 });
  await assert.rejects(call(), code("provider.unavailable"));
  k.state.reply = () => ({ status: 404, body: { error: "no such thing" } });
  await assert.rejects(call(), code("provider.bad_response"));
  k.state.reply = () => ({ status: 200, body: "plain text" });
  assert.deepEqual((await call()).output, null, "ping reads /ok from a body that has none");
  assert.equal((await run(k, id, "raw")).output, "plain text", "no pointer: the text itself");

  k.state.reply = () => ({ status: 401 });
  await assert.rejects(call(), code("provider.auth_failed"));
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: id })).connection.state, "needs_reconnect");
  assert.equal(k.events2("connection.needs_reconnect").length, 1);
  assert.deepEqual(k.events2("connection.needs_reconnect")[0], { connectionId: id, connector: "acme" });
  const before = k.sent.length;
  await assert.rejects(call(), code("provider.auth_failed"));
  assert.equal(k.sent.length, before, "a connection waiting for a sign-in sends nothing");
  assert.equal(k.events2("connection.needs_reconnect").length, 1, "announced once");
  const statuses = k.tx.all<{ status: number | null }>("SELECT status FROM cn_log ORDER BY id").map((r) => r.status);
  assert.deepEqual(statuses, [429, 503, 404, 200, 200, 401]);
});

test("a connection that is paused, pending, someone else's or the wrong connector's is not used", async () => {
  const { k, id } = await withAcme();
  await k.hs["connections.pause"](k.ctx, { connectionId: id });
  await assert.rejects(run(k, id, "ping"), (e: unknown) => /paused by usr_dana/.test((e as Error).message));
  await k.hs["connections.resume"](k.ctx, { connectionId: id });
  assert.equal((await run(k, id, "ping")).dryRun, false);

  const mine = await k.hs["connections.create"](k.ctx, { connector: "acme", title: "Pending one", ownerKind: "space" });
  assert.equal(mine.connection.state, "pending");
  await assert.rejects(run(k, mine.connection.connectionId, "ping"), (e: unknown) => /still pending/.test((e as Error).message));

  k.install({ ...ACME, key: "other", scope: "person", title: "Other" });
  const person = await k.hs["connections.create"](k.mk("usr_bo"), { connector: "other", title: "Bo's", ownerKind: "person", secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" } });
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "other", action: "ping", connectionId: person.connection.connectionId, input: {} }), code("validation.not_found"), "dana cannot even see it");
  const row = k.tx.get<never>("SELECT * FROM cn_connections WHERE connection_id = ?", person.connection.connectionId)!;
  await assert.rejects(executeAction(k.deps, k.ctx, { ...ACME, key: "other" }, "ping", { connection: row }), code("permission.no_grant"));
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "other", action: "ping", connectionId: "con_nope", input: {} }), code("validation.not_found"));
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "other", action: "ping", connectionId: id, input: {} }), code("validation.bad_input"), "the connection belongs to acme");
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "acme", action: "nope", connectionId: mine.connection.connectionId, input: {} }), code("validation.bad_input"));
  assert.equal(k.sent.length, 1, "only the one good call went out");
});

test("a rate limit per connection: the burst, then the refill", async () => {
  const { k, id } = await withAcme();
  await run(k, id, "ping");
  await run(k, id, "ping");
  await assert.rejects(run(k, id, "ping"), code("rate_limit.exceeded"));
  assert.equal(k.sent.length, 2);
  k.clock.t += 1100;
  assert.equal((await run(k, id, "ping")).dryRun, false);
});

test("dry run builds the request and sends nothing; actions another module provides are not run here", async () => {
  const { k, id } = await withAcme({ actions: [...ACME.actions, { name: "provided_elsewhere" }] });
  const d = await run(k, id, "add_note", { id: "c9", text: "later", pinned: false }, true);
  assert.equal(d.dryRun, true);
  assert.deepEqual(d.output, { request: { method: "POST", url: "https://api.acme.test/v1/contacts/c9/notes", headers: { "X-Api-Key": "***", "X-Hook": "***", "Content-Type": "application/json" }, body: { text: "later", pinned: false } } });
  assert.equal(k.sent.length, 0);
  assert.equal(k.tx.all("SELECT * FROM cn_log").length, 0, "nothing was called, nothing is logged");
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: id })).connection.lastSyncAt, undefined);
  await assert.rejects(run(k, id, "provided_elsewhere"), code("validation.unsupported"));
  await assert.rejects(run(k, id, "get_contact", {}), code("validation.bad_input"), "a template with no value for a placeholder");
});

test("list and get: built-in connectors come from the generator's registry", async () => {
  const k = kit();
  const reg = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { connectors: { key: string; title: string; domains: string[]; actions: string[]; sources?: { key: string }[] }[] };
  const all = await k.hs["connectors.list"](k.ctx, {});
  assert.equal(all.total, reg.connectors.length);
  assert.deepEqual(all.connectors.map((c) => c.key).sort(), reg.connectors.map((c) => c.key).sort());
  const stripe = (await k.hs["connectors.get"](k.ctx, { key: "stripe" })).connector;
  const want = reg.connectors.find((c) => c.key === "stripe")!;
  assert.deepEqual([stripe.title, stripe.builtin, stripe.state, stripe.domains, stripe.actions, stripe.sources], [want.title, true, "live", want.domains, want.actions, (want.sources ?? []).map((s) => s.key)]);
  const page = await k.hs["connectors.list"](k.ctx, { limit: 5 });
  assert.equal(page.connectors.length, 5);
  assert.equal(page.next, "5");
  assert.equal((await k.hs["connectors.list"](k.ctx, { state: "draft" })).total, 0);
  await assert.rejects(k.hs["connectors.get"](k.ctx, { key: "nope" }), code("validation.not_found"));
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "stripe", action: "x", connectionId: "con_x", input: {} }), code("validation.not_found"));
  await assert.rejects(k.hs["connectors.remove"](k.ctx, { key: "stripe" }), code("validation.precondition_failed"));
  await assert.rejects(k.hs["connectors.publish"](k.ctx, { key: "stripe" }), code("validation.precondition_failed"));
});

test("the framework: init, build, test, diff, publish, versions, rollback, export, remove", async () => {
  const k = kit();
  const hs = k.hs;
  await assert.rejects(hs["connectors.init"](k.ctx, { key: "Bad Key", title: "x", mode: "api" }), code("validation.bad_input"));
  await assert.rejects(hs["connectors.init"](k.ctx, { key: "acme", title: "x", mode: "nope" as never }), code("validation.bad_input"));
  await assert.rejects(hs["connectors.init"](k.ctx, { key: "stripe", title: "x", mode: "api" }), code("validation.duplicate"));
  const init = await hs["connectors.init"](k.ctx, { key: "acme", title: "Acme CRM", mode: "api", docsUrl: "https://docs.acme.test" });
  assert.match(init.folderId, /^fld_/);
  assert.deepEqual(k.events2("connector.created"), [{ key: "acme" }]);
  assert.deepEqual(k.folders[0]!.files.map((f) => f.path), ["connector.toml", "README.md"]);
  const draftConnector = (await hs["connectors.get"](k.ctx, { key: "acme" })).connector;
  assert.deepEqual([draftConnector.state, draftConnector.version], ["draft", "0.0.0"]);
  await assert.rejects(hs["connectors.run"](k.ctx, { key: "acme", action: "ping", connectionId: "con_x", input: {} }), code("validation.precondition_failed"));
  await assert.rejects(hs["connections.create"](k.ctx, { connector: "acme", title: "t", ownerKind: "space" }), code("validation.precondition_failed"));

  // build: a Run starts and a draft exists
  const built = await hs["connectors.build"](k.ctx, { key: "acme", docsUrl: "https://docs.acme.test", notes: "read-only first" });
  assert.equal(built.runId, "run_abc123");
  assert.match(built.draftId, /^cdr_[a-z0-9]+$/);
  assert.deepEqual(k.calls.at(-1), { cap: "runs.start", input: { kind: "connector_build", owner: "usr_dana", idempotencyKey: `connector_build:acme:${built.draftId}`, name: "Build the Acme CRM connector" } });
  assert.deepEqual(k.events2("connector.built"), [{ key: "acme", draftId: built.draftId }]);

  // the draft follows the folder
  const draft: ConnectorDef = { ...ACME, version: "0.0.0" };
  k.deps.loadFolderDef = async () => draft;
  const tested = await hs["connectors.test"](k.ctx, { key: "acme", draftId: built.draftId });
  assert.equal(tested.result.failed, 0, JSON.stringify(tested.result.cases.filter((c) => !c.ok)));
  assert.equal(tested.result.passed, 3 + 5);
  const firstDiff = await hs["connectors.diff"](k.ctx, { key: "acme" });
  assert.ok(firstDiff.files.some((f) => f.path === "connector.toml" && f.added > 0));
  assert.ok(firstDiff.files.some((f) => f.path === "actions/get_contact.json"));
  assert.equal(firstDiff.breaking, false, "nothing live to break");

  // a failing test blocks the publish and keeps the last good version
  const broken: ConnectorDef = { ...draft, tests: [...draft.tests!, { name: "wrong expectation", action: "ping", responses: [{ url: "https://api.acme.test/v1/ping", body: { ok: true } }], expect: { output: false } }] };
  k.deps.loadFolderDef = async () => broken;
  const refused = await hs["connectors.publish"](k.ctx, { key: "acme" });
  assert.equal(refused.published, false);
  assert.equal(refused.result.failed, 1);
  assert.deepEqual(k.events2("connector.publish_failed"), [{ key: "acme", failed: 1 }]);
  assert.equal((await hs["connectors.get"](k.ctx, { key: "acme" })).connector.state, "draft");
  assert.deepEqual((await hs["connectors.versions"](k.ctx, { key: "acme" })).versions, []);

  k.deps.loadFolderDef = async () => draft;
  const pub = await hs["connectors.publish"](k.ctx, { key: "acme", note: "first" });
  assert.deepEqual([pub.published, pub.version, pub.result.failed], [true, "1.0.0", 0]);
  assert.deepEqual(k.events2("connector.published"), [{ key: "acme", version: "1.0.0", tests: 8 }]);
  const live = (await hs["connectors.get"](k.ctx, { key: "acme" })).connector;
  assert.deepEqual([live.state, live.version, live.actions], ["live", "1.0.0", ["ping", "get_contact", "add_note", "raw"]]);
  assert.equal(k.tx.all("SELECT * FROM cn_drafts WHERE key = 'acme'").length, 1, "the published draft is gone; the one build made is still there");

  // a second version: non-breaking is a patch, breaking is a major
  const more: ConnectorDef = { ...draft, actions: [...draft.actions, { name: "list_contacts", url: "https://api.acme.test/v1/contacts", output: "/data" }] };
  k.deps.loadFolderDef = async () => more;
  const d2 = await hs["connectors.diff"](k.ctx, { key: "acme" });
  assert.equal(d2.breaking, false);
  assert.deepEqual(d2.files.map((f) => f.path), ["actions/list_contacts.json"]);
  assert.equal((await hs["connectors.publish"](k.ctx, { key: "acme" })).version, "1.0.1");
  const fewer: ConnectorDef = { ...more, actions: more.actions.filter((a) => a.name !== "raw"), tests: more.tests!.filter((t) => t.action !== "raw") };
  k.deps.loadFolderDef = async () => fewer;
  const d3 = await hs["connectors.diff"](k.ctx, { key: "acme" });
  assert.equal(d3.breaking, true, "an action was removed");
  assert.equal((await hs["connectors.publish"](k.ctx, { key: "acme" })).version, "2.0.0");
});

test("versions, rollback, export and remove", async () => {
  const k = kit();
  const hs = k.hs;
  await hs["connectors.init"](k.ctx, { key: "acme", title: "Acme CRM", mode: "api" });
  let current: ConnectorDef = { ...ACME, version: "0.0.0", tests: [ACME.tests![0]!] };
  k.deps.loadFolderDef = async () => current;
  await hs["connectors.build"](k.ctx, { key: "acme" });
  assert.equal((await hs["connectors.publish"](k.ctx, { key: "acme", note: "one" })).version, "1.0.0");
  current = { ...current, actions: [...current.actions, { name: "extra", url: "https://api.acme.test/x" }] };
  await hs["connectors.build"](k.ctx, { key: "acme" });
  assert.equal((await hs["connectors.publish"](k.ctx, { key: "acme", note: "two" })).version, "1.0.1");
  current = { ...current, domains: ["api.acme.test"], actions: current.actions.filter((a) => a.name !== "extra") };
  await hs["connectors.build"](k.ctx, { key: "acme" });
  const major = await hs["connectors.publish"](k.ctx, { key: "acme", note: "three" });
  assert.equal(major.version, "2.0.0", "removing a domain and an action is breaking");

  const versions = (await hs["connectors.versions"](k.ctx, { key: "acme" })).versions;
  assert.deepEqual(versions.map((v) => [v.version, v.note, v.by, v.tests]), [["2.0.0", "three", "usr_dana", 4], ["1.0.1", "two", "usr_dana", 4], ["1.0.0", "one", "usr_dana", 4]]);
  assert.equal((await hs["connectors.get"](k.ctx, { key: "acme" })).connector.actions.includes("extra"), false);
  assert.deepEqual(await hs["connectors.rollback"](k.ctx, { key: "acme", version: "1.0.1" }), { ok: true });
  const back = (await hs["connectors.get"](k.ctx, { key: "acme" })).connector;
  assert.deepEqual([back.version, back.actions.includes("extra"), back.domains], ["1.0.1", true, ["api.acme.test", "*.cdn.acme.test"]]);
  assert.deepEqual(k.events2("connector.rolled_back"), [{ key: "acme", version: "1.0.1" }]);
  await assert.rejects(hs["connectors.rollback"](k.ctx, { key: "acme", version: "9.9.9" }), code("validation.not_found"));

  const folder = await hs["connectors.export"](k.ctx, { key: "acme" });
  assert.match(folder.folderId, /^fld_/);
  const exported = k.folders.at(-1)!;
  assert.ok(exported.files.some((f) => f.path === "actions/extra.json"));
  assert.ok(exported.files.some((f) => f.path === "tests/ping answers ok.json"));
  assert.doesNotMatch(JSON.stringify(exported.files), /sk_live|whsec_/);

  const conn = await hs["connections.create"](k.ctx, { connector: "acme", title: "Acme", ownerKind: "space", secrets: { Acme_Key: "#AcmeKey" } });
  k.bound["acme"] = ["contact"];
  await assert.rejects(hs["connectors.remove"](k.ctx, { key: "acme" }), (e: unknown) => /contact still sync through acme/.test((e as Error).message));
  k.bound["acme"] = [];
  k.events.length = 0;
  assert.deepEqual(await hs["connectors.remove"](k.ctx, { key: "acme" }), { removed: true });
  assert.deepEqual(k.events.map((e) => e.name), ["connection.deleted", "connector.removed"]);
  assert.deepEqual(k.events[0]!.payload, { connectionId: conn.connection.connectionId, connector: "acme" });
  await assert.rejects(hs["connectors.get"](k.ctx, { key: "acme" }), code("validation.not_found"));
  assert.equal(k.tx.all("SELECT * FROM cn_connections").length, 0);
  assert.equal(k.tx.all("SELECT * FROM cn_versions").length, 0);

  const bare = kit();
  await bare.hs["connectors.init"](bare.ctx, { key: "x", title: "X", mode: "webhook_only" });
  bare.deps.writeFolder = undefined as never;
  await assert.rejects(bare.hs["connectors.export"](bare.ctx, { key: "x" }), code("internal.unavailable"));
});

test("health: all good, some failing, all failing", async () => {
  const { k, id } = await withAcme();
  assert.deepEqual(await k.hs["connectors.health"](k.ctx, {}), { state: "healthy", failing: [] });
  const second = await k.hs["connections.create"](k.ctx, { connector: "acme", title: "Acme two", ownerKind: "space", secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" } });
  k.tx.run("UPDATE cn_connections SET state = 'failing' WHERE connection_id = ?", id);
  const some = await k.hs["connectors.health"](k.ctx, {});
  assert.deepEqual([some.state, some.failing], ["degraded", [id]]);
  assert.match(some.detail!, /1 of 2 connections needs attention: Acme/);
  k.tx.run("UPDATE cn_connections SET state = 'needs_reconnect' WHERE connection_id = ?", second.connection.connectionId);
  assert.equal((await k.hs["connectors.health"](k.ctx, {})).state, "down");
  k.tx.run("UPDATE cn_connections SET state = 'paused'");
  assert.equal((await k.hs["connectors.health"](k.ctx, {})).state, "healthy", "a paused connection is not a problem");
});
