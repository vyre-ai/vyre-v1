// Provider definitions are data: the built-ins load from modules/vault/providers/*.json and are validated; a Space adds its own OpenAI-compatible endpoints (custom_add, custom_list, custom_remove),
// and a connected endpoint carries its address so the engine can reach it. The key is in the Vault item only.
// @reads /modules/vault/handlers/provider-defs.ts
// @reads /modules/vault/migrations/0004_provider_defs.sql
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as p from "../handlers/providers.ts";
import * as u from "../handlers/use.ts";
import { builtinDefs, loadDefs, validateDef, addressProblem } from "../handlers/provider-defs.ts";
import { MAYA, ROB, SECRET, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `d-${++seq}`;

test("the built-in definitions are files: all ten load, in gallery order, each named after its key", () => {
  const defs = builtinDefs();
  assert.deepEqual(defs.map((d) => d.key), ["claude-code", "codex", "grok", "anthropic", "openai", "openrouter", "google", "xai", "opencode-go", "local"]);
  assert.equal(p.CATALOG, builtinDefs(), "the catalog is the loaded files");
  const local = defs.find((d) => d.key === "local")!;
  assert.deepEqual([local.keyless, local.connections], [true, ["local_model"]]);
  assert.equal(defs.find((d) => d.key === "opencode-go")!.base, "https://opencode.ai/inference/go/openai/v1");
});

test("a definition file is validated: a bad one is refused with its name, a duplicate key or a wrongly named file stops the load", () => {
  const good = { key: "acme", name: "Acme", connections: ["api_key"], modelsSource: "static", engine: "custom" };
  assert.equal(validateDef(good, "acme.json").key, "acme");
  const bads: Array<[unknown, RegExp]> = [
    [null, /not an object/], [{ ...good, key: "Bad Key" }, /key must be/], [{ ...good, name: "" }, /name must be/], [{ ...good, connections: ["telepathy"] }, /connections must/],
    [{ ...good, connections: [] }, /connections must/], [{ ...good, models: [1] }, /models must/], [{ ...good, base: "ftp://x" }, /base must/], [{ ...good, keyless: "yes" }, /keyless must/], [{ ...good, engine: undefined }, /engine is missing/],
  ];
  for (const [raw, why] of bads) assert.throws(() => validateDef(raw, "x.json"), why);
  const dir = mkdtempSync(join(tmpdir(), "defs-"));
  try {
    writeFileSync(join(dir, "wrong.json"), JSON.stringify(good));
    assert.throws(() => loadDefs(pathToFileURL(`${dir}/`)), /must be named acme\.json/);
    rmSync(join(dir, "wrong.json"));
    writeFileSync(join(dir, "acme.json"), JSON.stringify(good));
    writeFileSync(join(dir, "broken.json"), "{ nope");
    assert.throws(() => loadDefs(pathToFileURL(`${dir}/`)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("addressProblem: a key goes over https or to this machine; a keyless endpoint may use plain http; no key in the address", () => {
  assert.equal(addressProblem("https://llm.acme.test/v1", true), null);
  assert.equal(addressProblem("http://localhost:11434/v1", true), null);
  assert.match(addressProblem("http://llm.acme.test/v1", true) ?? "", /https/);
  assert.equal(addressProblem("http://192.168.1.20:1234", false), null);
  assert.match(addressProblem("https://user:pw@llm.acme.test", true) ?? "", /key field/);
  assert.match(addressProblem("ftp://x", false) ?? "", /http/);
  assert.match(addressProblem("nope", false) ?? "", /not an address/);
});

test("custom_add registers an endpoint and connects it: it is in the catalog and the list, the row carries the address, the key is only in the item", async () => {
  const h = harness();
  const r = out(await p.customAdd(h.ctx, { name: "Acme gateway", baseUrl: "https://llm.acme.test/v1/", apiKey: SECRET, models: ["acme-large"], scope: "mine", idempotencyKey: key() }));
  assert.deepEqual(contractErrors("providers.custom_add", "out", r), []);
  const ep = out(r.endpoint), row = out(r.provider);
  assert.deepEqual([ep.key, ep.base, ep.keyless, ep.connected], ["custom-acme-gateway", "https://llm.acme.test/v1", false, 1]);
  assert.deepEqual([row.providerKey, row.engine, row.connection, row.address, row.handle], ["custom-acme-gateway", "custom", "api_key", "https://llm.acme.test/v1", "#Acme_gateway"]);
  const cat = out(await p.catalog(h.ctx, {})).providers as Json[];
  assert.deepEqual(contractErrors("providers.catalog", "out", { providers: cat }), []);
  assert.deepEqual(cat.find((c) => c.key === "custom-acme-gateway"), { key: "custom-acme-gateway", name: "Acme gateway", connections: ["api_key"], modelsSource: "https://llm.acme.test/v1/models", engine: "custom", custom: true, base: "https://llm.acme.test/v1" });
  assert.equal(cat.length, 11);
  const list = out(await p.customList(h.ctx, {}));
  assert.deepEqual(contractErrors("providers.custom_list", "out", list), []);
  assert.deepEqual((list.endpoints as Json[]).map((e) => e.models), [["acme-large"]]);
  assert.deepEqual(contractErrors("providers.list", "out", out(await p.list(h.ctx, {}))), []);
  assert.ok(!h.everything().includes(SECRET), "the key is sealed in the item, nowhere else");
  assert.equal(h.named("provider.added").length, 1);
  h.cleanup();
});

test("a custom endpoint without a key is a keyless connection; a second endpoint with the same name gets its own key; refused addresses and bad input", async () => {
  const h = harness();
  const a = out(await p.customAdd(h.ctx, { name: "vLLM box", baseUrl: "http://192.168.1.20:8000/v1", scope: "mine", idempotencyKey: key() }));
  assert.deepEqual([out(a.endpoint).keyless, out(a.provider).connection, out(a.provider).keyless, out(a.provider).address], [true, "local_model", true, "http://192.168.1.20:8000/v1"]);
  const b = out(await p.customAdd(h.ctx, { name: "vLLM box", baseUrl: "https://other.test/v1", apiKey: SECRET, scope: "mine", idempotencyKey: key() }));
  assert.equal(out(b.endpoint).key, "custom-vllm-box-2");
  assert.equal(await refusedWith(p.customAdd(h.ctx, { name: "", baseUrl: "https://x.test", scope: "mine", idempotencyKey: key() })), "validation.bad_input");
  assert.equal(await refusedWith(p.customAdd(h.ctx, { name: "Plain", baseUrl: "http://llm.acme.test/v1", apiKey: SECRET, scope: "mine", idempotencyKey: key() })), "validation.bad_input", "a key is never sent over plain http to another machine");
  assert.equal(await refusedWith(p.customAdd(h.ctx, { name: "Sneaky", baseUrl: "https://u:p@x.test", scope: "mine", idempotencyKey: key() })), "validation.bad_input");
  u.configureVault({ sinks: {}, refuse: async ({ address }) => (address.includes("169.254") ? "That address is not allowed." : null) });
  assert.equal(await refusedWith(p.customAdd(h.ctx, { name: "Meta", baseUrl: "http://169.254.169.254/v1", scope: "mine", idempotencyKey: key() })), "validation.bad_input", "the host's network guard has the last word");
  u.configureVault(null);
  h.cleanup();
});

test("providers.test on a custom endpoint hands the host its address and engine; the local model uses its saved address too", async () => {
  const h = harness();
  const ep = out(await p.customAdd(h.ctx, { name: "Acme", baseUrl: "https://llm.acme.test/v1", apiKey: SECRET, scope: "mine", idempotencyKey: key() }));
  const seen: unknown[] = [];
  u.configureVault({ sinks: {}, probe: async (q) => { seen.push({ ...q, apiKey: q.apiKey ? "[key]" : undefined }); return { ok: true, models: ["acme-large"] }; } });
  assert.equal(out(await p.test(h.ctx, { providerId: String(out(ep.provider).id) })).ok, true);
  assert.deepEqual(seen, [{ providerKey: "custom-acme", connection: "api_key", caller: MAYA, apiKey: "[key]", address: "https://llm.acme.test/v1", engine: "custom" }]);
  u.configureVault(null);
  h.cleanup();
});

test("custom_remove: only its author, not while someone else uses it; it takes the author's connection and the item with it", async () => {
  const h = harness();
  const folder = String(out(out(await (await import("../handlers/index.ts")).foldersCreate(h.ctx, { name: "shared d", scope: "shared", idempotencyKey: key() })).folder).id);
  const ep = out(await p.customAdd(h.ctx, { name: "Acme", baseUrl: "https://llm.acme.test/v1", apiKey: SECRET, scope: "shared", folderId: folder, idempotencyKey: key() }));
  h.actAs("person", ROB);
  assert.equal(await refusedWith(p.customRemove(h.ctx, { key: "custom-acme" })), "permission.no_grant");
  const robs = out(await p.add(h.ctx, { providerKey: "custom-acme", connection: "api_key", scope: "mine", apiKey: `${SECRET}-rob`, idempotencyKey: key() }));
  assert.equal(out(out(robs).provider).address, "https://llm.acme.test/v1", "another person connects to the Space's endpoint with their own key");
  h.actAs("person", MAYA);
  assert.equal(await refusedWith(p.customRemove(h.ctx, { key: "custom-acme" })), "validation.precondition_failed");
  h.actAs("person", ROB);
  await p.remove(h.ctx, { providerId: String(out(out(robs).provider).id) });
  h.actAs("person", MAYA);
  assert.deepEqual(out(await p.customRemove(h.ctx, { key: "custom-acme" })), { ok: true });
  assert.deepEqual(out(await p.customList(h.ctx, {})).endpoints, []);
  assert.deepEqual(out(await p.list(h.ctx, {})).providers, []);
  assert.equal(await refusedWith(p.customRemove(h.ctx, { key: "custom-acme" })), "validation.not_found");
  void ep;
  h.cleanup();
});
