// How the Docker host asks agentd to run a tool (P-L2_16b): one `docker exec <container> /opt/agentd/ctl tool '<json>'`, the answer is the JSON object on stdout, a refusal is {"code","message"} on
// stderr with a non-zero exit, a call that takes too long is a timeout whatever agentd does, and a call too large for one argument is refused before it is sent. The tools themselves on top of
// this host, against a scripted Engine, are the last test here; the real Engine is tools.heavy.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import type { DockerApi } from "../../../sandbox/src/docker.ts";
import { AGENTD_CTL, createDockerComputerHost, toolErrorOf } from "../impl.ts";
import { ToolError } from "../handlers/tools/common.ts";
import { provision, wake } from "../handlers/lifecycle.ts";
import { bindHost } from "../projections.ts";
import { codeOf, harness, INTAKE } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

type Exec = { exitCode: number | null; stdout: string; stderr: string };
interface Seen { name: string; cmd: readonly string[]; user?: string }

function engine(onTool: (body: { tool: string; args: Record<string, unknown>; timeoutMs: number }) => Exec | Promise<Exec>) {
  const seen: Seen[] = [];
  const running = new Set<string>();
  const api: DockerApi = {
    async ping() { return true; },
    async imageExists() { return true; },
    async networkCreate() { throw new Error("computers do not make networks"); },
    async networkRemove() { throw new Error("computers do not make networks"); },
    async containerCreate(name) { return `id-${name}`; },
    async containerStart(id) { running.add(id); },
    async containerStop(id) { running.delete(id); },
    async containerRemove(id) { running.delete(id); },
    async containerRunning(id) { return running.has(id); },
    async exec(name, a) {
      seen.push({ name, cmd: a.cmd, ...(a.user ? { user: a.user } : {}) });
      if (a.cmd[0] === AGENTD_CTL && a.cmd[1] === "tool") return onTool(JSON.parse(String(a.cmd[2])));
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
    async putArchive() {},
  };
  return { api, seen };
}
const ARGS = { computerId: "cmt_abc", tool: "chrome_state", args: { tabId: "t1" }, timeoutMs: 1000 };

test("a tool is one exec of the control program with the tool, its arguments and its time, and the stdout object is the answer", async () => {
  const e = engine(() => ({ exitCode: 0, stdout: '{"url":"https://example.com/","title":"T","loading":false}\n', stderr: "" }));
  const host = createDockerComputerHost({ api: e.api, user: { uid: 10001, gid: 10001 } });
  const out = await host.tool(ARGS);
  assert.deepEqual(out, { url: "https://example.com/", title: "T", loading: false });
  assert.equal(e.seen.length, 1);
  assert.equal(e.seen[0]?.name, "vyre-comp-abc");
  assert.deepEqual(e.seen[0]?.cmd.slice(0, 2), [AGENTD_CTL, "tool"]);
  assert.deepEqual(JSON.parse(String(e.seen[0]?.cmd[2])), { tool: "chrome_state", args: { tabId: "t1" }, timeoutMs: 1000 });
  assert.equal(e.seen[0]?.user, "10001:10001", "as the agent's own user, not root");
  const empty = createDockerComputerHost({ api: engine(() => ({ exitCode: 0, stdout: "", stderr: "" })).api });
  assert.deepEqual(await empty.tool(ARGS), {}, "no output is an empty answer");
});

test("a refusal printed by agentd keeps its code and words; anything else is an unavailable computer", async () => {
  for (const code of ["timeout", "paused", "not_found", "bad_input", "held", "unavailable"] as const) {
    const host = createDockerComputerHost({ api: engine(() => ({ exitCode: 3, stdout: "", stderr: `noise\n${JSON.stringify({ code, message: `said ${code}` })}\n` })).api });
    await assert.rejects(() => host.tool(ARGS), (e) => e instanceof ToolError && e.code === code && e.message === `said ${code}`);
  }
  const odd = toolErrorOf("Segmentation fault", 139);
  assert.equal(odd.code, "unavailable");
  assert.match(odd.message, /139/);
  assert.match(odd.message, /Segmentation fault/);
  assert.equal(toolErrorOf(JSON.stringify({ code: "made_up", message: "x" }), 1).code, "unavailable", "an unknown code is not trusted");
  assert.equal(toolErrorOf(JSON.stringify({ code: "paused" }), 1).message, "The tool failed.");
  assert.equal(toolErrorOf("", null).code, "unavailable");
});

test("an answer that is not a JSON object is a fault, not a result", async () => {
  for (const stdout of ["not json", "[1,2]", "null", '"text"', "42"]) {
    const host = createDockerComputerHost({ api: engine(() => ({ exitCode: 0, stdout, stderr: "" })).api });
    await assert.rejects(() => host.tool(ARGS), (e) => e instanceof ToolError && e.code === "unavailable", stdout);
  }
});

test("a call that takes longer than its time plus the margin is a timeout whatever agentd is doing", async () => {
  const e = engine(() => new Promise<Exec>(() => {}));
  const host = createDockerComputerHost({ api: e.api });
  const t0 = Date.now();
  await assert.rejects(() => host.tool({ ...ARGS, timeoutMs: 0 }), (err) => err instanceof ToolError && err.code === "timeout" && /chrome_state/.test(err.message));
  assert.ok(Date.now() - t0 >= 4_000 && Date.now() - t0 < 12_000, `waited the 5 s margin (${Date.now() - t0} ms)`);
});

test("a call too large for one exec argument is refused before it is sent", async () => {
  const e = engine(() => ({ exitCode: 0, stdout: "{}", stderr: "" }));
  const host = createDockerComputerHost({ api: e.api });
  await assert.rejects(() => host.tool({ ...ARGS, args: { content: "x".repeat(130_000) } }), (err) => err instanceof ToolError && err.code === "bad_input");
  assert.equal(e.seen.length, 0);
  await host.tool({ ...ARGS, args: { content: "x".repeat(100_000) } });
  assert.equal(e.seen.length, 1);
});

test("the tools run through the handlers on the Docker host: wake, a tool, and a refusal told as the error it is", async () => {
  const answers: Record<string, (args: Record<string, unknown>) => Exec> = {
    chrome_state: () => ({ exitCode: 0, stdout: '{"url":"https://example.com/","title":"T","loading":false}', stderr: "" }),
    chrome_click: () => ({ exitCode: 2, stdout: "", stderr: '{"code":"paused","message":"Esc was pressed"}' }),
  };
  const e = engine((b) => answers[b.tool]?.(b.args) ?? { exitCode: 2, stdout: "", stderr: JSON.stringify({ code: "not_found", message: `no tool ${b.tool}` }) });
  const host = createDockerComputerHost({ api: e.api });
  const h = harness();
  bindHost(host);
  const made = await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" });
  const id = made.computer.computerId;
  await wake(h.ctx, { computerId: id }).catch(() => undefined);
  const state = await tool["computers.chrome.state"]!(h.ctx, { computerId: id });
  assert.equal(state.title, "T");
  await assert.rejects(() => tool["computers.chrome.click"]!(h.ctx, { computerId: id, ref: "e1" }), (err) => codeOf(err) === "provider.unavailable");
  await assert.rejects(() => tool["computers.screen.key"]!(h.ctx, { computerId: id, combo: "F5" }), (err) => codeOf(err) === "validation.not_found");
  assert.equal(e.seen.filter((s) => s.cmd[1] === "tool").length, 3);
  bindHost(null);
});
