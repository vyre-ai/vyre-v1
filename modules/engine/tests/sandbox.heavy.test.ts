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
import { startNetWall } from "../../../sandbox/src/index.ts";
import type { NetWall } from "../../../sandbox/src/index.ts";
import { sandboxWrap, workFolder } from "../sandbox.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1";

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engine-hv-")));
fs.chmodSync(data, 0o755);
const HOME_SECRET = path.join(os.homedir(), `.vyre-engine-hv-${process.pid}`);
let wall: NetWall | undefined;
after(async () => { await wall?.close(); fs.rmSync(HOME_SECRET, { force: true }); fs.rmSync(data, { recursive: true, force: true }); });

async function run(script: string, env: Record<string, string>, thread = "thr_1"): Promise<{ out: string; code: number | null }> {
  assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bwrap is not installed");
  wall ??= await startNetWall({ allow: ["api.anthropic.com"] });
  const cwd = workFolder(data, "usr_dana", thread);
  for (const d of [path.join(data, "work"), path.join(data, "work", "usr_dana"), cwd, path.join(data, "scratch")]) fs.chmodSync(d, 0o777);
  const plan = { sandbox: { kind: "bwrap" as const, wallDir: wall.dir }, dataDir: data, egressHosts: ["api.anthropic.com"] };
  const launcher = createLocalLauncher({ wrap: sandboxWrap(plan), baseEnv: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" } });
  const p = await launcher.spawn({ argv: ["/bin/sh", "-c", script], cwd, env });
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
