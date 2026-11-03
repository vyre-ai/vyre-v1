// A Windows Personal Space for real (VYRE_HEAVY_LOWIL=1 on a Windows runner; owner ruling 3 Nov 2026): Vyre's own path from an empty computer. defaultSandbox (win32) builds vyre-lowrun with
// the compiler Windows ships and starts the egress proxy; installEngine puts the pinned Windows Claude Code in place; sandboxWrap starts it at Low integrity in a Job Object. Then:
//   - a Claude Code turn runs one Bash tool call (Git Bash) against a fake model API on loopback, and the tool writes in the work folder;
//   - git clones a repository over HTTPS through the proxy;
//   - writes outside the work folder and the added folders are refused, inside them they work;
//   - Vyre's own secrets in its data folder (admin.token, seal.key, the databases) cannot be read by the engine, though the person's files can;
//   - closing the job ends everything the engine started.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { defaultSandbox } from "../sandbox-default.ts";
import { sandboxWrap, workFolder } from "../sandbox.ts";
import { installEngine } from "../engine-install.ts";

const ON = process.env["VYRE_HEAVY_LOWIL"] === "1" && process.platform === "win32";

function fakeApi(log: string[]): Promise<{ port: number; close(): void }> {
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += String(d); });
    req.on("end", () => {
      let j: { messages?: unknown; model?: string } = {};
      try { j = JSON.parse(body || "{}") as typeof j; } catch { /* not json */ }
      log.push(String(req.url));
      if (String(req.url).includes("count_tokens")) { res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":1}'); return; }
      if (!String(req.url).startsWith("/v1/messages")) { res.writeHead(200, { "content-type": "application/json" }).end("{}"); return; }
      const result = /"type":"tool_result".{0,300}/.exec(JSON.stringify(j.messages ?? []))?.[0];
      if (result) log.push(`toolResult ${result}`);
      const msg = { id: "msg_1", type: "message", role: "assistant", model: j.model ?? "fake", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      const block = result ? { type: "text", text: "" } : { type: "tool_use", id: "toolu_1", name: "Bash", input: {} };
      const delta = result ? { type: "text_delta", text: "done" } : { type: "input_json_delta", partial_json: JSON.stringify({ command: "echo low-tool-ok > tool.txt && cat tool.txt", description: "proof" }) };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [e, d] of [["message_start", { type: "message_start", message: msg }], ["content_block_start", { type: "content_block_start", index: 0, content_block: block }], ["content_block_delta", { type: "content_block_delta", index: 0, delta }], ["content_block_stop", { type: "content_block_stop", index: 0 }], ["message_delta", { type: "message_delta", delta: { stop_reason: result ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } }], ["message_stop", { type: "message_stop" }]] as const) res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
      res.end();
    });
  });
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve({ port: (s.address() as { port: number }).port, close: () => s.close() })));
}

/** PowerShell with the script encoded (UTF-16LE base64): nothing in it needs quoting on a command line. */
const ps = (script: string): string[] => ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];

function run(argv: readonly string[], o: { cwd: string; env?: Record<string, string>; ms?: number }): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(argv[0] as string, argv.slice(1), { cwd: o.cwd, env: { ...process.env, ...(o.env ?? {}) }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    p.stdout.setEncoding("utf8").on("data", (d: string) => { out += d; });
    p.stderr.setEncoding("utf8").on("data", (d: string) => { err += d; });
    const t = setTimeout(() => p.kill(), o.ms ?? 240_000);
    p.once("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.stdin.end();
  });
}

test("a Windows Personal Space: a Claude Code Bash turn, git over HTTPS, and no change outside the added folders", { skip: !ON && "VYRE_HEAVY_LOWIL=1 on a Windows runner", timeout: 30 * 60_000 }, async () => {
  const box = fs.mkdtempSync(path.join(process.env["LOCALAPPDATA"] as string, "vyre-low-proof-"));
  const dataDir = path.join(box, "data");
  const added = path.join(box, "Added folder");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(added, { recursive: true });
  const claude = await installEngine("claude", { root: path.join(dataDir, "engines"), platform: "win32-x64" });
  // Vyre's own secrets, as a Personal Space keeps them in its data folder (the at-rest audit)
  fs.writeFileSync(path.join(dataDir, "admin.token"), "owner-bearer-token-xyz");
  fs.mkdirSync(path.join(dataDir, "logs"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "logs", "claim-link.txt"), "claim-link-secret-xyz");
  const log: string[] = [];
  const api = await fakeApi(log);
  // a Personal Space turn never asks the computer's engine report: that report is for Team turns, which run under B (sandbox.wsl.heavy.test.ts proves it)
  const d = await defaultSandbox({ platform: "win32", dataDir, winBin: path.join(box, "bin"), egressHosts: ["github.com", "*.github.com", "codeload.github.com"], writable: [added] });
  assert.equal(d.plan.sandbox.kind, "lowil");
  try {
    const cwd = workFolder(dataDir, "usr_dana", "thr_1");
    const wrap = sandboxWrap(d.plan, { homeFromScratch: true });

    // 1. a Claude Code turn with one Bash tool call, while the person has Git's MSYS running at normal integrity (a Git Bash window): the engine's private copy keeps them apart
    assert.equal(d.plan.sandbox.kind === "lowil" && typeof d.plan.sandbox.bash === "string", true, "the engine has its own Git Bash");
    const persons = spawn("C:\\Program Files\\Git\\usr\\bin\\sleep.exe", ["300"], { windowsHide: true, stdio: "ignore" });
    const env = { ANTHROPIC_API_KEY: "sk-ant-fake", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };
    const turn = await run(wrap([claude, "-p", "Run the tool once.", "--output-format", "text", "--permission-mode", "bypassPermissions", "--model", "claude-sonnet-4-5"], { cwd, env }), { cwd, env });
    console.log(`claude: exit ${turn.code}\n${turn.out.slice(-500)}\n${turn.err.slice(-1500)}\napi: ${log.join(" | ").slice(-1500)}`);
    assert.equal(turn.code, 0, turn.err.slice(-800));
    assert.equal(fs.readFileSync(path.join(cwd, "tool.txt"), "utf8").trim(), "low-tool-ok", "the Bash tool ran in the work folder");
    assert.ok(log.some((l) => l.startsWith("toolResult") && l.includes("low-tool-ok") && l.includes('"is_error":false')));
    persons.kill();

    // 2. git over HTTPS, through the proxy
    const git = await run(wrap(["git", "clone", "--depth", "1", "https://github.com/octocat/Hello-World.git", "hello"], { cwd, env: {} }), { cwd, ms: 180_000 });
    console.log(`git: exit ${git.code} ${git.err.slice(-600)}`);
    if (git.code !== 0) {
      // the same ref writes outside a clone, at Low and at normal integrity, to see which step Windows refuses
      const script = (dir: string) => [
        "$ErrorActionPreference = 'Continue'",
        `New-Item -ItemType Directory -Force -Path '${dir}' | Out-Null`, `Set-Location '${dir}'`,
        "\"init: $((git init 2>&1 | Out-String).Trim()) [$LASTEXITCODE]\"",
        "\"tree: $((Get-ChildItem -Force -Recurse .git -Directory | ForEach-Object { $_.FullName.Substring($PWD.Path.Length) }) -join ' ')\"",
        "\"commit: $((git -c user.name=v -c user.email=v@v commit --allow-empty -m x 2>&1 | Out-String).Trim()) [$LASTEXITCODE]\"",
        "\"update-ref: $((git update-ref refs/remotes/origin/main HEAD 2>&1 | Out-String).Trim()) [$LASTEXITCODE]\"",
        "\"mkdir: $(try { New-Item -ItemType Directory -Path .git\\refs\\remotes\\probe -ErrorAction Stop | Out-Null; 'ok' } catch { $_.Exception.Message })\"",
        "\"mkdir-objects: $(try { New-Item -ItemType Directory -Path .git\\objects\\probe -ErrorAction Stop | Out-Null; 'ok' } catch { $_.Exception.Message })\"",
        "\"refs label: $((icacls .git\\refs | Select-String Mandatory) -join ' ')\"",
        "\"refs attrs: $((Get-Item -Force .git\\refs).Attributes) .git attrs: $((Get-Item -Force .git).Attributes)\"",
      ].join("; ");
      const low = await run(wrap(ps(script(path.join(cwd, "refs-low"))), { cwd, env: {} }), { cwd, ms: 120_000 });
      const med = await run(ps(script(path.join(cwd, "refs-medium"))), { cwd, ms: 120_000 });
      console.log(`LOW:\n${low.out}\nMEDIUM:\n${med.out}`);
    }
    assert.equal(git.code, 0, git.err.slice(-600));
    assert.ok(fs.existsSync(path.join(cwd, "hello", "README")), "the repository is in the work folder");

    // 3. what it may change: the work folder and the added folders, nothing else
    const outside = path.join(os.homedir(), "vyre-low-outside.txt");
    const data = path.join(dataDir, "vyre-low-pwned.txt");
    fs.rmSync(outside, { force: true });
    const w = (target: string) => run(wrap(ps(`Set-Content -LiteralPath '${target}' -Value x`), { cwd, env: {} }), { cwd, ms: 60_000 });
    for (const t of [outside, data]) { const r = await w(t); console.log(`write ${t}: exit ${r.code} ${r.err.trim()}`); }
    assert.ok(!fs.existsSync(outside), "the profile is not changed");
    assert.ok(!fs.existsSync(data), "Vyre's own data is not changed");
    await w(path.join(added, "in-added.txt"));
    await w(path.join(cwd, "in-work.txt"));
    assert.ok(fs.existsSync(path.join(added, "in-added.txt")), "an added folder is changed");
    assert.ok(fs.existsSync(path.join(cwd, "in-work.txt")), "the work folder is changed");

    // 4. Vyre's own files are not readable by the engine; the person's own files are (the ruling: it reads the computer like Claude Code does)
    const mine = path.join(os.homedir(), "vyre-low-readable.txt");
    fs.writeFileSync(mine, "persons-own-file");
    const read = (f: string) => run(wrap(ps(`Get-Content -LiteralPath '${f}'`), { cwd, env: {} }), { cwd, ms: 60_000 });
    const token = await read(path.join(dataDir, "admin.token"));
    const claim = await read(path.join(dataDir, "logs", "claim-link.txt"));
    const own = await read(mine);
    // what Windows holds on them, and whether "no read up" holds on a file labelled by itself
    const direct = path.join(dataDir, "direct.txt");
    fs.writeFileSync(direct, "direct-secret");
    if (d.plan.sandbox.kind === "lowil") await run([d.plan.sandbox.helper, "--label", direct, "S:(ML;;NRNW;;;ME)"], { cwd });
    const directRead = await read(direct);
    const labels = await run(ps(`icacls '${dataDir}'; icacls '${path.join(dataDir, "admin.token")}'; icacls '${direct}'; icacls '${path.join(dataDir, "work")}'`), { cwd });
    console.log(`labels:\n${labels.out}\ndirect read: ${directRead.out.trim().slice(0, 40)}`);
    console.log(`read admin.token: exit ${token.code} ${token.out.trim()} ${token.err.trim()} | claim: ${claim.code} ${claim.err.trim()} | own: ${own.out.trim()}`);
    assert.ok(!token.out.includes("owner-bearer-token-xyz"), "admin.token is not readable");
    assert.ok(!claim.out.includes("claim-link-secret-xyz"), "the logs folder is not readable");
    assert.ok(own.out.includes("persons-own-file"), "the person's files are readable, as Claude Code reads them");

    // 5. the job ends what the engine started when its helper ends
    const marker = `vyre-low-sleeper-${process.pid}`;
    const sleeper = spawn(...((a: readonly string[]) => [a[0] as string, a.slice(1)] as const)(wrap(["cmd.exe", "/d", "/c", `title ${marker} & ping -n 120 127.0.0.1 > nul`], { cwd, env: {} })), { windowsHide: true, stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 4000));
    sleeper.kill();
    await new Promise((r) => setTimeout(r, 3000));
    const left = await run(["powershell.exe", "-NoProfile", "-Command", `@(Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" | Where-Object { $_.CommandLine -like '*-n 120 127.0.0.1*' }).Count`], { cwd });
    assert.equal(left.out.trim(), "0", "nothing the engine started outlives it");
  } finally {
    await d.close();
    api.close();
  }
});
