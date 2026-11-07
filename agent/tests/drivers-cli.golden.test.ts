// @nocache  (these tests start real processes and read fixture files that are not imports, so a pass is never reused from the cache)
// CLI engine drivers against golden streams (ARCH 6.6, spec 4.14, 4.17; S7): the adapters parse the streams of all three CLIs, a tool call makes the round trip through the real MCP server
// with a bearer token (and is refused for a caller without the permission), a session resumes by the engine's session id, and a cancel stops the process.
//
// The streams in agent/fixtures/golden-streams are written to each CLI's documented event schema. The live S7 recording job replaces them with recordings from real accounts; the decoders must
// keep passing on both.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver, createClaudeDecoder, createCodexDecoder } from "../src/drivers/cli/index.ts";
import type { CliAdapter, CliDecoder, CliEvent } from "../src/drivers/cli/index.ts";
import {
  alive, collect, driverCaller, driverDeps, endpoint, fixtureText, kinds, newSpy, sleep, specOf, startMcp, texts, TOKEN, turnOf, until,
} from "../fixtures/golden-streams/rig.ts";

function decode(file: string, decoder: CliDecoder): CliEvent[] {
  const out: CliEvent[] = [];
  for (const line of fixtureText(file).replaceAll("{{SESSION}}", "S1").split("\n")) if (line.trim() !== "") out.push(...decoder.push(line));
  out.push(...decoder.finish());
  return out;
}

const usage = (inputTokens: number, outputTokens: number, more: Partial<Extract<CliEvent, { type: "usage" }>> = {}): CliEvent => ({ type: "usage", inputTokens, outputTokens, ...more });
const S1: CliEvent = { type: "session", id: "S1" };
const MCP_OK: CliEvent = { type: "mcp", status: "ok" };

// ---- decoders on the golden streams

test("claude: a streamed answer is passed on as its deltas, once, with the cache counted into input tokens", () => {
  assert.deepEqual(decode("claude-text", createClaudeDecoder()), [
    S1, MCP_OK, { type: "text", text: "Hello" }, { type: "text", text: " from Claude." }, usage(112, 6, { cacheReadTokens: 100, cacheWriteTokens: 0, costUsd: 0.0012, model: "claude-sonnet-5-5", contextTokens: 112 }), { type: "end" },
  ]);
});

test("claude: a tool result that holds a test run's summary carries those lines, and no other output", () => {
  const d = createClaudeDecoder();
  const line = (content: string): string => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content }] } });
  const run = d.push(line("lots of output\n▶ dates\n✔ adds (1ms)\n✖ date is Thursday (2ms)\nℹ pass 1\nℹ fail 1\nsecret-token-abc"));
  assert.deepEqual(run, [{ type: "tool", phase: "result", id: "t1", ok: true, output: "✖ date is Thursday (2ms)\nℹ pass 1\nℹ fail 1" }]);
  assert.deepEqual(d.push(line("just a file listing")), [{ type: "tool", phase: "result", id: "t1", ok: true }]);
});

test("codex: a command that ran tests carries its command and its summary lines, a plain command carries neither output nor secrets", () => {
  const d = createCodexDecoder();
  const started = { type: "item.started", item: { id: "item_3", type: "command_execution", command: "bash -lc 'node --test dates.test.js'", aggregated_output: "", exit_code: null, status: "in_progress" } };
  const done = { type: "item.completed", item: { id: "item_3", type: "command_execution", command: "bash -lc 'node --test dates.test.js'", aggregated_output: "▶ dates\n✔ adds (1ms)\n✖ date is Thursday (2ms)\nℹ pass 1\nℹ fail 1\nAPI_KEY=abc", exit_code: 1, status: "failed" } };
  assert.deepEqual(d.push(JSON.stringify(started)), [
    { type: "tool", phase: "call", id: "item_3", name: "command" },
    { type: "tool", phase: "input", id: "item_3", detail: "bash -lc 'node --test dates.test.js'" },
  ]);
  assert.deepEqual(d.push(JSON.stringify(done)), [{ type: "tool", phase: "result", id: "item_3", ok: false, output: "✖ date is Thursday (2ms)\nℹ pass 1\nℹ fail 1" }]);
  const plain = { type: "item.completed", item: { id: "item_4", type: "command_execution", command: "ls", aggregated_output: "a.txt\nAPI_KEY=abc", exit_code: 0, status: "completed" } };
  const out = createCodexDecoder().push(JSON.stringify(plain));
  assert.ok(out.every((e) => !("output" in e)));
});

test("claude: a message that came without deltas is passed on whole, its thinking too, and the result line does not repeat it", () => {
  assert.deepEqual(decode("claude-nopartial", createClaudeDecoder()), [
    S1, MCP_OK, { type: "thinking", text: "Short answer." }, { type: "text", text: "Whole message, no deltas." }, usage(8, 5, { model: "claude-sonnet-5-5", contextTokens: 8 }), { type: "end" },
  ]);
});

test("claude: a tool call shows as activity once, its result as ok, and the answer after it streams", () => {
  assert.deepEqual(decode("claude-tool", createClaudeDecoder()), [
    S1, MCP_OK,
    { type: "thinking", text: "Look at the record types." },
    { type: "tool", phase: "call", id: "toolu_01", name: "mcp__vyre__schema_describe" },
    { type: "tool", phase: "result", id: "toolu_01", ok: true },
    { type: "text", text: "Found the types." },
    usage(80, 19, { cacheReadTokens: 0, cacheWriteTokens: 0, model: "claude-sonnet-5-5", contextTokens: 60 }), { type: "end" },
  ]);
});

test("claude: a tool the MCP server refused arrives as a result that is not ok", () => {
  const events = decode("claude-tool-denied", createClaudeDecoder());
  assert.deepEqual(events.filter((e) => e.type === "tool"), [
    { type: "tool", phase: "call", id: "toolu_01", name: "mcp__vyre__schema_describe" },
    { type: "tool", phase: "result", id: "toolu_01", ok: false },
  ]);
  assert.deepEqual(events.filter((e) => e.type === "text"), [{ type: "text", text: "I could not use that tool." }]);
});

test("claude: failures keep the engine's words; a turn limit gets its own code; a Vyre server that did not connect is reported", () => {
  assert.deepEqual(decode("claude-error-auth", createClaudeDecoder()).slice(-1), [{ type: "end", error: { message: "Invalid API key · Please run /login" } }]);
  // a count the engine left out stays out (not reported), and one it gave as 0 is 0
  assert.deepEqual(decode("claude-nopartial", createClaudeDecoder()).find((e) => e.type === "usage"), usage(8, 5, { model: "claude-sonnet-5-5", contextTokens: 8 }));
  assert.deepEqual(decode("claude-max-turns", createClaudeDecoder()).slice(-2), [usage(900, 120, { model: "claude-sonnet-5-5" }), { type: "end", error: { code: "engine.step_limit", message: "error_max_turns" } }]);
  assert.deepEqual(decode("claude-mcp-failed", createClaudeDecoder()), [S1, { type: "mcp", status: "failed", detail: "failed" }]);
});

test("codex: reasoning and messages arrive whole, an MCP call is started and finished, input tokens already include the cache", () => {
  assert.deepEqual(decode("codex-text", createCodexDecoder()), [
    S1, { type: "thinking", text: "Thinking about the greeting." }, { type: "text", text: "Hello from Codex." }, usage(1200, 18, { cacheReadTokens: 1000 }), { type: "end" },
  ]);
  assert.deepEqual(decode("codex-tool", createCodexDecoder()), [
    S1,
    { type: "tool", phase: "call", id: "item_0", name: "vyre.schema_describe" },
    { type: "tool", phase: "result", id: "item_0", ok: true },
    { type: "text", text: "Found the types." },
    usage(2400, 40, { cacheReadTokens: 2000 }), { type: "end" },
  ]);
  assert.deepEqual(decode("codex-tool-denied", createCodexDecoder()).filter((e) => e.type === "tool"), [
    { type: "tool", phase: "call", id: "item_0", name: "vyre.schema_describe" },
    { type: "tool", phase: "result", id: "item_0", ok: false },
  ]);
});

test("codex: a failed turn ends once with the engine's message; an MCP server that did not start is reported and the stream ending after it is an error end", () => {
  // a rejected sign-in is told in plain words, with its code (the vendor's own line, with its URL and request id, is not what a person reads)
  assert.deepEqual(decode("codex-error-auth", createCodexDecoder()), [S1, { type: "end", error: { code: "provider.auth_failed", message: "Codex is signed out, or its sign-in has run out. Sign in again." } }]);
  assert.deepEqual(decode("codex-mcp-failed", createCodexDecoder()), [
    S1,
    { type: "mcp", status: "failed", detail: "MCP client for `vyre` failed to start: connection refused" },
    { type: "end", error: { message: "MCP client for `vyre` failed to start: connection refused" } },
  ]);
});

test("grok: the same schema as Claude Code, read by the same decoder", () => {
  const adapter: CliAdapter = CLI_ADAPTERS.grok;
  assert.deepEqual(decode("grok-text", adapter.decoder()), [
    S1, MCP_OK, { type: "text", text: "Hello from " }, { type: "text", text: "Grok." }, usage(30, 5, { model: "grok-4", contextTokens: 30 }), { type: "end" },
  ]);
  assert.deepEqual(decode("grok-tool", adapter.decoder()).filter((e) => e.type === "tool"), [
    { type: "tool", phase: "call", id: "toolu_01", name: "mcp__vyre__schema_describe" },
    { type: "tool", phase: "result", id: "toolu_01", ok: true },
  ]);
});

test("lines that are not JSON, or of a shape the decoder does not know, cost nothing", () => {
  for (const d of [createClaudeDecoder(), createCodexDecoder()]) {
    assert.deepEqual(d.push("not json at all"), []);
    assert.deepEqual(d.push("[1,2,3]"), []);
    assert.deepEqual(d.push(JSON.stringify({ type: "something.new", payload: 1 })), []);
    assert.deepEqual(d.push(JSON.stringify({ type: "stream_event", event: "odd" })), []);
  }
});

// ---- the round trip through a real process and the real MCP server

for (const [id, ask] of [["claude_code", "tool"], ["codex", "tool"], ["grok", "tool"]] as const) {
  test(`${id}: a tool call goes CLI -> MCP server with the session token -> invoke as the agent for the asker, and the result comes back as activity`, async () => {
    const rig = await startMcp({ [TOKEN]: driverCaller() });
    const spy = newSpy();
    const driver = createCliDriver(CLI_ADAPTERS[id], driverDeps(spy, { mcp: async () => endpoint(rig.url, TOKEN) }));
    const session = await driver.open(specOf({ model: `${id}/x` }));
    try {
      const events = await collect(session.send(turnOf(ask)));
      assert.deepEqual(kinds(events).filter((k) => k.startsWith("block")), ["block:tool_call", "block:tool_result"]);
      const result = events.find((e) => e.type === "block" && e.kind === "tool_result");
      assert.deepEqual(result && result.type === "block" ? (result.payload as { ok: boolean }).ok : null, true);
      assert.deepEqual(texts(events).join(""), "Found the types.");
      assert.equal(events.at(-1)?.type, "done");
      assert.deepEqual(rig.calls, [{ tool: "schema_describe", outcome: "ok" }]);
      assert.equal(rig.invokes.length, 1);
      assert.equal(rig.invokes[0]?.cap, "schema.describe");
      assert.equal(rig.invokes[0]?.principal, "agt_intake");
      assert.equal(rig.invokes[0]?.actingFor, "per_dana");
      // The token reached the process by environment only.
      assert.equal(spy.envs[0]?.["VYRE_MCP_TOKEN"], TOKEN);
      assert.equal(spy.launches.flat().some((a) => a.includes(TOKEN)), false, "the token is in no command line");
    } finally {
      await session.close();
      await rig.close();
    }
  });

  test(`${id}: the same call from an agent that may not use the tool is refused by the MCP server and the invoke pipeline never sees it`, async () => {
    const rig = await startMcp({ [TOKEN]: driverCaller({ rules: { deny: ["records"] } }) });
    const spy = newSpy();
    const driver = createCliDriver(CLI_ADAPTERS[id], driverDeps(spy, { mcp: async () => endpoint(rig.url, TOKEN) }));
    const session = await driver.open(specOf());
    try {
      const events = await collect(session.send(turnOf(ask)));
      const result = events.find((e) => e.type === "block" && e.kind === "tool_result");
      assert.deepEqual(result && result.type === "block" ? (result.payload as { ok: boolean }).ok : null, false);
      assert.deepEqual(texts(events).join(""), "I could not use that tool.");
      assert.deepEqual(rig.calls, [{ tool: "schema_describe", outcome: "error" }]);
      assert.equal(rig.invokes.length, 0);
    } finally {
      await session.close();
      await rig.close();
    }
  });

  test(`${id}: a session token the server does not know is refused at the door (401) and nothing runs`, async () => {
    const rig = await startMcp({ [TOKEN]: driverCaller() });
    const spy = newSpy();
    const driver = createCliDriver(CLI_ADAPTERS[id], driverDeps(spy, { mcp: async () => endpoint(rig.url, "tok-revoked-0123456789") }));
    const session = await driver.open(specOf());
    try {
      const events = await collect(session.send(turnOf(ask)));
      const result = events.find((e) => e.type === "block" && e.kind === "tool_result");
      assert.deepEqual(result && result.type === "block" ? (result.payload as { ok: boolean }).ok : null, false);
      assert.equal(rig.calls.length, 0);
      assert.equal(rig.invokes.length, 0);
      assert.equal(rig.server.sessions(), 0);
    } finally {
      await session.close();
      await rig.close();
    }
  });
}

// ---- resume by session id, cancel

test("resume by session id: the engine's id is learned, kept in the checkpoint, and the next session starts the CLI with it and carries on", async () => {
  const spy = newSpy();
  const first = createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy));
  const a = await first.open(specOf());
  await collect(a.send(turnOf("text")));
  const cp = await a.checkpoint();
  assert.equal(cp.engine, "claude_code");
  assert.match(cp.sessionId ?? "", /^fake-\d+$/);
  await a.close();
  assert.equal(spy.launches[0]?.includes("--resume"), false, "a new session starts without it");

  const second = createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy, { resume: () => cp.sessionId }));
  const b = await second.open(specOf());
  const events = await collect(b.send(turnOf("text")));
  const argv = spy.launches[1] ?? [];
  assert.equal(argv[argv.indexOf("--resume") + 1], cp.sessionId);
  assert.equal(events.at(-1)?.type, "done");
  assert.equal((await b.checkpoint()).sessionId, cp.sessionId, "the fake keeps the id it was resumed with");
  await b.close();
});

for (const id of ["claude_code", "codex", "grok"] as const) {
  test(`${id}: cancel stops the process, ends the turn without an error, and the session can answer again by resuming`, async () => {
    const spy = newSpy();
    const driver = createCliDriver(CLI_ADAPTERS[id], driverDeps(spy));
    const session = await driver.open(specOf());
    const turn = collect(session.send(turnOf("hang")));
    await until(() => spy.writes.length > 0);
    // The resume below needs the engine's session id, which arrives with the process's first line. A fixed pause was too short on a loaded runner; wait for the id itself.
    for (let i = 0; i < 400 && (await session.checkpoint()).sessionId === null; i++) await sleep(25);
    const pid = session.pid;
    await session.cancel();
    assert.deepEqual(await turn, [], "no error and no done after a cancel");
    if (pid !== undefined) await until(() => !alive(pid));
    assert.equal(session.warm && CLI_ADAPTERS[id].persistent, false, "a cancelled persistent session is not warm");

    const events = await collect(session.send(turnOf("text")));
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(spy.launches.length, 2);
    const argv = spy.launches[1] ?? [];
    assert.ok(argv.includes(id === "codex" ? "resume" : "--resume"), "the second process resumes the engine session");
    await session.close();
  });
}
