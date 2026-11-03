// A plugin's stdio server under Codex on any computer (lane l-winfix): the secret moves to the server's own name through a small Node launcher, never /bin/sh, which Windows does not have. On
// Windows the launcher finds the program as cmd.exe does (PATH and PATHEXT) and starts a batch file (npx.cmd) through cmd.exe with each argument quoted; checked here with path.win32.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SERVER_SHIM_HELPERS, codexServer } from "../src/drivers/cli/codex.ts";

interface Helpers {
  winResolve(cmd: string, env: Record<string, string>, exists: (f: string) => boolean, wpath: typeof path.win32): string;
  winLine(file: string, args: string[], comspec?: string): { command: string; args: string[]; verbatim: boolean };
}
const H = new Function(`${SERVER_SHIM_HELPERS}; return { winResolve, winLine };`)() as Helpers;

test("a server with a secret starts through Node, not /bin/sh; one with none starts as it is", () => {
  const m = codexServer({ command: "npx", args: ["-y", "@acme/mcp"], env: { ACME_TOKEN: "${VYRE_PLUGIN_1}", REGION: "eu" } }, "C:\\Program Files\\Vyre\\node.exe")!;
  assert.equal(m.command, "C:\\Program Files\\Vyre\\node.exe");
  assert.equal(m.args[0], "-e");
  assert.deepEqual(m.args.slice(2), [JSON.stringify([["ACME_TOKEN", "VYRE_PLUGIN_1"]]), "npx", "-y", "@acme/mcp"]);
  assert.ok(!JSON.stringify(m).includes("/bin/sh"));
  assert.deepEqual(m.env, { REGION: "eu" });
  assert.deepEqual(m.envVars, ["VYRE_PLUGIN_1"]);
  assert.deepEqual(codexServer({ command: "C:\\tools\\srv.exe", args: ["a b"], env: { REGION: "eu" } }), { command: "C:\\tools\\srv.exe", args: ["a b"], env: { REGION: "eu" }, envVars: [] });
});

test("the launcher moves the secret, drops Vyre's name, keeps every argument whole and passes the exit code on", () => {
  const m = codexServer({ command: process.execPath, args: ["-e", "console.log(JSON.stringify([process.env.ACME_TOKEN ?? null, process.env.VYRE_PLUGIN_1 ?? null, process.argv.slice(1)])); process.exit(7)", "a b", "\"q\"", "$HOME", "%PATH%"], env: { ACME_TOKEN: "${VYRE_PLUGIN_1}" } })!;
  const r = spawnSync(m.command, m.args, { env: { ...process.env, VYRE_PLUGIN_1: "s3cr3t & | \"x\"" }, encoding: "utf8" });
  assert.equal(r.status, 7, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ["s3cr3t & | \"x\"", null, ["a b", "\"q\"", "$HOME", "%PATH%"]]);
});

test("Windows: the program is found as cmd.exe finds it, by PATH and PATHEXT, in any letter case", () => {
  const files = new Set(["C:\\Program Files\\nodejs\\npx.cmd", "C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\dana\\.local\\bin\\uvx.exe", "C:\\tools\\srv.bat"]);
  const env = { Path: "C:\\Windows\\system32;C:\\Program Files\\nodejs;C:\\Users\\dana\\.local\\bin", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  // a Windows disk does not count case
  const lower = new Set([...files].map((f) => f.toLowerCase()));
  const find = (c: string) => H.winResolve(c, env, (f) => lower.has(f.toLowerCase()), path.win32);
  assert.equal(find("npx"), "C:\\Program Files\\nodejs\\npx.cmd");
  assert.equal(find("node"), "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(find("uvx"), "C:\\Users\\dana\\.local\\bin\\uvx.exe");
  assert.equal(find("C:\\tools\\srv"), "C:\\tools\\srv.bat");
  assert.equal(find("C:\\tools\\srv.bat"), "C:\\tools\\srv.bat");
  assert.equal(find("missing"), "missing", "an unknown program is left for spawn to report");
});

test("Windows: a batch file runs through cmd.exe, each argument quoted and its special characters escaped; an .exe starts directly", () => {
  assert.deepEqual(H.winLine("C:\\tools\\srv.exe", ["a b"]), { command: "C:\\tools\\srv.exe", args: ["a b"], verbatim: false });
  const l = H.winLine("C:\\Program Files\\nodejs\\npx.cmd", ["-y", "@acme/mcp", "a&b|c", "100%", "say \"hi\""], "C:\\Windows\\system32\\cmd.exe");
  assert.equal(l.command, "C:\\Windows\\system32\\cmd.exe");
  assert.equal(l.verbatim, true);
  assert.deepEqual(l.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(l.args[3], "\"C:\\Program^ Files\\nodejs\\npx.cmd ^\"-y^\" ^\"@acme/mcp^\" ^\"a^&b^|c^\" ^\"100^%^\" ^\"say^ \\^\"hi\\^\"^\"\"");
  const shim = H.winLine("C:\\work\\node_modules\\.bin\\mcp.cmd", ["a&b"]);
  assert.equal(shim.args[3], "\"C:\\work\\node_modules\\.bin\\mcp.cmd ^^^\"a^^^&b^^^\"\"", "an npm shim reads its arguments twice, so they are escaped twice");
});
