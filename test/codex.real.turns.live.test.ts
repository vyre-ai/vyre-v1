// Codex for real: a plain question, a turn that uses tools, a conversation that resumes the same session, and a long output.
// Runs only when VYRE_TEST_CODEX_HOME names a signed-in Codex home; otherwise every test here is SKIPPED with that reason, never passed. See test/support/codex-real.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openMcpBridge } from "../modules/engine/mcp-bridge.ts";
import { answer, collect, driverCaller, errors, open, opts, say, startMcp, toolNames, work } from "./support/codex-real.ts";
import type { DriverEvent } from "../agent/src/turn-engine/types.ts";

test("(a) a plain question on Auto is answered, with usage, and ends done", opts, async () => {
  const s = await open("");
  const ev = await collect(s.send(say("What is 2+3? Answer with just the number.")));
  assert.deepEqual(errors(ev), []);
  assert.match(answer(ev), /\b5\b|five/i);
  assert.ok(ev.some((e) => e.type === "usage"), "usage was reported");
  assert.equal(ev.at(-1)?.type, "done");
  await s.close();
});

test("(b) a turn that uses tools: runs a shell command, reads a file and writes a file in the work folder", opts, async () => {
  fs.writeFileSync(path.join(work, "in.txt"), "the secret word is PELICAN\n");
  const s = await open("");
  const ev = await collect(s.send(say("Run the shell command `echo vyre-shell-ok`, then read the file in.txt, then create a file named out.txt in the current folder containing exactly the secret word from in.txt in lower case. Then say done.")));
  assert.deepEqual(errors(ev), []);
  assert.ok(toolNames(ev).includes("command"), `a shell command ran: ${toolNames(ev)}`);
  assert.equal(fs.readFileSync(path.join(work, "out.txt"), "utf8").trim().toLowerCase(), "pelican");
  assert.equal(ev.at(-1)?.type, "done");
  await s.close();
});

test("(c) a second turn resumes the same Codex session and remembers the first", opts, async () => {
  const s = await open("");
  const one = await collect(s.send(say("Remember this code word: MARIGOLD. Reply only ok.", "m1")));
  assert.deepEqual(errors(one), []);
  const id = (await s.checkpoint()).sessionId;
  assert.ok(id, "the thread id was learned");
  const two = await collect(s.send(say("What was the code word? One word.", "m2")));
  assert.deepEqual(errors(two), []);
  assert.match(answer(two), /marigold/i);
  assert.equal((await s.checkpoint()).sessionId, id, "same session");
  assert.deepEqual(s.stats(), { spawns: 2, resumes: 1, turns: 2 });
  await s.close();
  // a new driver session that is handed the id (a restart) continues it too
  const s2 = await open("", { resume: () => id });
  const three = await collect(s2.send(say("Once more: the code word? One word.", "m3")));
  assert.deepEqual(errors(three), []);
  assert.match(answer(three), /marigold/i);
  await s2.close();
});

test("(f) a long output comes through whole", opts, async () => {
  const s = await open("");
  const ev = await collect(s.send(say("Print the numbers from 1 to 300, one per line, in your answer. Nothing else.")));
  assert.deepEqual(errors(ev), []);
  const nums = answer(ev).split(/\s+/).filter((x) => /^\d+$/.test(x)).map(Number);
  assert.ok(nums.includes(1) && nums.includes(150) && nums.includes(300), `got ${nums.length} numbers`);
  assert.equal(ev.at(-1)?.type, "done");
  await s.close();
});

test("(l) a Vyre tool: Codex calls it through the MCP server with the session token, as the agent for the asker", opts, async () => {
  const token = "tok-real-mcp-0123456789abcdef";
  const rig = await startMcp({ [token]: driverCaller() });
  const s = await open("", { mcp: async () => ({ url: rig.url, token }) });
  try {
    const ev = await collect(s.send(say("Call the vyre tool named schema_describe once, then say in one short sentence that you did.")));
    assert.deepEqual(errors(ev), []);
    assert.ok(rig.calls.some((c) => c.tool === "schema_describe" && c.outcome === "ok"), `the MCP server saw the call: ${JSON.stringify(rig.calls)}`);
    assert.ok(toolNames(ev).some((n) => /schema_describe/.test(n)), `activity shows it: ${toolNames(ev)}`);
    assert.equal(rig.invokes[0]?.principal, "agt_intake");
    assert.equal(rig.invokes[0]?.actingFor, "per_dana");
    assert.equal(ev.at(-1)?.type, "done");
  } finally { await s.close(); await rig.close(); }
});

test("(m) a Vyre tool through the stdio shim and a socket in the scratch folder, the way a sandboxed Codex reaches Vyre", opts, async () => {
  const token = "tok-real-shim-0123456789abcdef";
  const rig = await startMcp({ [token]: driverCaller() });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-codex-scratch-"));
  const bridge = await openMcpBridge({ url: rig.url, token }, { scratch });
  const s = await open("", { mcp: async () => ({ url: "", token, stdio: bridge.stdio }) });
  try {
    const ev = await collect(s.send(say("Call the vyre tool named schema_describe once, then say in one short sentence that you did.")));
    assert.deepEqual(errors(ev), []);
    assert.ok(rig.calls.some((c) => c.tool === "schema_describe" && c.outcome === "ok"), `the MCP server saw the call through the shim: ${JSON.stringify(rig.calls)}`);
    assert.equal(rig.invokes[0]?.actingFor, "per_dana");
    assert.equal(ev.at(-1)?.type, "done");
  } finally { await s.close(); await bridge.close(); await rig.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
});
