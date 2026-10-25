// @nocache  (these tests start real processes and read fixture files that are not imports, so a pass is never reused from the cache)
// A persistent CLI session (Claude Code): the same process answers every turn, a dead process is replaced by one that resumes the engine's session, steering goes straight to the running
// process, and every way a turn can fail is an event with a code, never a hang. Real processes (agent/fixtures/golden-streams/fake-cli.mjs), no mocks of the driver.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, LaunchError, createCliDriver } from "../src/drivers/cli/index.ts";
import type { CliDriverDeps } from "../src/drivers/cli/index.ts";
import { createPool, poolOpenSession } from "../src/pool/index.ts";
import {
  alive, collect, driverDeps, kinds, message, newSpy, sleep, specOf, texts, turnOf, until,
} from "../fixtures/golden-streams/rig.ts";

const claude = (spy = newSpy(), over: Partial<CliDriverDeps> = {}) => createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy, over));

test("warm reuse: the process starts when the session opens, answers turn after turn, and is the same process each time", async () => {
  const spy = newSpy();
  const session = await claude(spy).open(specOf());
  const pid = session.pid;
  assert.ok(pid !== undefined && alive(pid));
  assert.equal(spy.launches.length, 1, "started at open, before the first message");
  assert.equal(session.warm, true);

  const one = await collect(session.send(turnOf("text")));
  assert.deepEqual(kinds(one), ["text", "text", "usage", "done"]);
  assert.deepEqual(texts(one), ["Hello", " from Claude."]);
  assert.deepEqual(one.find((e) => e.type === "usage"), { type: "usage", inputTokens: 112, outputTokens: 6 });

  const two = await collect(session.send(turnOf("text")));
  assert.equal(two.at(-1)?.type, "done");
  assert.equal(session.pid, pid, "the same process answered the second turn");
  assert.deepEqual(session.stats(), { spawns: 1, resumes: 0, turns: 2 });
  assert.equal(spy.launches.length, 1);
  await session.close();
  await until(() => !alive(pid));
});

test("the user's words go to the process as one JSON message per turn; the engine's own session holds the rest", async () => {
  const spy = newSpy();
  const session = await claude(spy).open(specOf());
  await collect(session.send(turnOf("text")));
  await collect(session.send(turnOf("text", { history: [message("text", "m1")] })));
  assert.equal(spy.writes.length, 2);
  for (const w of spy.writes) assert.equal(JSON.parse(w).message.content[0].text, "text");
  await session.close();
});

test("a process that died between turns is replaced by one started with --resume <the engine's session id>", async () => {
  const spy = newSpy();
  const session = await claude(spy).open(specOf());
  await collect(session.send(turnOf("text")));
  const first = (await session.checkpoint()).sessionId;
  const pid = session.pid;
  assert.ok(pid !== undefined && first !== null);
  process.kill(pid, "SIGKILL");
  await until(() => !session.warm);

  const events = await collect(session.send(turnOf("text")));
  assert.equal(events.at(-1)?.type, "done");
  assert.notEqual(session.pid, pid);
  const argv = spy.launches[1] ?? [];
  assert.equal(argv[argv.indexOf("--resume") + 1], first);
  assert.deepEqual(session.stats(), { spawns: 2, resumes: 1, turns: 2 });
  await session.close();
});

test("steering: a message injected during a turn goes to the running process and earns its own reply in the same send", async () => {
  const spy = newSpy();
  const session = await claude(spy).open(specOf());
  const turn = collect(session.send(turnOf("slow 300")));
  await until(() => spy.writes.length === 1);
  session.inject(message("text", "m2"));
  const events = await turn;
  assert.equal(spy.writes.length, 2);
  assert.equal(JSON.parse(spy.writes[1] ?? "{}").message.content[0].text, "text");
  assert.deepEqual(texts(events), ["Hello", " from Claude.", "Hello", " from Claude."]);
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.equal(events.at(-1)?.type, "done");
  await session.close();
});

test("a message from someone else injected into a turn names its author", async () => {
  const spy = newSpy();
  const session = await claude(spy).open(specOf());
  const turn = collect(session.send(turnOf("slow 300")));
  await until(() => spy.writes.length === 1);
  session.inject(message("text", "m2", { author: { kind: "person", id: "per_sam" } }));
  await turn;
  assert.equal(JSON.parse(spy.writes[1] ?? "{}").message.content[0].text, "per_sam: text");
  await session.close();
});

test("a sign-in that is gone is provider.auth_failed (the backup key's cue) and the session stays usable", async () => {
  const spy = newSpy();
  const session = await claude(spy).open(specOf());
  const bad = await collect(session.send(turnOf("authfail")));
  assert.deepEqual(bad, [{ type: "error", code: "provider.auth_failed", message: "Invalid API key · Please run /login" }]);
  const pid = session.pid;
  const ok = await collect(session.send(turnOf("text")));
  assert.equal(ok.at(-1)?.type, "done");
  assert.equal(session.pid, pid);
  await session.close();
});

test("a turn limit is engine.step_limit, with the tokens it used", async () => {
  const session = await claude().open(specOf());
  const events = await collect(session.send(turnOf("maxturns")));
  assert.deepEqual(events, [{ type: "usage", inputTokens: 900, outputTokens: 120 }, { type: "error", code: "engine.step_limit", message: "error_max_turns" }]);
  await session.close();
});

test("Vyre's tools not connecting ends the turn at once and stops the process", async () => {
  const session = await claude().open(specOf());
  const pid = session.pid;
  const events = await collect(session.send(turnOf("mcpfail")));
  assert.deepEqual(events, [{ type: "error", code: "engine.mcp_failed", message: "Vyre's tools did not connect to the engine." }]);
  assert.ok(pid !== undefined);
  await until(() => !alive(pid));
  assert.equal(session.warm, false);
  await session.close();
});

test("a process that crashes mid-turn gives an error with what it said on stderr, never a hang", async () => {
  const session = await claude().open(specOf());
  const events = await collect(session.send(turnOf("die")));
  assert.deepEqual(events, [{ type: "error", code: "engine.cli_error", message: "boom: the engine crashed" }]);
  assert.equal(session.warm, false);
  await session.close();
});

test("a process that goes quiet is cut off after the idle time with engine.timeout", async () => {
  const spy = newSpy();
  const session = await claude(spy, { idleMs: 300 }).open(specOf());
  const pid = session.pid;
  const events = await collect(session.send(turnOf("hang")));
  assert.deepEqual(events, [{ type: "error", code: "engine.timeout", message: "The engine stopped answering." }]);
  assert.ok(pid !== undefined);
  await until(() => !alive(pid));
  await session.close();
});

test("a second send while one is running is refused, a closed session says so, and close is safe twice", async () => {
  const session = await claude().open(specOf());
  const first = collect(session.send(turnOf("slow 200")));
  await sleep(50);
  const second = await collect(session.send(turnOf("text")));
  assert.deepEqual(second, [{ type: "error", code: "engine.busy", message: "This session is already answering." }]);
  assert.equal((await first).at(-1)?.type, "done");
  await session.close();
  await session.close();
  assert.deepEqual(await collect(session.send(turnOf("text"))), [{ type: "error", code: "engine.closed", message: "This session is closed." }]);
});

test("the MCP session is released when the session closes, and a program that is not installed is a driver error at open", async () => {
  const spy = newSpy();
  const closed: string[] = [];
  const driver = claude(spy, { mcpClose: (s) => { closed.push(s.threadId); } });
  const session = await driver.open(specOf({}, "thr_7"));
  await session.close();
  assert.deepEqual(closed, ["thr_7"]);

  const missing = createCliDriver(CLI_ADAPTERS.claude_code, { ...driverDeps(spy), launcher: { spawn: async () => { throw new LaunchError("engine.cli_missing", "claude is not installed here."); } } });
  await assert.rejects(missing.open(specOf()), (e: Error & { code?: string }) => e.code === "engine.cli_missing");
});

test("the pool keeps a CLI session warm for the next turn of its thread: acquire again is a hit on the same process", async () => {
  const spy = newSpy();
  const driver = claude(spy);
  const pool = createPool({ placement: "device", drivers: [driver] });
  const spec = specOf();
  const ps = { key: { driver: "claude_code", accountRef: "#Dana_Claude", model: "sonnet", sandboxId: "vyre-sbx-dana", mcpProfile: "default" }, threadId: "thr_1", person: "per_dana", session: spec };
  const open = poolOpenSession(pool, () => ps);

  const a = await open(spec);
  assert.equal(a.warm, false, "the first lease opened it");
  await collect(a.send(turnOf("text")));
  await a.close();

  const b = await open(spec);
  assert.equal(b.warm, true, "the second lease is the warm session");
  await collect(b.send(turnOf("text")));
  assert.equal(spy.launches.length, 1);
  await b.close();
  assert.equal(pool.status().sessions.find((s) => s.driver === "claude_code")?.hits, 1);

  // A cancelled session is not given back warm.
  const c = await open(spec);
  const turn = collect(c.send(turnOf("hang")));
  await until(() => spy.writes.length === 3);
  await sleep(100);
  await c.cancel();
  await turn;
  await c.close();
  assert.equal(pool.status().totalWarm, 0);
  await pool.close();
});

test("a hint opens the process ahead of the first message, so the first acquire finds it already running", async () => {
  const spy = newSpy();
  const pool = createPool({ placement: "device", drivers: [claude(spy)] });
  const spec = specOf();
  pool.hint({ key: { driver: "claude_code", accountRef: "#Dana_Claude", model: "sonnet", sandboxId: "s", mcpProfile: "default" }, threadId: "thr_1", person: "per_dana", session: spec });
  await pool.settled();
  assert.equal(spy.launches.length, 1);
  const lease = await pool.acquire({ key: { driver: "claude_code", accountRef: "#Dana_Claude", model: "sonnet", sandboxId: "s", mcpProfile: "default" }, threadId: "thr_1", person: "per_dana", session: spec });
  assert.equal(lease.warm, true);
  assert.equal(spy.launches.length, 1);
  await pool.release(lease);
  await pool.close();
});
