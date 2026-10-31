// A chat pinned to one of the person's servers runs its turn there, on a booted daemon with an enrolled node: the real turn engine, the real session opener (the person's own account filled into the
// engine's environment by the Vault fill), the real relay over the node's live socket, and the fake CLI (host/tests/fixtures/fake-cli-driver) as the model vendor, running on the node. The turn's reply
// is the engine's; the node's job log shows the engine started and ended there, the node id is in the turn record, and the person's key was in the node's process environment and nowhere in what the
// chat or the log kept. A pinned server that is off makes the turn fail with its name and no engine starts anywhere; a chat that is not pinned runs as before.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../../../agent/src/drivers/cli/index.ts";
import { createTurnEngine } from "../../../agent/src/turn-engine/index.ts";
import type { EngineAgent, SessionSpec } from "../../../agent/src/turn-engine/index.ts";
import type { Lookup, ValueSource } from "../../../agent/src/vault-use/index.ts";
import { buildNodeOpener } from "../session.ts";
import { nodeOfTurn, remoteLauncher, routed } from "../node-turns.ts";
import type { NodeRelay } from "../node-turns.ts";
import type { NodeLauncher } from "../../../host/src/compute/node.ts";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import { boot as bootRig, enroll } from "../../../host/tests/node-rig.ts";

const boot = () => bootRig(bootCore);

const FAKE_CLI = fileURLToPath(new URL("../../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const SECRET = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const TRACE = "a".repeat(32);
const AGENT: EngineAgent = { id: "intake", mode: "lead", model: "sonnet", accountRef: "#Dana_Claude" };

/** The node's launcher: the fake CLI in place of the real program, started as the node's sandbox would (nothing of the Space's environment goes in). */
function fakeCliLauncher(seen: { env: Array<Record<string, string>>; cwd: string[] }): NodeLauncher {
  const local = createLocalLauncher({ wrap: (argv) => [process.execPath, FAKE_CLI, ...argv], baseEnv: { PATH: process.env["PATH"] ?? "" } });
  return { async spawn(spec) { seen.env.push({ ...spec.env }); seen.cwd.push(spec.cwd ?? ""); return local.spawn({ argv: spec.argv, env: spec.env, ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}) }); } };
}

const sql = (): { all(sql: string, ...a: unknown[]): unknown[]; run(sql: string, ...a: unknown[]): { changes: number } } => {
  const db = new DatabaseSync(":memory:");
  return { all: (q, ...a) => db.prepare(q).all(...(a as never[])) as unknown[], run: (q, ...a) => ({ changes: Number(db.prepare(q).run(...(a as never[])).changes) }) };
};

test("a turn pinned to an enrolled server runs its engine there; the node id is in the turn record, the job log shows it, and the person's key stays out of what is kept", async () => {
  const { d, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-turn-node-"));
  const log: string[] = [];
  const seen = { env: [] as Array<Record<string, string>>, cwd: [] as string[] };
  const { nodeId, abort, running } = await enroll(d, nodeDir, log, fakeCliLauncher(seen));
  try {
    const value = (v: string, itemId: string): Lookup => ({ kind: "value", itemId, value: v, spaceOnly: false, injectIntoDeployments: false });
    const source: ValueSource = { lookup: async (h) => (h === "#Dana_Claude.setup_token" ? value(SECRET, "vit_claude") : { kind: "unknown" }) };
    const minted: string[] = [];
    const session = { source, reportMiss: () => undefined, mcp: { mint: async (i: { threadId: string }) => { minted.push(i.threadId); return { sessionId: "ses_1", sessionToken: "vys_token_1_0123456789abcdef0123456789", url: "http://127.0.0.1:41800/mcp", expiresAt: 9_999_999_999_999 }; }, close: async () => undefined } };
    const relay: NodeRelay = { spawn: (n, s) => d.nodeRelay.spawnProc(n, s) as never, connected: (n) => d.nodeRelay.connected(n) };
    const nodeOpen = buildNodeOpener({ session, call: async () => ({}) }, remoteLauncher(relay, nodeId));
    const db = sql();
    let pinned: { reason: string; nodeId?: string; wakeLine?: string } = { reason: "chosen_server", nodeId };
    const hostOpened: string[] = [];
    const base = async (): Promise<never> => { hostOpened.push("host"); throw new Error("the Space's own engine must not start"); };
    const openSession = routed(base as never, {
      call: async (cap) => { assert.equal(cap, "engine.placement.decide"); return { placement: "host", ...pinned }; },
      relay, nodeOpener: () => nodeOpen.openSession, db: db as never,
    });
    const engine = createTurnEngine({
      holder: "host:s",
      openSession: (spec: SessionSpec) => openSession({ ...spec, account: { ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "dana", reason: "starter" }, turnId: "turn_node_1", traceId: TRACE } as SessionSpec),
    });
    engine.openThread({ id: "T1", kind: "chat", starter: "dana", agents: [AGENT] });
    engine.receive({ threadId: "T1", author: { kind: "person", id: "dana" }, body: "hello" });
    await engine.idle("T1");
    const turn = engine.turns("T1").at(-1);
    assert.equal(turn?.state, "completed", JSON.stringify(engine.events().filter((e) => e.type === "turn.failed")));
    assert.ok((engine.messages("T1").filter((m) => m.author.kind === "agent").at(-1)?.body ?? "").includes("Hello from the fake engine."), "the reply is the engine's");
    assert.deepEqual(hostOpened, [], "no engine started on the Space");
    assert.equal(nodeOfTurn(db as never, "turn_node_1"), nodeId, "the turn record names the server it ran on");
    await nodeOpen.close();   // the engine stays up between turns; ending the session ends the process on the server
    for (let i = 0; i < 50 && !log.some((l) => /engine prc_[a-f0-9]+ ended: /.test(l)); i++) await new Promise((r) => setTimeout(r, 100));   // the node logs the end a moment after the reply
    assert.ok(log.some((l) => /engine prc_[a-f0-9]+ started: .*/.test(l)) && log.some((l) => /engine prc_[a-f0-9]+ ended: /.test(l)), `the node's log: ${JSON.stringify(log)}`);
    assert.ok(seen.env.some((e) => Object.values(e).includes(SECRET)), "the person's own key was filled into the engine's environment on the server");
    assert.ok(seen.cwd[0]!.startsWith(path.join(nodeDir, "turns")), "the engine worked in a folder of the server's own");
    assert.ok(seen.env.every((e) => Object.values(e).every((v) => !/127\.0\.0\.1:41800/.test(v))), "the Space's loopback address never reached the node's engine");
    const kept = JSON.stringify({ events: engine.events(), messages: engine.messages("T1"), log });
    assert.ok(!kept.includes(SECRET), "the key is in no event, message or log line");

    // the server is off: the turn fails with its name, and no engine starts anywhere
    pinned = { reason: "server_off", nodeId, wakeLine: "relay-box is off" };
    engine.receive({ threadId: "T1", author: { kind: "person", id: "dana" }, body: "again" });
    await engine.idle("T1");
    const failed = engine.events().filter((e) => e.type === "turn.failed").at(-1) as { code?: string } | undefined;
    assert.equal(failed?.code, "engine.server_off");
    assert.equal(seen.env.length, 1, "no second engine started");
    assert.deepEqual(hostOpened, []);
  } finally { abort.abort(); await running.catch(() => undefined); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});
