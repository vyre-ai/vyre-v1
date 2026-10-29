// @heavy mac
// The Mac's Seatbelt sandbox around a CLI engine, run for real (the desktop job's sandbox leg, VYRE_HEAVY_MAC=1). Node used to abort (SIGABRT) the moment it started under the profile because it reads
// the root directory while resolving its own path; every CLI engine on a Mac Personal Space died with it. These tests start the real things under the exact profile the daemon builds
// (defaultSandbox + sandboxWrap + the local launcher): node itself; the MCP shim over a socket whose path is longer than a unix
// socket allows; and, when VYRE_MAC_CLI_DIR names a folder with Claude Code and Codex installed on this runner, both real CLIs, which must start and must not die on a signal. Confinement is asserted
// alongside (the fake CLI's full turn through the engine is cli.heavy.test.ts, which the same job runs with VYRE_HEAVY_MAC=1): a write outside the work folder, a read of the person's home and a connection to a non-proxy port are all refused.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../../../agent/src/drivers/cli/index.ts";
import { defaultSandbox } from "../sandbox-default.ts";
import type { DefaultSandbox } from "../sandbox-default.ts";
import { openMcpBridge } from "../mcp-bridge.ts";
import { sandboxWrap, scratchFolder, workFolder } from "../sandbox.ts";

const ON = process.platform === "darwin" && process.env["VYRE_HEAVY_MAC"] === "1";
const skip: string | false = ON ? false : "needs a Mac and VYRE_HEAVY_MAC=1";
const FAKE_CLI = fileURLToPath(new URL("../../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const CLI_DIR = process.env["VYRE_MAC_CLI_DIR"];
const PERSON = "usr_01HZ0000000000000000000000";

// A data folder deep enough that the MCP socket path would not fit in a unix socket, as ~/Library/Application Support/<app>/personal/scratch/<person> does.
const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engine-mac-hv-with-a-long-name-like-application-support-")));
const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engine-mac-outside-")));
let dflt: DefaultSandbox | undefined;
after(async () => { await dflt?.close(); fs.rmSync(data, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });

async function plan(): Promise<DefaultSandbox> {
  dflt ??= await defaultSandbox({ dataDir: data, programRead: [path.dirname(FAKE_CLI), ...(CLI_DIR ? [CLI_DIR] : [])] });
  assert.equal(dflt.plan.sandbox.kind, "seatbelt", "the default plan on a Mac is Seatbelt");
  return dflt;
}

async function run(argv: string[], env: Record<string, string> = {}, stdin?: string, thread = "thr_1"): Promise<{ out: string; err: string; code: number | null; signal: NodeJS.Signals | null }> {
  const cwd = workFolder(data, PERSON, thread);
  const launcher = createLocalLauncher({ wrap: sandboxWrap((await plan()).plan), baseEnv: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" } });
  const p = await launcher.spawn({ argv, cwd, env });
  if (stdin !== undefined) await p.write(stdin);
  p.endInput();
  let out = "";
  for await (const c of p.stdout) out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
  const exit = await p.exited;
  return { out, err: p.stderrTail(), code: exit.code, signal: exit.signal };
}

test("node starts under the exact profile and does not abort", { skip }, async () => {
  const r = await run([process.execPath, "-e", "console.log('up', process.version)"]);
  assert.equal(r.signal, null, `node died on ${String(r.signal)}: ${r.err}`);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^up v\d+/);
});

test("confinement holds: a write in the work folder works; a write outside it, a read of the home and a connection to a non-proxy port are refused", { skip }, async () => {
  const home = path.join(os.homedir(), `.vyre-mac-hv-${process.pid}`);
  fs.writeFileSync(home, "private");
  const listener = net.createServer((s) => s.end("open")).listen(0, "127.0.0.1");
  await new Promise<void>((ok) => listener.once("listening", ok));
  const port = (listener.address() as net.AddressInfo).port;
  try {
    const script = `
      const fs = require("node:fs"), net = require("node:net");
      const tried = (f) => { try { f(); return "allowed"; } catch (e) { return e.code; } };
      const res = {
        inside: tried(() => fs.writeFileSync("inside.txt", "x")),
        outside: tried(() => fs.writeFileSync(${JSON.stringify(path.join(outside, "no.txt"))}, "x")),
        home: tried(() => fs.readFileSync(${JSON.stringify(home)})),
        homeDir: tried(() => fs.readdirSync(${JSON.stringify(os.homedir())})),
      };
      const c = net.connect(${port}, "127.0.0.1");
      c.on("connect", () => { res.net = "allowed"; console.log(JSON.stringify(res)); process.exit(0); });
      c.on("error", (e) => { res.net = e.code; console.log(JSON.stringify(res)); process.exit(0); });`;
    const r = await run([process.execPath, "-e", script]);
    assert.equal(r.signal, null, r.err);
    const got = JSON.parse(r.out.trim()) as Record<string, string>;
    assert.equal(got["inside"], "allowed");
    assert.equal(got["outside"], "EPERM", "a write outside the work folder is denied");
    assert.equal(got["home"], "EPERM", "the person's home is not readable");
    assert.equal(got["homeDir"], "EPERM", "the person's home is not listable");
    assert.notEqual(got["net"], "allowed", "only the egress proxy is reachable");
    assert.ok(fs.existsSync(path.join(data, "work", PERSON, "thr_1", "inside.txt")));
    assert.ok(!fs.existsSync(path.join(outside, "no.txt")));
  } finally {
    listener.close();
    fs.rmSync(home, { force: true });
  }
});

test("the CLI keeps its home, temp and config folders in the person's scratch folder, not in the real home", { skip }, async () => {
  const r = await run([process.execPath, "-e", "console.log(JSON.stringify({ home: process.env.HOME, tmp: process.env.TMPDIR, claude: process.env.CLAUDE_CONFIG_DIR, codex: process.env.CODEX_HOME }))"]);
  const got = JSON.parse(r.out.trim()) as Record<string, string>;
  const scratch = scratchFolder(data, PERSON);
  for (const v of Object.values(got)) assert.ok(v.startsWith(`${scratch}${path.sep}`), `${v} is under ${scratch}`);
  const w = await run([process.execPath, "-e", `const fs = require("node:fs"); fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true }); fs.writeFileSync(process.env.CLAUDE_CONFIG_DIR + "/state.json", "{}"); fs.writeFileSync(process.env.TMPDIR + "/t", "x"); console.log("ok")`]);
  assert.equal(w.out.trim(), "ok", w.err);
});

test("the MCP shim reaches the bridge over a socket whose path would not fit in a unix socket", { skip }, async () => {
  const scratch = scratchFolder(data, PERSON);
  assert.ok(Buffer.byteLength(path.join(scratch, "mcp-000000000000.sock")) > 100, "the test folder is deep enough to need the short link");
  const fake = (async () => ({ headers: { get: () => "application/json" }, text: async () => '{"jsonrpc":"2.0","id":1,"result":"pong"}' })) as never;
  const bridge = await openMcpBridge({ url: "http://127.0.0.1:1/mcp", token: "tok" }, { scratch, fetch: fake });
  try {
    assert.ok(Buffer.byteLength(bridge.socket) <= 100, bridge.socket);
    const r = await run([bridge.stdio.command, ...bridge.stdio.args], { VYRE_MCP_TOKEN: "tok" }, '{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    assert.equal(r.signal, null, r.err);
    assert.match(r.out, /pong/, r.err);
  } finally {
    await bridge.close();
  }
  assert.ok(!fs.existsSync(path.dirname(path.dirname(bridge.socket))) || !bridge.socket.startsWith(scratch), "the short link folder is removed on close");
});

// ---- the real CLIs, installed on the runner only (the desktop job: npm install --prefix "$VYRE_MAC_CLI_DIR" @anthropic-ai/claude-code @openai/codex)

for (const [name, bin, key, args] of [
  ["Claude Code", "claude", "ANTHROPIC_API_KEY", ["-p", "say ok"]],
  ["Codex", "codex", "CODEX_API_KEY", ["exec", "--skip-git-repo-check", "say ok"]],
] as const) {
  const skipCli: string | false = skip || (CLI_DIR ? false : "needs VYRE_MAC_CLI_DIR (the CLIs installed on the runner)");
  test(`${name}: --version starts under the profile`, { skip: skipCli }, async () => {
    const exe = path.join(CLI_DIR as string, "node_modules", ".bin", bin);
    assert.ok(fs.existsSync(exe), `${exe} is installed`);
    const r = await run([exe, "--version"]);
    assert.equal(r.signal, null, `${name} died on ${String(r.signal)}: ${r.err}`);
    assert.equal(r.code, 0, `${name} --version exited ${String(r.code)}: ${r.err}`);
    assert.match(r.out.trim(), /\d+\.\d+/);
  });
  test(`${name}: a turn starts under the profile and ends without a crash (a fake key, so the vendor refuses it)`, { skip: skipCli }, async () => {
    const exe = path.join(CLI_DIR as string, "node_modules", ".bin", bin);
    // The vendor answers 401 through the allowlisted proxy, or the proxy is unreachable from the runner: either way the CLI must exit by itself, never on a signal.
    const r = await run([exe, ...args], { [key]: "sk-fake-not-a-real-key-0123456789" });   // secret-scan: fake
    assert.equal(r.signal, null, `${name} died on ${String(r.signal)}: ${r.err}`);
    assert.doesNotMatch(r.err, /sandbox|Operation not permitted|EPERM|SIGABRT/i, `${name} hit the sandbox: ${r.err.slice(-600)}`);
  });
}
