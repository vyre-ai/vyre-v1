// @nocache  (these tests start real processes and read fixture files that are not imports, so a pass is never reused from the cache)
// One-shot CLI sessions (Codex, Grok Build): each turn is a process that ends with the turn; the engine's own session id carries the conversation, so the next turn starts the CLI with
// resume. Plus the launcher and the probe, which are the same for all three: the environment a process sees, a program that is not there, and "test this engine".
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver, createCliDrivers, createLocalLauncher, lines } from "../src/drivers/cli/index.ts";
import {
  alive, collect, driverDeps, fakeLauncher, kinds, message, newSpy, specOf, texts, turnOf, until, FAKE_CLI,
} from "../fixtures/golden-streams/rig.ts";

test("codex: a turn is a process; the thread id from the first turn is passed as resume to the second, and each process is gone when its turn ends", async () => {
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy)).open(specOf());
  assert.equal(spy.launches.length, 0, "nothing runs until there is something to say");
  assert.equal(session.warm, false);

  const one = await collect(session.send(turnOf("text")));
  assert.deepEqual(kinds(one), ["thinking", "text", "usage", "done"]);
  assert.deepEqual(one.find((e) => e.type === "usage"), { type: "usage", inputTokens: 1200, outputTokens: 18 });
  assert.equal(session.warm, true, "the thread id is known: the next turn resumes it");
  const first = session.pid;
  assert.equal(first, undefined, "no process is left running");

  const two = await collect(session.send(turnOf("text")));
  assert.equal(two.at(-1)?.type, "done");
  assert.equal(spy.launches.length, 2);
  const id = (await session.checkpoint()).sessionId;
  assert.ok(id);
  const argv = spy.launches[1] ?? [];
  assert.deepEqual(argv.slice(argv.indexOf("resume"), argv.indexOf("resume") + 3), ["resume", id, "-"]);
  assert.equal(spy.launches[0]?.includes("resume"), false);
  assert.deepEqual(session.stats(), { spawns: 2, resumes: 1, turns: 2 });
  await session.close();
});

test("codex: the prompt arrives on stdin as plain text, and the first one carries the agent's guide because Codex has no flag for it", async () => {
  const spy = newSpy();
  const driver = createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy, { system: () => "You are Intake." }));
  const session = await driver.open(specOf());
  await collect(session.send(turnOf("text")));
  await collect(session.send(turnOf("text")));
  assert.deepEqual(spy.writes, ["You are Intake.\n\ntext", "text"]);
  await session.close();
});

test("grok: same shape, resumed with --resume, with the person's other MCP configs switched off in its environment", async () => {
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.grok, driverDeps(spy)).open(specOf());
  const events = await collect(session.send(turnOf("text")));
  assert.deepEqual(texts(events), ["Hello from ", "Grok."]);
  await collect(session.send(turnOf("text")));
  const argv = spy.launches[1] ?? [];
  assert.equal(argv[argv.indexOf("--resume") + 1], (await session.checkpoint()).sessionId);
  assert.equal(spy.envs[0]?.["GROK_CLAUDE_MCPS_ENABLED"], "0");
  assert.equal(spy.envs[0]?.["GROK_CURSOR_MCPS_ENABLED"], "0");
  await session.close();
});

test("steering a one-shot engine: a message injected during the turn becomes the next turn of the same send, resumed", async () => {
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy)).open(specOf());
  const turn = collect(session.send(turnOf("slow 300")));
  await until(() => spy.writes.length === 1);
  session.inject(message("text", "m2"));
  const events = await turn;
  assert.deepEqual(texts(events), ["Hello from Codex.", "Hello from Codex."]);
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.equal(spy.launches.length, 2);
  assert.ok(spy.launches[1]?.includes("resume"));
  assert.equal(spy.writes[1], "text");
  await session.close();
});

test("a steering message sent while no turn runs is read with the next one", async () => {
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy)).open(specOf());
  session.inject(message("also the fax", "m2", { author: { kind: "person", id: "per_sam" } }));
  await collect(session.send(turnOf("text")));
  assert.equal(spy.writes[0], "per_sam: also the fax\n\ntext");
  await session.close();
});

test("codex: a rejected sign-in is provider.auth_failed; an MCP server that did not start stops the turn", async () => {
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy)).open(specOf());
  const bad = await collect(session.send(turnOf("authfail")));
  assert.deepEqual(bad, [{ type: "error", code: "provider.auth_failed", message: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header" }]);
  const nomcp = await collect(session.send(turnOf("mcpfail")));
  assert.deepEqual(nomcp, [{ type: "error", code: "engine.mcp_failed", message: "Vyre's tools did not connect to the engine." }]);
  await session.close();
});

test("a one-shot engine that crashes reports what it said on stderr, and its process is gone", async () => {
  const session = await createCliDriver(CLI_ADAPTERS.grok, driverDeps(newSpy())).open(specOf());
  const events = await collect(session.send(turnOf("die")));
  assert.deepEqual(events, [{ type: "error", code: "engine.cli_error", message: "boom: the engine crashed" }]);
  await session.close();
});

test("the launcher passes the environment it was given and nothing of the host's: not the host's keys, not its tokens", async () => {
  process.env["VYRE_TEST_HOST_SECRET"] = "must-not-leak";
  try {
    const spy = newSpy();
    const session = await createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy, { env: () => ({ HTTPS_PROXY: "http://127.0.0.1:3128" }) })).open(specOf());
    const events = await collect(session.send(turnOf("env")));
    const names = (texts(events)[0] ?? "").split(",");
    assert.ok(names.includes("PATH"));
    assert.ok(names.includes("VYRE_MCP_TOKEN"), "the session token arrives by environment");
    assert.ok(names.includes("HTTPS_PROXY"), "the sandbox's proxy variables arrive");
    assert.equal(names.includes("VYRE_TEST_HOST_SECRET"), false);
    assert.equal(names.filter((n) => /KEY|SECRET|TOKEN/.test(n)).join(","), "VYRE_MCP_TOKEN");
    await session.close();
  } finally {
    delete process.env["VYRE_TEST_HOST_SECRET"];
  }
});

test("a program that is not installed is engine.cli_missing; probe reports it, and reports a working one with its model count", async () => {
  const missing = createLocalLauncher({ wrap: () => ["/nonexistent/vyre-no-such-cli"] });
  const driver = createCliDriver(CLI_ADAPTERS.codex, { launcher: missing, mcp: async () => ({ url: "http://127.0.0.1:1/mcp", token: "tok-0123456789" }) });
  const bad = await driver.probe({ ref: "#K" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error?.code, "engine.cli_missing");

  const spy = newSpy();
  for (const d of createCliDrivers(driverDeps(spy))) {
    const r = await d.probe({ ref: "#K" });
    assert.deepEqual(r, { ok: true, models: CLI_ADAPTERS[d.id].models.length }, d.id);
    assert.ok((await d.models({ ref: "#K" })).length > 0);
  }
  assert.deepEqual(spy.launches.map((a) => a.slice(0, 2)), [["claude", "--version"], ["codex", "--version"], ["grok", "--version"]]);
  assert.equal(FAKE_CLI.endsWith("fake-cli.mjs"), true);
});

test("a launcher with its own wrap runs the program inside it: the wrapper sees the whole argv, the process still ends on stop", async () => {
  const seen: string[][] = [];
  const launcher = createLocalLauncher({ wrap: (argv) => { seen.push([...argv]); return [process.execPath, FAKE_CLI, ...argv]; } });
  const proc = await launcher.spawn({ argv: ["claude", "-p"], env: {} });
  assert.deepEqual(seen, [["claude", "-p"]]);
  const pid = proc.pid;
  assert.ok(pid !== undefined && alive(pid));
  proc.kill("SIGKILL");
  await proc.exited;
  assert.equal(alive(pid), false);
});

test("the spy launcher used by these tests is the real launcher plus a recording of writes", async () => {
  const spy = newSpy();
  const proc = await fakeLauncher(spy).spawn({ argv: ["codex", "exec", "--json", "-"], env: { VYRE_MCP_TOKEN: "t-0123456789" } });
  await proc.write("text");
  proc.endInput();
  const out: string[] = [];
  for await (const l of lines(proc.stdout)) out.push(l);
  const exit = await proc.exited;
  assert.equal(out.length, 5, "the codex-text stream");
  assert.equal(exit.code, 0);
  assert.deepEqual(spy.writes, ["text"]);
});
