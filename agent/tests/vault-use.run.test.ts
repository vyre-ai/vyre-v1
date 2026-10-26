// Handles in tool arguments: where a value is filled, where it is refused, and what the model and the transcript keep.
import test from "node:test";
import assert from "node:assert/strict";
import { handlesIn, handlesInArgs, runWithVault, substitute } from "../src/vault-use/index.ts";
import type { Lookup, ValueSource, VaultCall } from "../src/vault-use/index.ts";

const VALUE = "sk_live_9f8e7d6c5b4a39281706"; // secret-scan: fake
const val = (over: Partial<Extract<Lookup, { kind: "value" }>> = {}): Lookup => ({ kind: "value", itemId: "vit_1", value: VALUE, spaceOnly: false, injectIntoDeployments: false, ...over });
function src(rows: Record<string, Lookup>): { source: ValueSource; asked: string[] } {
  const asked: string[] = [];
  return { asked, source: { lookup: async (h) => { asked.push(h); return rows[h] ?? { kind: "unknown" }; } } };
}
const call = (over: Partial<VaultCall> = {}): VaultCall => ({ tool: "terminal_run", args: { command: "echo" }, traceId: "tr_1", agentId: "agt_1", asker: "usr_dana", where: "host", ...over });
const noMiss = { reportMiss: () => { throw new Error("unexpected scrub miss"); } };

test("handle grammar: items, fields and sealed record fields; hashtags and colors are only handles if the Vault knows them", () => {
  assert.deepEqual(handlesIn("a #Dana_Lawmatics.api_key b #Team_Key c rec_clients_ab12_ssn"), ["#Dana_Lawmatics.api_key", "#Team_Key", "rec_clients_ab12_ssn"]);
  assert.deepEqual(handlesInArgs({ env: { "#K.a": "x" }, list: ["#B.c", 3, null] }).sort(), ["#B.c", "#K.a"]);
  assert.equal(substitute({ c: "Bearer #A.k and #A.k_2" }, new Map([["#A.k", "ONE"], ["#A.k_2", "TWO"]])).toString(), "[object Object]");
  assert.deepEqual(substitute({ c: "Bearer #A.k and #A.k_2" }, new Map([["#A.k", "ONE"], ["#A.k_2", "TWO"]])), { c: "Bearer ONE and TWO" });
});

test("a terminal run: the executor gets the value in env and headers, the transcript keeps the handle", async () => {
  const { source } = src({ "#Dana_Lawmatics.api_key": val() });
  let seen: unknown;
  const run = await runWithVault({ source, ...noMiss }, call({ args: { command: "curl -H 'Authorization: Bearer #Dana_Lawmatics.api_key' x", env: { LM_KEY: "#Dana_Lawmatics.api_key" } } }), async (a) => { seen = a; return "200 OK"; });
  assert.equal(run.ok, true);
  assert.deepEqual(seen, { command: `curl -H 'Authorization: Bearer ${VALUE}' x`, env: { LM_KEY: VALUE } });
  if (run.ok) {
    assert.deepEqual(run.display, { command: "curl -H 'Authorization: Bearer #Dana_Lawmatics.api_key' x", env: { LM_KEY: "#Dana_Lawmatics.api_key" } });
    assert.deepEqual(run.used, [{ handle: "#Dana_Lawmatics.api_key", itemId: "vit_1" }]);
  }
});

test("output that echoes the value reaches the model with a marker instead", async () => {
  const { source } = src({ "#Dana_Lawmatics.api_key": val() });
  const run = await runWithVault({ source, ...noMiss }, call({ args: { command: "env | grep LM #Dana_Lawmatics.api_key" } }), async () => `LM_KEY=${VALUE}\nLM_B64=${Buffer.from(VALUE).toString("base64")}`);
  assert.equal(run.ok && run.output, "LM_KEY=[#Dana_Lawmatics.api_key]\nLM_B64=[#Dana_Lawmatics.api_key]");
});

test("a tool that does not run a process never gets a value: the handle text stays literal and the Vault is not asked", async () => {
  const { source, asked } = src({ "#Dana_Lawmatics.api_key": val() });
  let seen: unknown;
  const run = await runWithVault({ source, ...noMiss }, call({ tool: "files_write", args: { path: "notes.md", content: "use #Dana_Lawmatics.api_key" } }), async (a) => { seen = a; return "written"; });
  assert.equal(run.ok, true);
  assert.deepEqual(seen, { path: "notes.md", content: "use #Dana_Lawmatics.api_key" });
  assert.deepEqual(asked, []);
});

test("an unknown handle is left alone (a hashtag), and nothing is scrubbed because nothing was filled", async () => {
  const { source } = src({});
  let seen: unknown;
  const run = await runWithVault({ source, ...noMiss }, call({ args: { command: "echo '#1 priority'" } }), async (a) => { seen = a; return "#1 priority"; });
  assert.deepEqual(seen, { command: "echo '#1 priority'" });
  assert.equal(run.ok && run.output, "#1 priority");
});

test("denied handles stop the call before the executor runs: no access, or the label rule for this provider", async () => {
  for (const [reason, code] of [["no_access", "permission.no_grant"], ["provider_label", "permission.provider_label"]] as const) {
    const { source } = src({ "#Dana_Lawmatics.api_key": { kind: "denied", reason } });
    let ran = false;
    const run = await runWithVault({ source, ...noMiss }, call({ args: { command: "x #Dana_Lawmatics.api_key" } }), async () => { ran = true; return ""; });
    assert.equal(ran, false);
    assert.equal(!run.ok && run.error.code, code);
    assert.equal(!run.ok && run.error.handle, "#Dana_Lawmatics.api_key");
    assert.ok(!JSON.stringify(run).includes(VALUE));
  }
});

test("Space only items fill on the host and nowhere else; deployments need inject into deployments", async () => {
  const spaceOnly = src({ "#Prod_Db.url": val({ spaceOnly: true }) });
  const onDevice = await runWithVault({ source: spaceOnly.source, ...noMiss }, call({ where: "device", args: { command: "psql #Prod_Db.url" } }), async () => "x");
  assert.equal(!onDevice.ok && onDevice.error.code, "permission.no_grant");
  const onHost = await runWithVault({ source: spaceOnly.source, ...noMiss }, call({ where: "host", args: { command: "psql #Prod_Db.url" } }), async () => "x");
  assert.equal(onHost.ok, true);

  const closed = src({ "#Stripe.key": val() });
  const deploy = await runWithVault({ source: closed.source, ...noMiss }, call({ tool: "sites_env_set", args: { key: "STRIPE", value: "#Stripe.key" } }), async () => "set");
  assert.equal(!deploy.ok && deploy.error.message, "#Stripe.key is not set to inject into deployments.");
  const open = src({ "#Stripe.key": val({ injectIntoDeployments: true }) });
  assert.equal((await runWithVault({ source: open.source, ...noMiss }, call({ tool: "sites_env_set", args: { key: "STRIPE", value: "#Stripe.key" } }), async () => "set")).ok, true);
});

test("sealed record fields use the same filler", async () => {
  const { source } = src({ "rec_clients_ab12_ssn": val({ value: "123-45-6789", itemId: "vit_rec" }) });
  let seen: unknown;
  const run = await runWithVault({ source, ...noMiss }, call({ tool: "chrome_fill", args: { selector: "#ssn", text: "rec_clients_ab12_ssn" } }), async (a) => { seen = a; return "filled 123-45-6789"; });
  assert.deepEqual(seen, { selector: "#ssn", text: "123-45-6789" });
  assert.equal(run.ok && run.output, "filled [rec_clients_ab12_ssn]");
});

test("a value too short to scrub is not filled", async () => {
  const { source } = src({ "#Pin.code": val({ value: "12" }) });
  const run = await runWithVault({ source, ...noMiss }, call({ args: { command: "unlock #Pin.code" } }), async () => "x");
  assert.equal(!run.ok && run.error.code, "validation.bad_input");
});

test("an executor that throws with the command line in its message is scrubbed too", async () => {
  const { source } = src({ "#Dana_Lawmatics.api_key": val() });
  const run = await runWithVault({ source, ...noMiss }, call({ args: { command: "boom #Dana_Lawmatics.api_key" } }), async (a) => { throw new Error(`exit 2: ${(a as { command: string }).command}`); });
  assert.equal(!run.ok && run.error.message, "exit 2: boom [#Dana_Lawmatics.api_key]");
});

test("a stream is scrubbed across chunk boundaries", async () => {
  const { source } = src({ "#Dana_Lawmatics.api_key": val() });
  const run = await runWithVault({ source, ...noMiss }, call({ args: { command: "tail -f #Dana_Lawmatics.api_key" } }), async () => (async function* () {
    yield "start ";
    for (let i = 0; i < VALUE.length; i += 5) yield VALUE.slice(i, i + 5);
    yield " end";
  })());
  assert.equal(run.ok, true);
  if (!run.ok || typeof run.output === "string") return assert.fail("expected a stream");
  let got = "";
  for await (const p of run.output) got += p;
  assert.equal(got, "start [#Dana_Lawmatics.api_key] end");
});
