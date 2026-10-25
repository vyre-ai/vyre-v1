// The sandbox wrap around a CLI engine (P-L2_23, security review S8 finding 1): the work folder is one per person and thread, the key and the MCP token reach the sandbox, a Mac gets Seatbelt and
// the proxy variables, a host placement fails closed, and with no sandbox at all a CLI turn never starts. The real bubblewrap proof is sandbox.heavy.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxWrap, workFolder } from "../sandbox.ts";
import { buildOpener } from "../session.ts";
import type { SandboxPlan } from "../sandbox.ts";

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engine-sbx-")));
const bw: SandboxPlan = { sandbox: { kind: "bwrap", wallDir: "/tmp/vyre-net-unit", node: "/usr/bin/node" }, dataDir: data, egressHosts: ["api.anthropic.com"] };
const env = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-key", VYRE_MCP_TOKEN: "mcp-token" };

test("a person's thread gets its own folder under the Space data directory; ids cannot climb out", () => {
  const a = workFolder(data, "usr_dana", "thr_1");
  assert.equal(a, path.join(data, "work", "usr_dana", "thr_1"));
  assert.ok(fs.statSync(a).isDirectory());
  assert.notEqual(a, workFolder(data, "usr_dana", "thr_2"));
  assert.notEqual(a, workFolder(data, "usr_ravi", "thr_1"));
  const odd = workFolder(data, "usr/../dana", "..%2f");
  assert.ok(odd.startsWith(path.join(data, "work") + path.sep));
  assert.throws(() => workFolder(data, "..", "thr_1"), /cannot name a folder/);
  assert.throws(() => workFolder(data, "usr_dana", ""), /cannot name a folder/);
});

test("bwrap: the work folder is the first rw mount and the directory it starts in; the key and the MCP token travel as --setenv", () => {
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const argv = sandboxWrap(bw)(["claude", "-p"], { env, cwd });
  assert.equal(argv[0], "bwrap");
  const binds = argv.flatMap((x, i) => (x === "--bind" ? [argv[i + 1]] : []));
  assert.equal(binds[0], cwd, "bwrap does --chdir to the first mount");
  assert.equal(argv[argv.indexOf("--chdir") + 1], cwd);
  const setenv = (k: string): string | undefined => { const i = argv.findIndex((x, j) => x === "--setenv" && argv[j + 1] === k); return i < 0 ? undefined : argv[i + 2]; };
  assert.equal(setenv("CLAUDE_CODE_OAUTH_TOKEN"), "sk-ant-key");
  assert.equal(setenv("VYRE_MCP_TOKEN"), "mcp-token");
  assert.ok(argv.includes("--clearenv"));
  assert.ok(argv.indexOf("--clearenv") < argv.indexOf("--setenv"));
  assert.ok(!argv.includes("--share-net"), "the wall: no network of its own");
  assert.deepEqual(argv.slice(-2), ["claude", "-p"]);
});

test("seatbelt: the command is sandbox-exec behind env(1), with the proxy variables and the work folder in the profile", () => {
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const argv = sandboxWrap({ ...bw, sandbox: { kind: "seatbelt", proxyPort: 4321 } })(["claude", "-p"], { env, cwd });
  assert.equal(argv[0], "/usr/bin/env");
  assert.ok(argv.includes("HTTPS_PROXY=http://127.0.0.1:4321"));
  const at = argv.indexOf("/usr/bin/sandbox-exec");
  assert.ok(at > 0);
  assert.ok(argv[at + 2]!.includes(cwd), "the profile names the work folder");
  assert.deepEqual(argv.slice(-2), ["claude", "-p"]);
});

test("a host placement fails closed with sandbox.unavailable, and so does a missing work folder or a folder that is not a person's thread", () => {
  const cwd = workFolder(data, "usr_dana", "thr_1");
  for (const kind of ["docker", "server"] as const) assert.throws(() => sandboxWrap({ ...bw, sandbox: { kind } })(["claude"], { env, cwd }), (e: Error & { code?: string }) => e.code === "sandbox.unavailable");
  assert.throws(() => sandboxWrap(bw)(["claude"], { env }), /needs a work folder/);
  assert.throws(() => sandboxWrap(bw)(["claude"], { env, cwd: os.homedir() }), /not one of the Space's/);
  assert.throws(() => sandboxWrap(bw)(["claude"], { env, cwd: path.join(data, "work", "usr_dana") }), /not one of the Space's/);
});

test("with no sandbox plan a CLI engine never starts: the launcher refuses", async () => {
  const opener = buildOpener({ session: { source: {} as never, reportMiss: () => undefined, mcp: {} as never }, call: async () => ({}) });
  assert.ok(opener);
  // The refusal is on the launcher the opener was built with; the opener reaches it only for a CLI driver, so the check here is that building without a plan did not fall back to a local launcher.
  const src = fs.readFileSync(new URL("../session.ts", import.meta.url), "utf8");
  assert.ok(!/createLocalLauncher\(\{\}\)|createLocalLauncher\(h\.launcher/.test(src));
  assert.match(src, /sandbox\.unavailable/);
});

test("the default sandbox: Linux without bwrap and an unknown platform say so and refuse, they never run the engine unwrapped", async () => {
  const { defaultSandbox } = await import("../sandbox-default.ts");
  const noBwrap = await defaultSandbox({ dataDir: data, platform: "linux", bwrapPaths: ["/nonexistent/bwrap"] });
  assert.equal(noBwrap.plan.sandbox.kind, "server");
  assert.throws(() => sandboxWrap(noBwrap.plan)(["claude"], { env, cwd: workFolder(data, "usr_dana", "thr_1") }), (e: Error & { code?: string }) => e.code === "sandbox.unavailable");
  const win = await defaultSandbox({ dataDir: data, platform: "win32" });
  assert.equal(win.plan.sandbox.kind, "server");
  assert.match((win.plan.sandbox as { reason?: string }).reason ?? "", /win32/);
  await noBwrap.close();
  await win.close();
});
