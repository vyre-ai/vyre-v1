// The editable connector source: generated TOML round-trips, legacy JSON is still read, bad sources say which file and why, and reading is bounded and refuses a source that changes under it.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDef, generateMain, parseMain, readSource, SOURCE_BOUNDS } from "../handlers/source.ts";
import { parseToml } from "../../../lib/toml.ts";
import type { ConnectorDef, ConnectorsCtx } from "../projections.ts";

type Files = Record<string, string>;
function ctxOf(files: Files, o: { onList?: () => void; deny?: boolean; versions?: () => number } = {}): ConnectorsCtx {
  const dirs = new Set<string>(["actions", "tests"]);
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    if (o.deny) throw { error: { code: "permission.no_grant", message: "You cannot open this folder." } };
    if (cap === "files.folder.get") return { folder: { folderId: "fld_src" } };
    if (cap === "files.list") {
      o.onList?.();
      const at = String(input["folder"]);
      if (at === "fld_src") return { files: Object.entries(files).filter(([p]) => !p.includes("/")).map(([p, c]) => ({ fileId: `fil_${p}`, name: p, version: o.versions?.() ?? 1, size: c.length })), folders: [...dirs].map((d) => ({ folderId: `fld_${d}`, name: d })) };
      const d = at.slice(4);
      return { files: Object.entries(files).filter(([p]) => p.startsWith(`${d}/`)).map(([p, c]) => ({ fileId: `fil_${p}`, name: p.slice(d.length + 1), version: o.versions?.() ?? 1, size: c.length })), folders: [] };
    }
    if (cap === "files.read") { const p = String(input["fileId"]).slice(4); return { text: files[p], version: o.versions?.() ?? 1, truncated: false }; }
    throw new Error(`unscripted ${cap}`);
  };
  return { trace: { traceId: "t".repeat(32), spanId: "s".repeat(16) }, emit: () => undefined, call, http: async () => ({ status: 200, text: async () => "" }) } as unknown as ConnectorsCtx;
}
const code = (c: string) => (e: unknown) => (e as { error?: { code?: string } }).error?.code === c;
const defOf = (over: Partial<ConnectorDef> = {}): ConnectorDef => ({ key: "acme", title: "Acme \"quoted\"\nline", mode: "api", scope: "space", version: "1.2.3", auth: { type: "api_key", secret: "Acme_Key", header: "X-Key", prefix: "Token " }, domains: ["api.acme.test", "*.acme.test"], secrets: [{ name: "Acme_Key", description: "API key, with a \\ and a \" and a tab\t" }], actions: [{ name: "ping", method: "GET", url: "https://api.acme.test/ping", output: "/ok" }], tests: [], rate: { rps: 5, burst: 10 }, sources: ["contact"], health: "ping", ...over });
const files = (def: ConnectorDef): Files => ({ "connector.toml": generateMain(def), ...Object.fromEntries(def.actions.map((a) => [`actions/${a.name}.json`, JSON.stringify(a)])), ...Object.fromEntries((def.tests ?? []).map((t) => [`tests/${t.name}.json`, JSON.stringify(t)])) });

test("generated connector.toml is valid TOML, escapes what needs it, and round-trips every kind of auth", async () => {
  for (const auth of [{ type: "none" as const }, { type: "api_key" as const, secret: "Acme_Key", header: "X-Key" }, { type: "bearer" as const, secret: "Acme_Key" }, { type: "oauth2" as const, secret: "Acme_Key", authUrl: "https://auth.acme.test/o", tokenUrl: "https://auth.acme.test/t", clientId: "cid", scopes: ["read", "write"] }]) {
    const def = defOf({ auth, secrets: auth.type === "none" ? [] : [{ name: "Acme_Key", description: "k" }], tests: [{ name: "ping answers", action: "ping", responses: [{ url: "https://api.acme.test/ping", body: { ok: true } }] }], objects: { contact: { list: "ping" } } });
    const text = generateMain(def);
    assert.doesNotThrow(() => parseToml(text), "valid TOML");
    assert.doesNotMatch(text, /^\{/, "not JSON");
    const read = await readSource(ctxOf(files(def)), "acme", "fld_src");
    assert.deepEqual(read.def, def, `round trip with auth ${auth.type}`);
  }
});

test("an OAuth definition with a client secret slot and a revoke address round-trips", async () => {
  const def = defOf({ auth: { type: "oauth2", secret: "Acme_Key", authUrl: "https://api.acme.test/a", tokenUrl: "https://api.acme.test/t", revokeUrl: "https://api.acme.test/r", clientId: "c", clientSecret: "Acme_Client", scopes: ["read"] }, secrets: [{ name: "Acme_Key", description: "token" }, { name: "Acme_Client", description: "client secret" }] });
  assert.deepEqual((await readSource(ctxOf(files(def)), "acme", "fld_src")).def, def);
});

test("a legacy JSON connector.toml is still read, and the same definition reads identically from either form", async () => {
  const def = defOf();
  const legacy = { ...files(def), "connector.toml": JSON.stringify({ key: def.key, title: def.title, mode: def.mode, scope: def.scope, version: def.version, auth: def.auth, domains: def.domains, secrets: def.secrets, rate: def.rate, sources: def.sources, health: def.health }, null, 2) };
  assert.deepEqual((await readSource(ctxOf(legacy), "acme", "fld_src")).def, (await readSource(ctxOf(files(def)), "acme", "fld_src")).def);
  assert.throws(() => parseMain(ctxOf({}), "{ not json"), code("validation.bad_input"));
});

test("a bad source is refused with the file and the reason, and nothing is half-read", async () => {
  const good = files(defOf());
  const cases: [string, Files, RegExp][] = [
    ["invalid TOML", { ...good, "connector.toml": "title = \nmode = \"api\"" }, /connector\.toml is not valid TOML: line 1/],
    ["unknown mode", { ...good, "connector.toml": generateMain(defOf({ mode: "nope" as never })) }, /mode is one of/],
    ["undeclared auth secret", { ...good, "connector.toml": generateMain(defOf({ auth: { type: "api_key", secret: "Other" } })) }, /auth\.secret Other is not one of the declared secrets/],
    ["a bad domain", { ...good, "connector.toml": generateMain(defOf({ domains: ["https://api.acme.test/path"] })) }, /domains are host names/],
    ["a key that is not this connector", { ...good, "connector.toml": generateMain(defOf({ key: "other" })) }, /this folder is the source of acme/],
    ["action JSON", { ...good, "actions/ping.json": "{ nope" }, /actions\/ping\.json is not valid JSON/],
    ["action named another way", { ...good, "actions/ping.json": JSON.stringify({ name: "pong", url: "https://api.acme.test/x" }) }, /named ping\.json but the action is pong/],
    ["action method", { ...good, "actions/ping.json": JSON.stringify({ name: "ping", method: "TRACE" }) }, /method is one of/],
    ["test without responses", { ...good, "tests/t.json": JSON.stringify({ name: "t", action: "ping" }) }, /responses are recorded answers/],
    ["__proto__ key", { ...good, "connector.toml": `${good["connector.toml"]}\n[__proto__]\nx = 1\n` }, /not a key|not allowed/],
    ["a literal client secret", { ...good, "connector.toml": generateMain(defOf({ auth: { type: "oauth2", secret: "Acme_Key", authUrl: "https://api.acme.test/a", tokenUrl: "https://api.acme.test/t", clientId: "c", clientSecret: "s3cr3t-literal-value" } })) }, /clientSecret must name one of the declared secrets, not hold the secret itself/],
    ["an OAuth address off the declared domains", { ...good, "connector.toml": generateMain(defOf({ auth: { type: "oauth2", secret: "Acme_Key", authUrl: "https://evil.example/a", tokenUrl: "https://api.acme.test/t" } })) }, /auth\.authUrl must be an https address on one of the declared domains/],
    ["no main file", { "actions/ping.json": "{}" }, /has no connector\.toml/],
  ];
  for (const [name, f, why] of cases) await assert.rejects(() => readSource(ctxOf(f), "acme", "fld_src"), (e: unknown) => code("validation.bad_input")(e) || code("validation.not_found")(e) ? why.test(String((e as { error: { message: string } }).error.message)) : false, name);
  assert.equal(({} as Record<string, unknown>)["x"], undefined);
});

test("reading is bounded: file count, per-file and total bytes are refused, never trimmed", async () => {
  const many: Files = { ...files(defOf()) };
  for (let i = 0; i < SOURCE_BOUNDS.files + 1; i++) many[`tests/t${i}.json`] = JSON.stringify({ name: `t${i}`, action: "ping", responses: [] });
  await assert.rejects(() => readSource(ctxOf(many), "acme", "fld_src"), /more than 200 files/);
  const big = { ...files(defOf()), "actions/ping.json": JSON.stringify({ name: "ping", url: `https://api.acme.test/${"a".repeat(SOURCE_BOUNDS.fileBytes)}` }) };
  await assert.rejects(() => readSource(ctxOf(big), "acme", "fld_src"), /too large/);
});

test("a source that changes while it is read, or that the caller may not open, is refused", async () => {
  let n = 0;
  await assert.rejects(() => readSource(ctxOf(files(defOf()), { versions: () => ++n }), "acme", "fld_src"), /changed while/);
  await assert.rejects(() => readSource(ctxOf(files(defOf()), { deny: true }), "acme", "fld_src"), code("permission.no_grant"));
});

test("buildDef holds the definition to the publish rules without Files", () => {
  const ctx = ctxOf({});
  assert.throws(() => buildDef(ctx, "acme", { title: "", mode: "api", scope: "space" }, [], []), /title is text/);
  assert.equal(buildDef(ctx, "acme", { title: "T", mode: "webhook_only", scope: "space" }, [], []).auth.type, "none", "auth defaults to none");
});
