// The host half of the engine's session opener (P-L2_23c): how a handle becomes a value only after vault.use said yes, how a CLI engine's loopback MCP session is minted and revoked,
// and that nothing in a refusal or a failure carries the secret. The opener itself (drivers, pool, fill) is agent/src/drivers/open and its test, agent/tests/drivers-open.test.ts,
// runs the real turn engine against a real process (host/tests/fixtures/fake-cli-driver); host may not import agent, so the two halves meet at these structural ports.
import test from "node:test";
import assert from "node:assert/strict";
import { fail } from "../src/routes/errors.ts";
import type { CtxSeed, Invoke } from "../src/invoke.ts";
import { createEngineSessionHost } from "../src/seams/engine-session.ts";
import type { VaultPort } from "../src/seams/ports.ts";

const SPACE = "spc_1";
const TRACE = "b".repeat(32);
const SECRET = "sk-ant-oat01-HOSTsecretVALUE0123456789abcdefXYZ";
const WHO = { agentId: "intake", asker: "dana", where: "host" as const };

interface Call { cap: string; input: unknown; seed: CtxSeed }

function world(answer: (cap: string, input: unknown) => unknown = () => ({ status: "ok", output: { handle: "#Dana_Claude.setup_token", itemId: "vit_claude", fields: ["setup_token"] }, traceId: TRACE })) {
  const calls: Call[] = [];
  const reads: Array<{ handle: string; space: string }> = [];
  const invoke: Invoke = async (cap, input, seed) => {
    calls.push({ cap, input, seed });
    const r = answer(cap, input);
    if (r instanceof Error) throw r;
    return r as Awaited<ReturnType<Invoke>>;
  };
  const vault: VaultPort = { secret: async (handle, space) => { reads.push({ handle, space }); return SECRET; }, signRs256: async () => "" };
  return { calls, reads, host: createEngineSessionHost({ invoke, vault, space: SPACE }) };
}

test("a handle is looked up through vault.use as the agent acting for the asker, and only then is the value read", async () => {
  const w = world();
  const r = await w.host.source.lookup("#Dana_Claude.setup_token", WHO);
  assert.deepEqual(r, { kind: "value", itemId: "vit_claude", value: SECRET, spaceOnly: false, injectIntoDeployments: false });
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0]?.cap, "vault.use");
  assert.deepEqual(w.calls[0]?.input, { item: "Dana_Claude", fields: ["setup_token"], purpose: "engine account" });
  assert.deepEqual({ space: w.calls[0]?.seed.space, principal: w.calls[0]?.seed.principal, actingFor: w.calls[0]?.seed.actingFor }, { space: SPACE, principal: { kind: "agent", id: "intake" }, actingFor: "dana" });
  assert.notEqual(w.calls[0]?.seed.preAuth, true, "access is decided, not skipped");
  assert.deepEqual(w.reads, [{ handle: "#Dana_Claude.setup_token", space: SPACE }]);
});

test("a whole-item handle asks for the item with no field", async () => {
  const w = world();
  await w.host.source.lookup("#Team_Anthropic_Key", WHO);
  assert.deepEqual(w.calls[0]?.input, { item: "Team_Anthropic_Key", purpose: "engine account" });
});

const DENIALS: Array<[string, unknown]> = [
  ["permission.provider_label", { kind: "denied", reason: "provider_label" }],
  ["permission.no_grant", { kind: "denied", reason: "no_access" }],
  ["permission.not_found", { kind: "denied", reason: "no_access" }],
  ["validation.not_found", { kind: "unknown" }],
  ["validation.bad_input", { kind: "unknown" }],
];
for (const [code, expected] of DENIALS) {
  test(`a caller without access (${code}) is refused and the Vault value is never read`, async () => {
    const w = world(() => fail(code as never, TRACE));
    assert.deepEqual(await w.host.source.lookup("#Dana_Claude.setup_token", WHO), expected);
    assert.deepEqual(w.reads, [], "the Vault was not asked for the value");
  });
}

test("a call held for approval is not a yes", async () => {
  const w = world(() => ({ status: "held", taskId: "tsk_1", traceId: TRACE }));
  assert.deepEqual(await w.host.source.lookup("#Dana_Claude.setup_token", WHO), { kind: "denied", reason: "no_access" });
  assert.deepEqual(w.reads, []);
});

test("text that is not a Vault handle is never looked up: a sealed record field, a hashtag, a sentence", async () => {
  const w = world();
  for (const text of ["rec_clients_ab12_ssn", "#1 priority", "#", "#Dana Claude", "Dana_Claude", "#a.b.c"]) assert.deepEqual(await w.host.source.lookup(text, WHO), { kind: "unknown" }, text);
  assert.equal(w.calls.length, 0);
});

test("a failure of the Vault itself is an error that names the code and never the text that came with it", async () => {
  const w = world(() => Object.assign(new Error(`upstream said: token ${SECRET} rejected`), { code: "provider.unavailable" }));
  await assert.rejects(w.host.source.lookup("#Dana_Claude.setup_token", WHO), (e: unknown) => e instanceof Error && e.message === "The Vault could not be read (provider.unavailable)." && !e.message.includes(SECRET));
});

test("a Vault port that fails after access was granted does not leak what it said", async () => {
  const invoke: Invoke = async () => ({ status: "ok", output: { handle: "#X", itemId: "vit_1", fields: [] }, traceId: TRACE });
  const vault: VaultPort = { secret: async () => { throw new Error(`could not open ${SECRET}`); }, signRs256: async () => "" };
  const host = createEngineSessionHost({ invoke, vault, space: SPACE });
  await assert.rejects(host.source.lookup("#Dana_Claude.setup_token", WHO), (e: unknown) => e instanceof Error && !e.message.includes(SECRET));
});

test("a CLI engine's loopback MCP session is minted as the host service with the agent, the person and the thread, and the engine's trace", async () => {
  const w = world((cap) => (cap === "mcp.session.mint"
    ? { status: "ok", output: { sessionId: "ses_1", sessionToken: "vys_abc", url: "http://127.0.0.1:41800/mcp", expiresAt: 123 }, traceId: TRACE }
    : { status: "ok", output: { closed: true }, traceId: TRACE }));
  const m = await w.host.mcp.mint({ principal: "intake", actingFor: "dana", threadId: "T1", traceId: TRACE });
  assert.deepEqual(m, { sessionId: "ses_1", sessionToken: "vys_abc", url: "http://127.0.0.1:41800/mcp", expiresAt: 123 });
  assert.deepEqual(w.calls[0]?.input, { principal: "intake", actingFor: "dana", threadId: "T1", traceId: TRACE });
  assert.deepEqual(w.calls[0]?.seed.principal, { kind: "service", id: "svc_host" });
  assert.equal(w.calls[0]?.seed.thread, "T1");
  assert.equal(w.calls[0]?.seed.trace?.traceId, TRACE);
  await w.host.mcp.close("ses_1");
  assert.equal(w.calls[1]?.cap, "mcp.session.close");
  assert.deepEqual(w.calls[1]?.input, { sessionId: "ses_1" });
});

test("an engine trace id that is not 32 hex is not forced onto the pipeline", async () => {
  const w = world(() => ({ status: "ok", output: { sessionId: "s", sessionToken: "t", url: "u", expiresAt: 1 }, traceId: TRACE }));
  await w.host.mcp.mint({ principal: "intake", actingFor: "dana", threadId: "T1", traceId: "tr_1" });
  assert.equal(w.calls[0]?.seed.trace, undefined);
});

test("a mint that the pipeline refuses or holds is an error, never a token", async () => {
  const refused = world(() => fail("permission.no_grant", TRACE));
  await assert.rejects(refused.host.mcp.mint({ principal: "intake", actingFor: "dana", threadId: "T1", traceId: TRACE }));
  const held = world(() => ({ status: "held", taskId: "tsk_1", traceId: TRACE }));
  await assert.rejects(held.host.mcp.mint({ principal: "intake", actingFor: "dana", threadId: "T1", traceId: TRACE }), /held/);
});

test("a scrub miss is reported with ids and place only", async () => {
  const w = world(() => ({ status: "ok", output: { ok: true }, traceId: TRACE }));
  await w.host.reportMiss({ itemId: "vit_claude", place: "terminal", traceId: TRACE });
  assert.equal(w.calls[0]?.cap, "vault.report_scrub_miss");
  assert.deepEqual(w.calls[0]?.input, { itemId: "vit_claude", place: "terminal", traceId: TRACE });
  assert.ok(!JSON.stringify(w.calls).includes(SECRET));
});
