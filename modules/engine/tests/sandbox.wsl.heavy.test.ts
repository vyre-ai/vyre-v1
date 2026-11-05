// The Windows sandbox for real (VYRE_HEAVY_WSL=1, a Windows runner with WSL2): Vyre's own path from an empty computer to a Claude Code turn. The pinned distribution is imported and set up
// (ensureDistro), the pinned Linux Claude Code installed (installEngine, linux-x64-musl), the default plan built (defaultSandbox, win32: the agent and its net wall in the VM), and the engine
// started through sandboxWrap. Claude Code answers a fake model API that runs in the VM and is reached only through the wall, and runs one Bash tool call. Then, in the same sandbox:
//   - reads outside its folders fail (the Windows profile, the rest of the data folder);
//   - writes outside its work folder fail;
//   - a host off the policy is refused by the proxy, and with the proxy variables removed nothing is reachable at all;
//   - the MCP shim reaches Vyre's tools across the VM boundary, over the agent's relay, with its session token.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultSandbox } from "../sandbox-default.ts";
import { sandboxWrap, scratchFolder, workFolder } from "../sandbox.ts";
import { installEngine } from "../engine-install.ts";
import { openWslMcpBridge } from "../mcp-bridge.ts";
import { DISTRO_PIN } from "../../../sandbox/src/wsl/pins.ts";
import { ensureDistro, toWslPath, wslExe } from "../../../sandbox/src/wsl/wsl.ts";

const ON = process.env["VYRE_HEAVY_WSL"] === "1" && process.platform === "win32";

/** A fake Anthropic Messages API: the first call asks for one Bash tool call, the call with its result ends the turn. Every call and tool result is logged. */
/**
 * The fake gateway's port once it is written in full, and a connect to it from inside the VM, the place the sandbox's proxy connects from. The server creates the port file before it writes the number, so a read as soon as
 * the file exists could see it empty: port 0, and a turn that failed with "502 Could not reach that host (api.fake.test)" which looked like a sandbox fault (runs 41931328871 and 41936626466 failed, 41937941905 passed).
 * A gateway that cannot be reached fails here, by name, before the turn starts. No retry of the turn.
 */
async function gatewayPort(portFile: string): Promise<number> {
  let port = 0;
  for (let i = 0; i < 300 && port === 0; i++) {
    const t = fs.existsSync(portFile) ? fs.readFileSync(portFile, "utf8").trim() : "";
    if (/^[1-9]\d*$/.test(t)) port = Number(t); else await new Promise((r) => setTimeout(r, 200));
  }
  if (port === 0) throw new Error("fake gateway not reachable from WSL: it never wrote its port");
  const probe = spawnSync(wslExe(), ["-d", DISTRO_PIN.name, "-u", DISTRO_PIN.user, "--exec", "/usr/bin/node", "-e", `require("net").connect(${port},"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(3));setTimeout(()=>process.exit(4),5000)`], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (probe.status !== 0) throw new Error(`fake gateway not reachable from WSL (127.0.0.1:${port} inside ${DISTRO_PIN.name}, exit ${String(probe.status)}): ${probe.stderr.slice(-300)}`);
  return port;
}

const FAKE_API = `import fs from "node:fs";
import http from "node:http";
const [portFile, logFile] = process.argv.slice(2);
const log = (o) => fs.appendFileSync(logFile, JSON.stringify(o) + "\\n");
const sse = (res, ev) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const [e, d] of ev) res.write("event: " + e + "\\ndata: " + JSON.stringify(d) + "\\n\\n"); res.end(); };
const s = http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => { body += d; });
  req.on("end", () => {
    let j = {}; try { j = JSON.parse(body || "{}"); } catch {}
    log({ path: req.url, host: req.headers.host });
    if (req.url.includes("count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); res.end('{"input_tokens":1}'); return; }
    if (!req.url.startsWith("/v1/messages")) { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; }
    const result = JSON.stringify(j.messages ?? []).match(/"type":"tool_result".{0,300}/)?.[0];
    if (result) log({ toolResult: result });
    const msg = { id: "msg_1", type: "message", role: "assistant", model: j.model ?? "fake", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    const block = result ? { type: "text", text: "" } : { type: "tool_use", id: "toolu_1", name: "Bash", input: {} };
    const delta = result ? { type: "text_delta", text: "done" } : { type: "input_json_delta", partial_json: JSON.stringify({ command: "echo wsl-tool-ok > tool.txt && cat tool.txt", description: "proof" }) };
    sse(res, [["message_start", { type: "message_start", message: msg }], ["content_block_start", { type: "content_block_start", index: 0, content_block: block }], ["content_block_delta", { type: "content_block_delta", index: 0, delta }], ["content_block_stop", { type: "content_block_stop", index: 0 }], ["message_delta", { type: "message_delta", delta: { stop_reason: result ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } }], ["message_stop", { type: "message_stop" }]]);
  });
});
s.listen(0, "127.0.0.1", () => { fs.writeFileSync(portFile + ".tmp", String(s.address().port)); fs.renameSync(portFile + ".tmp", portFile); });
setTimeout(() => process.exit(0), 30 * 60000);
`;

function run(argv: readonly string[], o: { input?: string; ms?: number } = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(argv[0] as string, argv.slice(1), { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    p.stdout.setEncoding("utf8").on("data", (d: string) => { out += d; });
    p.stderr.setEncoding("utf8").on("data", (d: string) => { err += d; });
    const t = setTimeout(() => p.kill(), o.ms ?? 240_000);
    p.once("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    if (o.input !== undefined) p.stdin.end(o.input); else p.stdin.end();
  });
}

test("the Windows sandbox: a Claude Code turn with a Bash tool call, and nothing else reachable", { skip: !ON && "VYRE_HEAVY_WSL=1 on a Windows runner with WSL2", timeout: 40 * 60_000 }, async () => {
  const local = process.env["LOCALAPPDATA"] as string;
  const box = fs.mkdtempSync(path.join(local, "vyre-wsl-proof-"));
  const wslRoot = path.join(box, "wsl");
  const dataDir = path.join(box, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const t0 = Date.now();
  await ensureDistro({ root: wslRoot });
  console.log(`distribution imported and set up in ${Math.round((Date.now() - t0) / 1000)} s`);
  const engines = path.join(dataDir, "engines", "wsl");
  const claude = await installEngine("claude", { root: engines, platform: "linux-x64-musl" });

  // the fake model API, inside the VM (outside any sandbox): only the wall's proxy can reach it, by the name api.fake.test
  const apiDir = path.join(box, "api");
  fs.mkdirSync(apiDir);
  fs.writeFileSync(path.join(apiDir, "api.mjs"), FAKE_API);
  const portFile = path.join(apiDir, "port.txt");
  const logFile = path.join(apiDir, "log.jsonl");
  const api = spawn(wslExe(), ["-d", DISTRO_PIN.name, "-u", DISTRO_PIN.user, "--exec", "/usr/bin/node", toWslPath(path.join(apiDir, "api.mjs")), toWslPath(portFile), toWslPath(logFile)], { windowsHide: true, stdio: "ignore" });
  const port = await gatewayPort(portFile);

  const t1 = Date.now();
  const d = await defaultSandbox({ platform: "win32", windowsMode: "contained", dataDir, wslRoot, egressHosts: ["api.fake.test"], wslTestRoutes: { "api.fake.test": port }, programRead: [engines] });
  console.log(`the sandbox started in ${Math.round((Date.now() - t1) / 1000)} s`);
  assert.equal(d.plan.sandbox.kind, "wsl");
  try {
    const cwd = workFolder(dataDir, "usr_dana", "thr_1");
    const wrap = sandboxWrap(d.plan, { homeFromScratch: true });
    const env = { ANTHROPIC_API_KEY: "sk-ant-fake", ANTHROPIC_BASE_URL: "http://api.fake.test", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };

    // 1. a Claude Code turn with one Bash tool call
    const turn = await run(wrap([claude, "-p", "Run the tool once.", "--output-format", "text", "--permission-mode", "bypassPermissions", "--model", "claude-sonnet-4-5"], { cwd, env }));
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    console.log(`claude: exit ${turn.code}\n${turn.out.slice(-600)}\n${turn.err.slice(-1500)}\napi log:\n${log.slice(-1500)}`);
    assert.equal(turn.code, 0, turn.err.slice(-800));
    assert.equal(fs.readFileSync(path.join(cwd, "tool.txt"), "utf8").trim(), "wsl-tool-ok", "the Bash tool ran in the work folder");
    assert.match(log, /"toolResult".*wsl-tool-ok/);
    assert.match(log, /"toolResult".*\\"is_error\\":false/);

    // 2. reads, writes and the network, from inside the same sandbox
    const secret = path.join(os.homedir(), "vyre-wsl-secret.txt");
    fs.writeFileSync(secret, "secret");
    const elsewhere = path.join(dataDir, "not-yours.txt");
    fs.writeFileSync(elsewhere, "not yours");
    const probe = (label: string, cmd: string): string => `if ${cmd} >/dev/null 2>&1; then echo "${label}=yes"; else echo "${label}=no"; fi`;
    const script = [
      probe("READ_PROFILE", `cat ${toWslPath(secret)}`),
      // bwrap makes the folders down to the work folder as empty mount points; the drive itself (Windows, other users, the rest of the profile) is not there
      probe("SEE_DRIVE", "test -e /mnt/c/Windows/System32"),
      "echo \"SKELETON=$(ls /mnt/c | tr '\\n' ' ')\" >&2",
      probe("READ_DATA", `cat ${toWslPath(elsewhere)}`),
      probe("WRITE_WORK", "touch ./mine.txt"),
      probe("WRITE_DATA", `touch ${toWslPath(path.join(dataDir, "pwned.txt"))}`),
      probe("WRITE_ROOT", "touch /etc/pwned"),
      probe("NET_ALLOWED", "wget -q -T 10 -O- http://api.fake.test/health"),
      probe("NET_OFF_POLICY", "wget -q -T 10 -O- http://example.com/"),
      probe("NET_NO_PROXY", "env -u http_proxy -u HTTP_PROXY -u https_proxy -u HTTPS_PROXY -u all_proxy -u ALL_PROXY wget -q -T 5 -O- http://1.1.1.1/"),
      probe("WIN_PROGRAM", "/mnt/c/Windows/System32/cmd.exe /c echo hi"),
    ].join("\n");
    const p = await run(wrap(["/bin/sh", "-c", script], { cwd, env: {} }), { ms: 120_000 });
    console.log(`probes: exit ${p.code}\n${p.out}\n${p.err.slice(-800)}`);
    const got = Object.fromEntries(p.out.split(/\r?\n/).filter((l) => l.includes("=")).map((l) => l.trim().split("=") as [string, string]));
    assert.deepEqual(got, { READ_PROFILE: "no", SEE_DRIVE: "no", READ_DATA: "no", WRITE_WORK: "yes", WRITE_DATA: "no", WRITE_ROOT: "no", NET_ALLOWED: "yes", NET_OFF_POLICY: "no", NET_NO_PROXY: "no", WIN_PROGRAM: "no" });
    assert.ok(!fs.existsSync(path.join(dataDir, "pwned.txt")));

    // 3. the MCP shim, in the sandbox, reaches Vyre's tools on Windows over the agent's relay
    if (d.plan.sandbox.kind !== "wsl") throw new Error("not a WSL plan");
    const seen: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => { seen.push(`${new Headers(init.headers).get("authorization")} ${String(init.body)}`); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { tools: [] } }), { headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
    const bridge = await openWslMcpBridge(d.plan.sandbox.agent, { url: "http://127.0.0.1:1/mcp", token: "session-token" }, { scratch: scratchFolder(dataDir, "usr_dana"), fetch: fake });
    const shim = await run(wrap([bridge.stdio.command, ...bridge.stdio.args], { cwd, env: { VYRE_MCP_TOKEN: "session-token" } }), { input: `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`, ms: 60_000 });
    console.log(`shim: exit ${shim.code} ${shim.out} ${shim.err.slice(-400)}`);
    assert.deepEqual(JSON.parse(shim.out.trim().split(/\r?\n/).at(-1) as string), { jsonrpc: "2.0", id: 7, result: { tools: [] } });
    assert.deepEqual(seen, [`Bearer session-token ${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}`]);
    await bridge.close();
  } finally {
    await d.close();
    api.kill();
  }
});

// A Team Space turn that a member's Windows computer runs (lane l-runson, RULINGS 15): node-cli.ts, as the device link starts it, reports the computer's engines only because WSL is on, installs
// the Linux Claude Code, and runs the turn under B, the Space's network rule travelling with the spawn. One Bash tool call, against a fake model API in the VM.
test("a Team Space turn on a member's Windows computer runs under B (WSL2 + bwrap)", { skip: !ON && "VYRE_HEAVY_WSL=1 on a Windows runner with WSL2", timeout: 30 * 60_000 }, async () => {
  const { nodeCliLauncher, nodeCliReport, setContainedOptions, wslEngines } = await import("../node-cli.ts");
  const { RULE_ENV } = await import("../../../sandbox/src/index.ts");
  const box = fs.mkdtempSync(path.join(process.env["LOCALAPPDATA"] as string, "vyre-team-proof-"));
  const dataDir = path.join(box, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const report = nodeCliReport({ enginesRoot: wslEngines(dataDir).root });
  console.log(`team report: ${JSON.stringify(report)}`);
  assert.deepEqual([report.sandbox.ok, report.sandbox.kind], [true, "wsl"], "WSL is on: this computer offers its engines to a Team Space");
  const apiDir = path.join(box, "api");
  fs.mkdirSync(apiDir);
  fs.writeFileSync(path.join(apiDir, "api.mjs"), FAKE_API);
  const portFile = path.join(apiDir, "port.txt");
  const logFile = path.join(apiDir, "log.jsonl");
  const api = spawn(wslExe(), ["-d", DISTRO_PIN.name, "-u", DISTRO_PIN.user, "--exec", "/usr/bin/node", toWslPath(path.join(apiDir, "api.mjs")), toWslPath(portFile), toWslPath(logFile)], { windowsHide: true, stdio: "ignore" });
  setContainedOptions({ wslTestRoutes: { "api.fake.test": await gatewayPort(portFile) } });
  try {
    const cwd = workFolder(dataDir, "usr_dana", "prc_team1");
    const launcher = nodeCliLauncher(dataDir, { install: true });
    const proc = await launcher.spawn({
      argv: ["claude", "-p", "Run the tool once.", "--output-format", "text", "--permission-mode", "bypassPermissions", "--model", "claude-sonnet-4-5"], cwd,
      env: { ANTHROPIC_API_KEY: "sk-ant-fake", ANTHROPIC_BASE_URL: "http://api.fake.test", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1", [RULE_ENV]: JSON.stringify({ egress: "list", allow: ["api.fake.test"] }) },
    });
    proc.endInput();
    let out = "";
    const reading = (async () => { for await (const c of proc.stdout) out += String(c); })();
    const exit = await proc.exited;
    await reading.catch(() => undefined);
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    console.log(`team turn: ${JSON.stringify(exit)}\n${out.slice(-400)}\n${proc.stderrTail().slice(-1200)}\napi log:\n${log.slice(-1200)}`);
    assert.equal(exit.code, 0, proc.stderrTail().slice(-600));
    assert.equal(fs.readFileSync(path.join(cwd, "tool.txt"), "utf8").trim(), "wsl-tool-ok", "the Bash tool ran in the Team turn's work folder, in the VM");
    assert.match(log, /"toolResult".*wsl-tool-ok/);
  } finally {
    setContainedOptions({});
    api.kill();
  }
});
