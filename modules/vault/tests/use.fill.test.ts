// Vault use by name (P-L7_10; spec 2.17; ARCH 6.11, 7.8): use answers a handle and field names, a value leaves the vault only through fill (into a sink the host registered), agents never get a value back,
// inject_env names keys and handles, export_env makes a sealed pull link, and the capabilities of deferred packets refuse in one voice (ruling 60).
// @reads /modules/vault/handlers/use.ts
// @reads /modules/vault/migrations/0002_exports.sql
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { DEFERRED, handlers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { resolveVaultItem } from "../../../host/src/seams/vault.ts";
import { AGENT, MAYA, ROB, SECRET, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `u-${++seq}`;

async function folder(h: Harness, scope: "mine" | "shared" = "shared"): Promise<string> {
  return String(out(out(await v.foldersCreate(h.ctx, { name: `${scope} ${key()}`, scope, idempotencyKey: key() })).folder).id);
}
async function put(h: Harness, folderId: string, name: string, secret = SECRET): Promise<string> {
  const made = out(await v.itemPut(h.ctx, { folderId, name, kind: "api_key", fields: [{ key: "username", value: "dana" }, { key: "api_key", value: secret }], idempotencyKey: key() } as Parameters<typeof v.itemPut>[1]));
  return String(out(made.item).id);
}
function sinks() {
  const got: { value: string; ref: string; handle: string; field: string }[] = [];
  u.configureVault({ sinks: { env: (f) => { got.push(f); } } });
  return got;
}

test("use by name answers a handle and field names, never a value, and leaves a use in the history", async () => {
  const h = harness();
  const id = await put(h, await folder(h), "Dana Lawmatics");
  const r = out(await u.use(h.ctx, { item: "Dana Lawmatics", purpose: "sync contacts" }));
  assert.deepEqual([r.handle, r.itemId, r.fields], ["#Dana_Lawmatics", id, ["username", "api_key"]]);
  assert.deepEqual(contractErrors("vault.use", "out", r), []);
  assert.deepEqual(out(await u.use(h.ctx, { item: id, fields: ["api_key"] })).fields, ["api_key"]);
  assert.deepEqual(out(await u.use(h.ctx, { item: "#dana_lawmatics" })).itemId, id, "a handle in any case finds it");
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Dana Lawmatics", fields: ["nope"] })), "validation.bad_input");
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Nothing here" })), "validation.not_found");
  const used = h.named("vault.used");
  assert.equal(used.length, 3);
  assert.equal(used[0]?.payload["purpose"], "sync contacts");
  assert.ok(!h.everything().includes(SECRET));
  h.actAs("person", ROB);
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Dana Lawmatics" })), "validation.not_found", "someone with no access cannot even tell it exists");
  h.grant(ROB, id, "use");
  assert.equal(out(await u.use(h.ctx, { item: "Dana Lawmatics" })).handle, "#Dana_Lawmatics");
  h.cleanup();
});

test("values leave the vault only through fill: the sink gets the value once, the answer and everything the module wrote hold none", async () => {
  const h = harness();
  const got = sinks();
  await put(h, await folder(h), "Dana Lawmatics");
  const r = out(await u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "proc_1/LAWMATICS_KEY" } }));
  assert.deepEqual(contractErrors("vault.fill", "out", r), []);
  assert.deepEqual([r.filled, r.field, r.where, "value" in r], [true, "api_key", "host", false]);
  assert.deepEqual(got.map((g) => [g.value, g.ref, g.handle, g.field]), [[SECRET, "proc_1/LAWMATICS_KEY", "#Dana_Lawmatics", "api_key"]]);
  assert.ok(!h.everything().includes(SECRET), "not in the database, events, calls or logs");
  assert.equal(h.named("vault.used")[0]?.payload["field"], "api_key");
  // without a field the one secret field is meant
  assert.equal(out(await u.fill(h.ctx, { handle: "#Dana_Lawmatics", target: { kind: "env", ref: "p" } })).field, "api_key");
  assert.equal(got.length, 2);
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "Dana", target: { kind: "env", ref: "p" } })), "validation.bad_input");
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "#Dana_Lawmatics.nope", target: { kind: "env", ref: "p" } })), "validation.bad_input");
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "terminal", ref: "t" } })), "internal.unavailable", "no place registered for that kind");
  assert.equal(got.length, 2, "a refused fill delivered nothing");
  u.configureVault(null);
  h.cleanup();
});

test("returnValue is for a person at View level; an agent at Use fills but never sees the value", async () => {
  const h = harness();
  const got = sinks();
  const id = await put(h, await folder(h), "Dana Lawmatics");
  h.actAs("agent", AGENT);
  h.grant(AGENT, id, "use");
  const filled = out(await u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "p" } }));
  assert.equal(filled.filled, true);
  assert.equal(got.length, 1);
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "p" }, returnValue: true })), "permission.no_grant");
  h.grant(AGENT, id, "view");
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "p" }, returnValue: true })), "permission.no_grant", "not even at View");
  h.actAs("person", ROB);
  h.grant(ROB, id, "use");
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "p" }, returnValue: true })), "permission.no_grant");
  h.grant(ROB, id, "view");
  assert.equal(out(await u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "p" }, returnValue: true })).value, SECRET);
  u.configureVault(null);
  h.cleanup();
});

test("a fill with no sink and no returnValue refuses instead of claiming it filled", async () => {
  const h = harness();
  u.configureVault(null);
  await put(h, await folder(h), "Dana Lawmatics");
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "p" } })), "internal.unavailable");
  const r = out(await u.fill(h.ctx, { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "p" }, returnValue: true }));
  assert.deepEqual([r.filled, r.value], [false, SECRET]);
  h.cleanup();
});

test("inject_env names the keys and handles of a folder, never a value", async () => {
  const h = harness();
  const f = await folder(h);
  await put(h, f, "Stripe live", "sk-stripe-AAAA");
  await put(h, f, "Dana Lawmatics");
  const r = out(await u.injectEnv(h.ctx, { folderId: f, purpose: "vyre run --env" }));
  assert.deepEqual(contractErrors("vault.inject_env", "out", r), []);
  assert.deepEqual(r.handles, ["#Dana_Lawmatics.username", "#Dana_Lawmatics.api_key", "#Stripe_live.username", "#Stripe_live.api_key"]);
  assert.deepEqual(r.keys, ["username", "api_key"]);
  assert.equal(h.named("vault.used").length, 2);
  assert.ok(!h.everything().includes("sk-stripe-AAAA") && !h.everything().includes(SECRET));
  h.cleanup();
});

test("export_env seals a .env under the filler, keeps only the token hash, expires, revokes and notifies the folder", async () => {
  const h = harness();
  const f = await folder(h);
  await put(h, f, "Dana Lawmatics");
  u.configureVault({ sinks: {}, origin: () => "https://vault.example.test/" });
  const r = out(await u.exportEnv(h.ctx, { folderId: f, expiresIn: "1h", idempotencyKey: key() }));
  assert.ok(String(r.pullUrl).startsWith(`https://vault.example.test/exports/${String(r.exportId)}?token=`), "the link points at the server's own address");
  u.configureVault(null);
  assert.deepEqual(contractErrors("vault.export_env", "out", r), []);
  assert.equal(r.expiresAt, h.ctx.now() + 3_600_000);
  const token = new URL(String(r.pullUrl)).searchParams.get("token") ?? "";
  assert.ok(token.length >= 30);
  assert.deepEqual(h.named("vault.exported")[0]?.payload, { exportId: r.exportId, folderId: f, itemCount: 1, expiresAt: r.expiresAt });
  const row = h.rows(`SELECT * FROM vault_export`)[0] ?? {};
  assert.ok(!JSON.stringify(row).includes(SECRET) && !JSON.stringify(row).includes(token), "the database holds neither the value nor the token");
  const env = u.exportPull(h.ctx, { exportId: String(r.exportId), token });
  assert.equal(env, `username="dana"\napi_key=${JSON.stringify(SECRET)}\n`);
  assert.throws(() => u.exportPull(h.ctx, { exportId: String(r.exportId), token }), "a link is single use: the second pull is refused");
  assert.throws(() => u.exportPull(h.ctx, { exportId: String(r.exportId), token: "wrong" }));
  assert.deepEqual(out(await u.exportsList(h.ctx, { folderId: f })).exports, [{ id: r.exportId, folderId: f, by: MAYA, expiresAt: r.expiresAt, pulled: true }]);
  assert.deepEqual(contractErrors("vault.exports.list", "out", await u.exportsList(h.ctx, {})), []);
  assert.deepEqual(await u.exportsRevoke(h.ctx, { exportId: String(r.exportId) }), { ok: true });
  assert.equal(h.named("vault.export_revoked").length, 1);
  assert.throws(() => u.exportPull(h.ctx, { exportId: String(r.exportId), token }), "a revoked link is closed");
  assert.deepEqual(out(await u.exportsList(h.ctx, {})).exports, []);
  const second = out(await u.exportEnv(h.ctx, { folderId: f, expiresIn: "1d", idempotencyKey: key() }));
  h.advance(86_400_001);
  assert.throws(() => u.exportPull(h.ctx, { exportId: String(second.exportId), token: new URL(String(second.pullUrl)).searchParams.get("token") ?? "" }), "an expired link is closed");
  assert.equal(await refusedWith(u.exportEnv(h.ctx, { folderId: f, expiresIn: "2d" })), "validation.bad_input");
  h.cleanup();
});

test("an export is recorded in the item's history, and a person with no access to the folder cannot make one", async () => {
  const h = harness();
  const f = await folder(h);
  const id = await put(h, f, "Dana Lawmatics");
  await u.exportEnv(h.ctx, { folderId: f, expiresIn: "1h" });
  const hist = out(await v.itemHistory(h.ctx, { itemId: id }));
  assert.ok((hist.entries as Json[]).some((e) => e.action === "exported"));
  h.actAs("person", ROB);
  assert.equal(await refusedWith(u.exportEnv(h.ctx, { folderId: f, expiresIn: "1h" })), "permission.no_grant", "no access to the folder");
  h.cleanup();
});

test("report_scrub_miss raises vault.scrub_miss with the place and trace, and nothing else", async () => {
  const h = harness();
  const id = await put(h, await folder(h), "Dana Lawmatics");
  assert.deepEqual(await u.reportScrubMiss(h.ctx, { itemId: id, place: "terminal", traceId: "a".repeat(32) }), { ok: true });
  assert.deepEqual(h.named("vault.scrub_miss")[0]?.payload, { itemId: id, place: "terminal", traceId: "a".repeat(32) });
  assert.equal(await refusedWith(u.reportScrubMiss(h.ctx, { itemId: id, place: "moon" as never, traceId: "a".repeat(32) })), "validation.bad_input");
  h.cleanup();
});

test("the handler map is exactly the manifest's capabilities, and each deferred one refuses in one voice (ruling 60)", async () => {
  const mine = registry.capabilities.filter((c) => c.module === "vault").map((c) => c.name).sort();
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  const h = harness();
  for (const cap of DEFERRED) {
    const run = handlers[cap]!;
    const err = await Promise.resolve().then(() => run(h.ctx as never, {})).then(() => null, (e: unknown) => e as { error: { code: string; message: string } });
    assert.deepEqual([err?.error.code, err?.error.message], ["internal.unavailable", "Not in this version yet"], cap);
  }
  h.cleanup();
});

test("the pipeline's name and handle lookup finds the item before authorize, with or without a field after the handle", async () => {
  const h = harness();
  const id = await put(h, await folder(h), "Dana Lawmatics");
  const find = (kind: "name" | "handle", value: string) => resolveVaultItem(h.ctx.db, "vault_item", kind, value);
  assert.equal(find("name", "Dana Lawmatics"), id);
  assert.equal(find("name", "dana lawmatics"), id);
  assert.equal(find("name", id), id);
  assert.equal(find("handle", "#Dana_Lawmatics"), id);
  assert.equal(find("handle", "#Dana_Lawmatics.api_key"), id);
  assert.equal(find("handle", "#dana_lawmatics.api_key"), id);
  assert.equal(find("name", "Nothing"), null);
  assert.equal(resolveVaultItem(h.ctx.db, "vault_folder", "name", "Dana Lawmatics"), null);
  h.cleanup();
});

// P-GF_07: the engine reads an account as the agent acting for its asker; a Mine item is reachable that way at use level and no other.
test("an agent acting for the owner may use a Mine item, an agent acting for someone else or for no one finds nothing, by name or id", async () => {
  const h = harness();
  h.actAs("person", MAYA);
  const id = await put(h, await folder(h, "mine"), "Maya Claude");
  h.actAs("agent", AGENT);
  h.ctx.actingFor = ROB;
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Maya Claude" })), "validation.not_found", "acting for someone else");
  delete h.ctx.actingFor;
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Maya Claude" })), "validation.not_found", "acting for no one");
  h.ctx.actingFor = MAYA;
  assert.equal(out(await u.use(h.ctx, { item: "Maya Claude" })).itemId, id, "acting for the owner");
  assert.equal(out(await u.use(h.ctx, { item: id })).itemId, id, "by id too");
  assert.ok(!JSON.stringify(await v.itemsList(h.ctx, {})).includes(id), "the agent cannot list it");
  const got = sinks();
  assert.equal(await refusedWith(u.fill(h.ctx, { handle: "#Maya_Claude.api_key", target: { kind: "env", ref: "p" } })), "validation.not_found", "fill is not for a turn");
  assert.equal(got.length, 0, "the sink was never called");
  assert.equal(await refusedWith(v.itemReveal(h.ctx, { itemId: id })), "validation.not_found", "view and reveal stay the owner's");
  h.actAs("person", ROB);
  h.ctx.actingFor = MAYA;
  assert.equal(await refusedWith(u.use(h.ctx, { item: "Maya Claude" })), "validation.not_found", "a person acting for someone gets no change");
  h.cleanup();
});
