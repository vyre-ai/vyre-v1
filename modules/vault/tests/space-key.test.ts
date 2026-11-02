// The Space AI key in the Vault (providers.space_key.*): an owner or admin sets it in one step (checked with the provider first, a refused key is never stored), it sits in a Restricted Shared folder,
// every member lists it as a provider and the engine's use is an audit row, while no member can read, reveal, fill or export it. The provider is a scripted host probe; nothing leaves the process.
// @reads /modules/vault/handlers/space-key.ts
// @reads /modules/vault/migrations/0005_space_key.sql
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/vault.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import * as p from "../handlers/providers.ts";
import * as sk from "../handlers/space-key.ts";
import { ADMIN, AGENT, MAYA, ROB, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const KEY = "ocg-live-7a1f-NEVER-IN-A-LOG-0123456789"; // secret-scan: fake
const MODELS = ["glm-5.3", "kimi-k3", "deepseek-v4-pro"];
let seq = 0;
const idem = (): string => `sk-${++seq}`;
const shape = (cap: string, value: unknown): string[] => validate(manifest.capabilities!.find((c) => c.name === cap)!.output, value, "", {});

/** A Space where ADMIN may manage policies and Maya and Rob are members with nothing on the key. The probe answers like OpenCode Go: the models for the right key, 401 words for any other. */
function space(): { h: Harness; probes: Json[] } {
  const h = harness();
  const probes: Json[] = [];
  u.configureVault({ sinks: {}, probe: async (q) => { probes.push(q as Json); return q.apiKey === KEY ? { ok: true, models: MODELS } : { ok: false, models: [], detail: "The provider did not accept this key." }; } });
  h.allow(ADMIN, "policy.manage");
  h.grant(ADMIN, "spc_vault", "manage");
  h.actAs("person", ADMIN);
  return { h, probes };
}
const done = (h: Harness): void => { u.configureVault(null); h.cleanup(); };
/** Everything the module wrote down or sent, but the one put that hands the value to the Vault (vault.item.put, which seals it). */
const outsideThePut = (h: Harness): string => JSON.stringify([(h.ctx.db as unknown as { dump(): string }).dump(), h.emitted, h.called.filter((c) => c.cap !== "vault.item.put"), h.logs]);

test("an admin sets OpenCode Go for everyone: checked first, kept Restricted, and the models it unlocks are shown", async () => {
  const { h, probes } = space();
  const set = (await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: ` ${KEY} `, idempotencyKey: idem() })) as Json;
  assert.deepEqual(shape("providers.space_key.set", set), []);
  assert.deepEqual([set.set, set.providerKey, set.name, set.models, set.state, set.setBy, set.mayManage], [true, "opencode-go", "OpenCode Go", MODELS, "ok", ADMIN, true]);
  assert.deepEqual(probes.map((q) => [q.providerKey, q.connection, q.engine]), [["opencode-go", "api_key", "opencode-go"]], "the key is checked with the provider before anything is written");
  const folder = h.rows(`SELECT * FROM vault_folder WHERE "name" = ?`, "Space AI key")[0]!;
  const item = h.rows(`SELECT * FROM vault_meta WHERE "folderId" = ?`, folder.id)[0]!;
  assert.deepEqual([folder.scope, item.scope, item.kind, item.spaceOnly], ["shared", "shared", "api_key", 1]);
  assert.equal(h.labels.get(`vault_folder/${String(folder.id)}`), "restricted");
  assert.equal(h.labels.get(`vault_item/${String(item.id)}`), "restricted");
  assert.ok(!outsideThePut(h).includes(KEY), "the key is sealed in the item, nowhere else: no row, event, other call or log");
  done(h);
});

test("a key the provider refuses is never stored, and the reason is plain", async () => {
  const { h } = space();
  assert.equal(await refusedWith(sk.set(h.ctx, { providerKey: "opencode-go", apiKey: "wrong-key-0000000000", idempotencyKey: idem() })), "provider.auth_failed");
  assert.equal(h.rows(`SELECT * FROM vault_meta`).length, 0);
  assert.equal(((await sk.get(h.ctx, {})) as Json).set, false);
  u.configureVault(null);
  assert.equal(await refusedWith(sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() })), "provider.unavailable", "no way to check it: nothing is stored either");
  assert.equal(h.rows(`SELECT * FROM vault_meta`).length, 0);
  done(h);
});

test("only a person sets it, and only a provider that takes an API key", async () => {
  const { h } = space();
  h.actAs("agent", AGENT);
  assert.equal(await refusedWith(sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() })), "permission.no_grant");
  h.actAs("person", ADMIN);
  assert.equal(await refusedWith(sk.set(h.ctx, { providerKey: "claude-code", apiKey: KEY, idempotencyKey: idem() })), "validation.bad_input");
  assert.equal(await refusedWith(sk.set(h.ctx, { providerKey: "opencode-go", apiKey: "  ", idempotencyKey: idem() })), "validation.bad_input");
  done(h);
});

test("every member lists it as OpenCode Go with no setup; none of them can read, reveal, use by name, fill or export it", async () => {
  const { h } = space();
  await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() });
  const item = h.rows(`SELECT * FROM vault_meta WHERE "kind" = ?`, "api_key")[0]!;
  const folderId = String(item.folderId), itemId = String(item.id), handle = String(item.handle);
  for (const who of [MAYA, ROB]) {
    h.actAs("person", who);
    const listed = (await p.list(h.ctx, {})) as { providers: Json[] };
    assert.deepEqual(validate(manifest.capabilities!.find((c) => c.name === "providers.list")!.output, listed, "", {}), []);
    assert.deepEqual(listed.providers.map((x) => [x.providerKey, x.name, x.scope, x.spaceKey, x.handle]), [["opencode-go", "OpenCode Go", "shared", true, handle]]);
    const got = (await sk.get(h.ctx, {})) as Json;
    assert.deepEqual([got.set, got.name, got.models, got.mayManage], [true, "OpenCode Go", MODELS, false]);
    assert.ok(!JSON.stringify(got).includes(KEY));
    assert.equal(((await v.itemsList(h.ctx, {})) as { items: unknown[] }).items.length, 0, "the item is not in their Vault");
    assert.notEqual(await refusedWith(v.itemGet(h.ctx, { itemId })), "");
    assert.notEqual(await refusedWith(v.itemReveal(h.ctx, { itemId })), "");
    assert.notEqual(await refusedWith(u.use(h.ctx, { item: handle })), "", "vault.use refuses it: a tool call can never fill it");
    assert.notEqual(await refusedWith(u.fill(h.ctx, { handle: `${handle}.api_key`, target: { kind: "http_header", ref: "x" }, returnValue: true })), "");
    assert.notEqual(await refusedWith(u.exportEnv(h.ctx, { folderId, expiresIn: "1h" })), "");
    assert.notEqual(await refusedWith(p.test(h.ctx, { providerId: String(got.providerId) })), "", "a member cannot make it reach the provider");
    assert.notEqual(await refusedWith(p.remove(h.ctx, { providerId: String(got.providerId) })), "");
  }
  // an agent acting for a member: the same
  h.actAs("agent", AGENT);
  Object.assign(h.ctx, { actingFor: MAYA });
  assert.notEqual(await refusedWith(u.use(h.ctx, { item: handle })), "");
  assert.equal(((await p.list(h.ctx, {})) as { providers: Json[] }).providers.length, 1, "the agent runs on it for Maya");
  Object.assign(h.ctx, { actingFor: undefined });
  done(h);
});

test("the engine's use answers the handle, never the value, and leaves an audit row for the person the turn is for", async () => {
  const { h } = space();
  await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() });
  const item = h.rows(`SELECT * FROM vault_meta WHERE "kind" = ?`, "api_key")[0]!;
  h.actAs("agent", AGENT);
  Object.assign(h.ctx, { actingFor: MAYA });
  const used = (await sk.use(h.ctx, { handle: `${String(item.handle)}.api_key` })) as Json;
  assert.deepEqual(shape("providers.space_key.use", used), []);
  assert.deepEqual(used, { handle: item.handle, itemId: item.id });
  const ev = h.named("vault.used").at(-1)!;
  assert.equal(ev.payload.itemId, item.id);
  assert.match(String(ev.payload.purpose), new RegExp(MAYA));
  assert.equal(await refusedWith(sk.use(h.ctx, { handle: "#Some_Other_Key" })), "validation.not_found", "only the Space AI key goes this way");
  Object.assign(h.ctx, { actingFor: undefined });
  assert.ok(!outsideThePut(h).includes(KEY));
  done(h);
});

test("the model list is kept and asked again when it is old; a key that stops working reads as failing", async () => {
  const { h, probes } = space();
  await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() });
  h.actAs("person", MAYA);
  await sk.get(h.ctx, { refresh: true });
  assert.equal(probes.length, 1, "a member opening the picker does not reach the provider, and cannot force it");
  h.advance(sk.REFRESH_MS + 1);
  const later = (await sk.get(h.ctx, {})) as Json;
  assert.equal(probes.length, 2, "an old list is asked again");
  assert.deepEqual(later.models, MODELS);
  u.configureVault({ sinks: {}, probe: async () => ({ ok: false, models: [], detail: "The provider did not accept this key." }) });
  h.actAs("person", ADMIN);
  const bad = (await sk.get(h.ctx, { refresh: true })) as Json;
  assert.deepEqual([bad.state, bad.models], ["failing", MODELS], "the last list stays; the state says the key stopped working");
  done(h);
});

test("replacing keeps one key; removing it takes it away from everyone, and the setter's own remove clears it too", async () => {
  const { h } = space();
  const first = (await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() })) as Json;
  const second = (await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() })) as Json;
  assert.notEqual(first.providerId, second.providerId);
  assert.equal(h.rows(`SELECT * FROM vault_meta WHERE "kind" = ?`, "api_key").filter((r) => r.deleted_at === null || r.deleted_at === undefined).length, 1);
  assert.equal(h.rows(`SELECT * FROM vault_folder WHERE "name" = ?`, "Space AI key").length, 1, "the same folder");
  h.actAs("person", MAYA);
  assert.equal(((await p.list(h.ctx, {})) as { providers: unknown[] }).providers.length, 1);
  h.actAs("person", ADMIN);
  const gone = (await sk.remove(h.ctx, {})) as Json;
  assert.deepEqual(shape("providers.space_key.remove", gone), []);
  assert.equal(gone.set, false);
  h.actAs("person", MAYA);
  assert.deepEqual(((await p.list(h.ctx, {})) as { providers: unknown[] }).providers, [], "nothing left to run on: the member's turn falls through to their backups");
  h.actAs("person", ADMIN);
  const again = (await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: KEY, idempotencyKey: idem() })) as Json;
  await p.remove(h.ctx, { providerId: String(again.providerId) });
  assert.equal(((await sk.get(h.ctx, {})) as Json).set, false);
  done(h);
});
