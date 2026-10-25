// @heavy docker
// A CLI-shaped process started through the engine's sandboxed launcher, on real bubblewrap with the network wall (P-L2_23, S8 review "test the steward needs"): it reads a file in its work
// folder; it cannot read a file in the daemon user's home or a neighbour person's folder; it cannot write outside the work folder; it sees the key and the MCP token; it does not see the
// daemon's other environment. Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job); with it on, a missing bwrap fails the test.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalLauncher } from "../../../agent/src/drivers/cli/launcher.ts";
import { defaultSandbox } from "../sandbox-default.ts";
import type { DefaultSandbox } from "../sandbox-default.ts";
import http from "node:http";
import { openMcpBridge } from "../mcp-bridge.ts";
import { scratchFolder, sandboxWrap, workFolder } from "../sandbox.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1";

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engine-hv-")));
fs.chmodSync(data, 0o755);
const HOME_SECRET = path.join(os.homedir(), `.vyre-engine-hv-${process.pid}`);
let dflt: DefaultSandbox | undefined;
after(async () => { await dflt?.close(); fs.rmSync(HOME_SECRET, { force: true }); fs.rmSync(data, { recursive: true, force: true }); });

async function run(script: string, env: Record<string, string>, thread = "thr_1", argv?: string[], stdin?: string): Promise<{ out: string; code: number | null }> {
  assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bwrap is not installed");
  // the plan a daemon builds for itself on this platform: bwrap with the network wall
  dflt ??= await defaultSandbox({ dataDir: data });
  assert.equal(dflt.plan.sandbox.kind, "bwrap", "the default plan on a Linux runner is bwrap");
  const cwd = workFolder(data, "usr_dana", thread);
  scratchFolder(data, "usr_dana");
  for (const d of [path.join(data, "work"), path.join(data, "work", "usr_dana"), cwd, path.join(data, "scratch"), path.join(data, "scratch", "usr_dana")]) fs.chmodSync(d, 0o777);
  const plan = dflt.plan;
  const launcher = createLocalLauncher({ wrap: sandboxWrap(plan), baseEnv: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" } });
  const p = await launcher.spawn({ argv: argv ?? ["/bin/sh", "-c", script], cwd, env });
  if (stdin !== undefined) { await p.write(stdin); p.endInput(); }
  let out = "";
  for await (const c of p.stdout) out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
  const { code } = await p.exited;
  return { out, code };
}

test("the sandboxed launcher: reads the work folder, cannot read the home or a neighbour, cannot write outside, sees the key and the token and nothing else of the daemon", { skip }, async () => {
  fs.writeFileSync(HOME_SECRET, "home-secret\n");
  const ravi = workFolder(data, "usr_ravi", "thr_9");
  fs.writeFileSync(path.join(ravi, "secret.txt"), "ravi-secret\n");
  fs.writeFileSync(path.join(workFolder(data, "usr_dana", "thr_1"), "hello.txt"), "hello from the work folder\n");
  process.env["DAEMON_ONLY_SECRET"] = "daemon-secret";
  const script = [
    'echo "work=$(cat hello.txt 2>&1)"',
    `echo "home=$(cat ${HOME_SECRET} 2>&1)"`,
    `echo "ravi=$(cat ${path.join(ravi, "secret.txt")} 2>&1)"`,
    'echo "outside=$(touch /usr/vyre-outside 2>&1; echo $?)"',
    `echo "outside2=$(touch ${path.join(data, "outside.txt")} 2>&1; echo $?)"`,
    'echo "key=$CLAUDE_CODE_OAUTH_TOKEN token=$VYRE_MCP_TOKEN daemon=$DAEMON_ONLY_SECRET"',
    'echo "pwd=$(pwd)"',
  ].join("\n");
  const { out } = await run(script, { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-key", VYRE_MCP_TOKEN: "mcp-token" });
  assert.match(out, /work=hello from the work folder/);
  assert.doesNotMatch(out, /home-secret/);
  assert.doesNotMatch(out, /ravi-secret/);
  assert.match(out, /home=.*(No such file|Permission denied)/);
  assert.doesNotMatch(out, /outside=0/);
  assert.doesNotMatch(out, /outside2=0/);
  assert.match(out, /key=sk-ant-key token=mcp-token daemon=\n/);
  assert.doesNotMatch(out, /daemon-secret/);
  assert.match(out, new RegExp(`pwd=${workFolder(data, "usr_dana", "thr_1")}`));
});

test("MCP behind the wall (ruling 61): the CLI calls one tool over the socket shim, the token is checked, and a private address is still unreachable", { skip }, async () => {
  const seen: string[] = [];
  const mcp = http.createServer((q, r) => {
    let b = ""; q.on("data", (d) => (b += d));
    q.on("end", () => {
      seen.push(`${q.headers["authorization"]} ${b}`);
      r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "pong-from-vyre" }] } }));
    });
  });
  await new Promise<void>((ok) => mcp.listen(0, "127.0.0.1", ok));
  const port = (mcp.address() as { port: number }).port;
  const bridge = await openMcpBridge({ url: `http://127.0.0.1:${port}/mcp`, token: "session-token" }, { scratch: scratchFolder(data, "usr_dana") });
  try {
    const call = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ping", arguments: {} } }) + "\n";
    const shim = await run("", { VYRE_MCP_TOKEN: "session-token" }, "thr_1", [bridge.stdio.command, ...bridge.stdio.args], call);
    assert.match(shim.out, /pong-from-vyre/);
    assert.equal(seen.length, 1);
    assert.match(seen[0]!, /^Bearer session-token /);
    const wrong = await run("", { VYRE_MCP_TOKEN: "wrong" }, "thr_1", [bridge.stdio.command, ...bridge.stdio.args], call);
    assert.doesNotMatch(wrong.out, /pong-from-vyre/);
    assert.equal(seen.length, 1, "a wrong token reaches nothing");
    const direct = await run(`node -e 'require("n"+"et").connect(${port},"127.0.0.1").on("connect",()=>{console.log("REACHED");process.exit(0)}).on("error",(e)=>{console.log("blocked "+e.code);process.exit(0)})' 2>&1 || true`, {}, "thr_1");
    assert.doesNotMatch(direct.out, /REACHED/, "the daemon's loopback is not reachable from inside");
  } finally {
    await bridge.close();
    mcp.close();
  }
});
