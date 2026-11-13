// @nocache  (these tests start real processes)
// Whose turn is it? The product's rule: every turn runs for the person it serves, with that person's rights and on that person's account. These are guards, not features: if someone drops the asker from
// the warm-pool key, or lets a session or a tool context remember an earlier person, one of them fails. They use the real turn engine, the real session opener and the real fake CLI process
// (host/tests/fixtures/fake-cli-driver/fake-cli.mjs); only the Vault and the MCP minting are fakes, and the minting records who each session was minted for.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../src/drivers/cli/index.ts";
import type { Launcher } from "../src/drivers/cli/index.ts";
import { createSessionOpener } from "../src/drivers/open/index.ts";
import type { McpPort, OpenAccount, SessionOpener } from "../src/drivers/open/index.ts";
import { ctx } from "../src/drivers/api/testing.ts";
import { createTurnEngine } from "../src/turn-engine/index.ts";
import type { EngineAgent, SessionSpec, ToolRunner } from "../src/turn-engine/index.ts";
import { scriptedProvider } from "../src/turn-engine/scripted-session.ts";
import type { Lookup, ValueSource } from "../src/vault-use/index.ts";

const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const SECRET = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const TRACE = "a".repeat(32);
const ACCOUNT: OpenAccount = { ref: "#Space_Claude", driver: "claude_code", kind: "subscription", payer: "usr_dana" };
const value = (v: string, itemId: string): Lookup => ({ kind: "value", itemId, value: v, spaceOnly: false, injectIntoDeployments: false });

function rig() {
  const minted: Array<{ principal: string; actingFor: string; threadId: string; sessionId: string }> = [];
  const pids: number[] = [];
  const local = createLocalLauncher({ wrap: (argv) => [process.execPath, FAKE_CLI, ...argv], baseEnv: { PATH: process.env["PATH"] ?? "" } });
  const launcher: Launcher = { async spawn(spec) { const p = await local.spawn(spec); if (p.pid !== undefined) pids.push(p.pid); return p; } };
  const source: ValueSource = { lookup: async () => value(SECRET, "vit_claude") };
  let n = 0;
  const mcp: McpPort = {
    async mint(i) { n += 1; minted.push({ principal: i.principal, actingFor: i.actingFor, threadId: i.threadId, sessionId: `ses_${n}` }); return { sessionId: `ses_${n}`, sessionToken: `vys_token_${n}_0123456789abcdef0123456789`, url: "http://127.0.0.1:41800/mcp", expiresAt: 9_999_999_999_999 }; },
    async close() {},
  };
  const opener: SessionOpener = createSessionOpener({ source, reportMiss: () => undefined, launcher, mcp, apiContext: () => ctx(), cli: { graceMs: 400 } });
  const engine = createTurnEngine({ holder: "host:s", openSession: (spec: SessionSpec) => opener.openSession({ ...spec, account: ACCOUNT, turnId: "turn_1", traceId: TRACE } as SessionSpec) });
  return { opener, engine, minted, pids };
}
const agent: EngineAgent = { id: "intake", mode: "lead", model: "sonnet", accountRef: "#Space_Claude" };
const person = (g: ReturnType<typeof rig>, thread: string, id: string, body: string) => g.engine.receive({ threadId: thread, author: { kind: "person", id }, body });

test("CLI: in one chat Dana and Eli take turns: each gets a session minted for them, never the other's, and a person's own session is reused only for that person", async () => {
  const g = rig();
  g.engine.openThread({ id: "T1", kind: "chat", starter: "usr_dana", agents: [agent] });
  person(g, "T1", "usr_dana", "hello"); await g.engine.idle("T1");
  person(g, "T1", "usr_eli", "hello"); await g.engine.idle("T1");
  person(g, "T1", "usr_dana", "hello"); await g.engine.idle("T1");
  person(g, "T1", "usr_eli", "hello"); await g.engine.idle("T1");
  const turns = g.engine.turns("T1").filter((t) => t.state === "completed");
  assert.deepEqual(turns.map((t) => t.asker), ["usr_dana", "usr_eli", "usr_dana", "usr_eli"], "each turn is its typer's");
  assert.deepEqual(g.minted.map((m) => m.actingFor), ["usr_dana", "usr_eli"], "one session per person, minted for that person: no session was minted for one person and used for another");
  assert.equal(new Set(g.pids).size, 2, `two engine processes, one per person: ${JSON.stringify(g.pids)}`);
  assert.ok(g.minted.every((m) => m.principal === "intake" && m.threadId === "T1"));
  await g.opener.close();
});

test("CLI: a wake of the chat after another person's turn runs for the chat's starter, and a routine for the person who set it, never for whoever typed last", async () => {
  const g = rig();
  g.engine.openThread({ id: "T1", kind: "chat", starter: "usr_dana", agents: [agent] });
  person(g, "T1", "usr_eli", "hello"); await g.engine.idle("T1");
  g.engine.wake("T1", "intake"); await g.engine.idle("T1");                                    // a wake: the starter's
  g.engine.wake("T1", "intake", { routine: true, from: "usr_eli" }); await g.engine.idle("T1");   // a routine Eli set: Eli's
  g.engine.wake("T1", "intake", { routine: true, from: "usr_dana" }); await g.engine.idle("T1");  // a routine Dana set (she started the chat)
  assert.deepEqual(g.engine.turns("T1").filter((t) => t.state === "completed").map((t) => t.asker), ["usr_eli", "usr_dana", "usr_eli", "usr_dana"]);
  for (const m of g.minted) assert.ok(["usr_dana", "usr_eli"].includes(m.actingFor));
  assert.deepEqual([...new Set(g.minted.map((m) => m.actingFor))].sort(), ["usr_dana", "usr_eli"]);
  assert.equal(g.minted.length, 2, "and each person's session is reused for their own turns");
  await g.opener.close();
});

test("API engine: every tool call is built from the running turn's asker, whoever typed before", async () => {
  const seen: Array<{ asker: string; agent: string; thread: string }> = [];
  const callTool: ToolRunner = async (_call, c) => { seen.push({ asker: c.asker, agent: c.agentId, thread: c.threadId }); return { ok: true, content: { data: "done" } }; };
  // a turn calls one tool, then answers once the result is back (the script runs per provider call: a tool result makes the second)
  const called = new Set<string>();
  const p = scriptedProvider({ script: (input) => { const key = String(input.trigger?.id ?? ""); if (called.has(key)) return [{ type: "text", text: "ok" }, { type: "done" }]; called.add(key); return [{ type: "tool_call", id: `c_${key}`, name: "probe", input: {} }, { type: "done" }]; } });
  const engine = createTurnEngine({ holder: "host:s", callTool, openSession: p.openSession });
  engine.openThread({ id: "T1", kind: "chat", starter: "usr_dana", agents: [agent] });
  for (const who of ["usr_dana", "usr_eli", "usr_dana", "usr_eli"]) { engine.receive({ threadId: "T1", author: { kind: "person", id: who }, body: "probe" }); await engine.idle("T1"); }
  assert.deepEqual(seen.map((s) => s.asker), ["usr_dana", "usr_eli", "usr_dana", "usr_eli"], JSON.stringify(engine.turns("T1").map((t) => [t.asker, t.state, t.error])));
});
