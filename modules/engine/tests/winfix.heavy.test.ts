// Windows parity for the l-openweb, l-skills1 and l-livemodels work, for real (VYRE_HEAVY_WINFIX=1 on a Windows runner; lane l-winfix). Vyre's own path from an empty computer, as the
// Personal Space proof (sandbox.lowil.heavy.test.ts) runs it: defaultSandbox builds vyre-lowrun, installEngine puts the pinned Windows engines in place, sandboxWrap starts them at Low integrity.
//   1. claude.exe and codex.exe list their models through the sandbox, and each exits by itself once its input closes (no kill: on Windows that is TerminateProcess).
//   2. native skills, one with file names Windows cannot hold and a file past MAX_PATH, are written and claude.exe lists the skill and reads both files.
//   3. a folder the person added, with a space in its path, reaches the Low engine through mounts' path check and engine-access: it reads and changes files there.
//   4. git over SSH through the proxy with Windows OpenSSH, signed by the ssh-agent service over its named pipe, the key never on disk where the engine looks.
//   5. Codex's plugin launcher starts a .cmd server with the secret moved to its own name and every argument whole.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { defaultSandbox } from "../sandbox-default.ts";
import { sandboxWrap, workFolder } from "../sandbox.ts";
import type { SandboxPlan } from "../sandbox.ts";
import { installEngine } from "../engine-install.ts";
import { accessHere } from "../session.ts";
import { syncNativeSkills } from "../skills-native.ts";
import { createLocalLauncher } from "../../../agent/src/drivers/cli/launcher.ts";
import { listCliModels } from "../../../agent/src/drivers/cli/models.ts";
import { codexServer } from "../../../agent/src/drivers/cli/codex.ts";
import type { CliProcess, Launcher } from "../../../agent/src/drivers/cli/types.ts";
import { PUBLIC_RULE, addedFolder, createEgressProxy } from "../../../sandbox/src/index.ts";

const ON = process.env["VYRE_HEAVY_WINFIX"] === "1" && process.platform === "win32";

const MAIN_PROMPT = "Read the skill's files.";

/** A fake model API: each request answers with the next scripted tool call, or "done" when every one has its result; it records the tool results and whether a text was in the request. */
function fakeApi(steps: Array<{ name: string; input: Record<string, unknown> }>, log: string[]): Promise<{ port: number; bodies: string[]; close(): void }> {
  const bodies: string[] = [];
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += String(d); });
    req.on("end", () => {
      let j: { messages?: unknown; model?: string } = {};
      try { j = JSON.parse(body || "{}") as typeof j; } catch { /* not json */ }
      if (String(req.url).includes("count_tokens")) { res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":1}'); return; }
      if (!String(req.url).startsWith("/v1/messages")) { res.writeHead(200, { "content-type": "application/json" }).end("{}"); return; }
      bodies.push(body);
      const results = [...JSON.stringify(j.messages ?? []).matchAll(/"type":"tool_result".{0,600}/g)].map((m) => m[0]);
      for (const r of results) if (!log.includes(`toolResult ${r}`)) log.push(`toolResult ${r}`);
      // side requests (a title, a summary) are answered with text: only the conversation that carries the prompt gets the tool calls
      const main = body.includes(MAIN_PROMPT);
      log.push(`request ${main ? "main" : "side"} ${j.model ?? ""} results=${results.length}`);
      const step = main ? steps[results.length] : undefined;
      const msg = { id: "msg_1", type: "message", role: "assistant", model: j.model ?? "fake", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      const block = step ? { type: "tool_use", id: `toolu_${results.length + 1}`, name: step.name, input: {} } : { type: "text", text: "" };
      const delta = step ? { type: "input_json_delta", partial_json: JSON.stringify(step.input) } : { type: "text_delta", text: "done" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [e, d] of [["message_start", { type: "message_start", message: msg }], ["content_block_start", { type: "content_block_start", index: 0, content_block: block }], ["content_block_delta", { type: "content_block_delta", index: 0, delta }], ["content_block_stop", { type: "content_block_stop", index: 0 }], ["message_delta", { type: "message_delta", delta: { stop_reason: step ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }], ["message_stop", { type: "message_stop" }]] as const) res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
      res.end();
    });
  });
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve({ port: (s.address() as { port: number }).port, bodies, close: () => s.close() })));
}

const ps = (script: string): string[] => ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];

function run(argv: readonly string[], o: { cwd: string; env?: Record<string, string>; ms?: number; input?: string }): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    // Windows names variables without regard to case: one given here replaces the inherited one of any case (Path and PATH)
    const env: Record<string, string | undefined> = { ...process.env };
    for (const [k, v] of Object.entries(o.env ?? {})) { for (const e of Object.keys(env)) if (e.toUpperCase() === k.toUpperCase()) delete env[e]; env[k] = v; }
    const p = spawn(argv[0] as string, argv.slice(1), { cwd: o.cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    p.stdout.setEncoding("utf8").on("data", (d: string) => { out += d; });
    p.stderr.setEncoding("utf8").on("data", (d: string) => { err += d; });
    const t = setTimeout(() => p.kill(), o.ms ?? 240_000);
    p.once("error", (e) => { err += String(e); });
    p.once("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.stdin.end(o.input ?? "");
  });
}

describe("Windows parity (lane l-winfix)", { skip: !ON && "VYRE_HEAVY_WINFIX=1 on a Windows runner", timeout: 40 * 60_000 }, () => {
  let box = "", dataDir = "", cwd = "", claude = "", codex = "";
  let d: Awaited<ReturnType<typeof defaultSandbox>>;
  before(async () => {
    box = fs.mkdtempSync(path.join(process.env["LOCALAPPDATA"] as string, "vyre-winfix-proof-"));
    dataDir = path.join(box, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    claude = await installEngine("claude", { root: path.join(dataDir, "engines"), platform: "win32-x64" });
    codex = await installEngine("codex", { root: path.join(dataDir, "engines"), platform: "win32-x64" });
    d = await defaultSandbox({ platform: "win32", dataDir, winBin: path.join(box, "bin") });
    assert.equal(d.plan.sandbox.kind, "lowil");
    cwd = workFolder(dataDir, "usr_dana", "thr_1");
  });
  after(async () => { await d?.close(); });

  test("1. claude.exe and codex.exe list their models at Low integrity, and each ends by itself when its input closes", async () => {
    const log: string[] = [];
    const api = await fakeApi([], log);
    try {
      for (const [cli, exe] of [["codex", codex], ["claude_code", claude]] as const) {
        const kills: string[] = [];
        const local = createLocalLauncher({ wrap: sandboxWrap(d.plan, { homeFromScratch: true }), baseEnv: { ...process.env } as Record<string, string> });
        const launcher: Launcher = {
          async spawn(spec) {
            const p = await local.spawn({ ...spec, argv: [exe, ...spec.argv.slice(1)] });
            return Object.create(p, { kill: { value: (sig?: "SIGTERM" | "SIGKILL") => { kills.push(sig ?? "SIGTERM"); p.kill(sig); } } }) as CliProcess;
          },
        };
        const t0 = Date.now();
        const models = await listCliModels(launcher, cli, { cwd, env: { ANTHROPIC_API_KEY: "sk-ant-fake", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` }, timeoutMs: 120_000, graceMs: 10_000 });
        console.log(`${cli}: ${models.length} models in ${Date.now() - t0} ms: ${models.map((m) => `${m.id}${m.isDefault ? "*" : ""}`).join(", ")}; kills: ${kills.join(",") || "none"}`);
        assert.ok(models.length > 0, `${cli} listed its models`);
        assert.ok(models.every((m) => typeof m.id === "string" && m.id !== ""));
        assert.deepEqual(kills, [], `${cli} exited when its input closed; nothing was killed`);
      }
    } finally { api.close(); }
  });

  test("2. native skills, with names Windows cannot hold, a deep file and one past MAX_PATH, are written (the last left out) and claude.exe lists and reads them", async () => {
    const deepRel = `references/${"deep-folder-".repeat(3)}/${"long-file-name-".repeat(3)}.md`;
    const tooDeepRel = `references/${"deep-folder-name-".repeat(6)}/${"a-very-long-file-name-".repeat(5)}.md`;
    const name = "winfix-proof-a-skill-whose-name-is-longer-than-forty-characters";
    const lib = [{ name, files: { "notes: draft?.md": "BADNAME-CONTENT-7f3", "CON.txt": "DEVICE-NAME-CONTENT-2c1", [deepRel]: "DEEP-CONTENT-9b4", [tooDeepRel]: "TOO-DEEP", "skill.md": "must not replace SKILL.md" } }];
    const text = `---\nname: ${name}\ndescription: Proof that Windows skills are written and read (WINFIX-DESC-51a)\n---\n\nRead the files beside this skill.\n`;
    const call = async (cap: string): Promise<unknown> => {
      if (cap === "skills.list") return { skills: lib.map((l) => ({ name: l.name, tier: "space", source: "upload", hash: "1" })) };
      return { skill: { name, text, files: Object.entries(lib[0]!.files).map(([p, t]) => ({ path: p, text: t })) } };
    };
    const logs: string[] = [];
    const r = await syncNativeSkills({ call, log: (m, a) => { logs.push(`${m} ${JSON.stringify(a)}`); } }, "claude_code", "agt_1", "usr_dana", cwd);
    const dir = name.slice(0, 40);
    assert.deepEqual(r, { written: [dir] }, logs.join("\n"));
    const root = path.join(cwd, ".claude", "skills", dir);
    const listing = await run(ps(`Get-ChildItem -LiteralPath '${root}' -Recurse -File | ForEach-Object { $_.FullName.Length.ToString() + ' ' + $_.FullName.Substring(${root.length}) }`), { cwd });
    console.log(`work folder: ${cwd} (${cwd.length}); SKILL.md: ${path.join(root, "SKILL.md").length}\nwritten:\n${listing.out}\nlogs: ${logs.join(" | ")}`);
    const badName = path.join(root, "notes_ draft_.md");
    const device = path.join(root, "_CON.txt");
    const deep = path.join(root, ...deepRel.split("/"));
    assert.ok(deep.length < 260, `the deep file fits (${deep.length})`);
    assert.equal(fs.readFileSync(path.join(root, "SKILL.md"), "utf8"), text);
    for (const f of [badName, device, deep]) assert.ok(fs.existsSync(f), f);
    assert.ok(!fs.existsSync(path.join(root, ...tooDeepRel.split("/"))), "the file past MAX_PATH is left out");
    assert.ok(logs.some((l) => l.includes("too long for Windows")), "and logged");

    const log: string[] = [];
    const api = await fakeApi([{ name: "Read", input: { file_path: deep } }, { name: "Read", input: { file_path: badName } }, { name: "Read", input: { file_path: device } }], log);
    try {
      const env = { ANTHROPIC_API_KEY: "sk-ant-fake", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };
      const wrap = sandboxWrap(d.plan, { homeFromScratch: true });
      const turn = await run(wrap([claude, "-p", MAIN_PROMPT, "--output-format", "text", "--permission-mode", "bypassPermissions", "--model", "claude-sonnet-4-5", "--debug"], { cwd, env }), { cwd, env, ms: 180_000 });
      console.log(`claude: exit ${turn.code}\n${turn.out.slice(-400)}\n${turn.err.slice(-6000)}\nresults: ${log.join("\n").slice(-4000)}`);
      assert.equal(turn.code, 0, turn.err.slice(-800));
      assert.ok(api.bodies.some((b) => b.includes("winfix-proof") && b.includes("WINFIX-DESC-51a")), "claude.exe lists the skill from .claude/skills of its folder");
      for (const marker of ["BADNAME-CONTENT-7f3", "DEVICE-NAME-CONTENT-2c1", "DEEP-CONTENT-9b4"]) assert.ok(log.some((l) => l.includes(marker)), `claude.exe read ${marker}`);
    } finally { api.close(); }
  });

  test("3. a folder the person added, with a space in its path, is read and changed by the Low engine; a folder not added is not changed", async () => {
    const added = path.join(box, "Client Files 2026");
    const other = path.join(box, "Not Added");
    fs.mkdirSync(added, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(added, "brief.txt"), "ADDED-FOLDER-READ-4e2");
    // as mounts.engine_folders hands it on and engine-access checks it on this machine
    assert.equal(addedFolder(added.replace(/\\/g, "/"), dataDir, { platform: "win32" }), added);
    const access = accessHere(dataDir, cwd, { where: "own", folders: [added] });
    assert.deepEqual(access.added, [added]);
    const wrap = sandboxWrap(d.plan, { homeFromScratch: true, access, basePath: process.env["PATH"] ?? "" });
    const read = await run(wrap(ps(`Get-Content -LiteralPath '${path.join(added, "brief.txt")}'`), { cwd, env: {} }), { cwd, ms: 60_000 });
    const write = await run(wrap(ps(`Set-Content -LiteralPath '${path.join(added, "from-engine.txt")}' -Value engine-wrote`), { cwd, env: {} }), { cwd, ms: 60_000 });
    const no = await run(wrap(ps(`Set-Content -LiteralPath '${path.join(other, "from-engine.txt")}' -Value x`), { cwd, env: {} }), { cwd, ms: 60_000 });
    console.log(`read: ${read.code} ${read.out.trim()} ${read.err.trim()} | write: ${write.code} ${write.err.trim()} | not added: ${no.code} ${no.err.trim().slice(0, 200)}`);
    assert.ok(read.out.includes("ADDED-FOLDER-READ-4e2"), "the engine reads the added folder");
    assert.equal(fs.readFileSync(path.join(added, "from-engine.txt"), "utf8").trim(), "engine-wrote", "the engine changes the added folder");
    assert.ok(!fs.existsSync(path.join(other, "from-engine.txt")), "a folder not added is not changed");
  });

  test("4. git over SSH through the proxy, Windows OpenSSH signing with the ssh-agent service's key over its named pipe", { skip: !process.env["VYRE_PROOF_SSH2"] && "the workflow installs ssh2 and starts ssh-agent (VYRE_PROOF_SSH2)" }, async () => {
    const req = createRequire(path.join(process.env["VYRE_PROOF_SSH2"] as string, "noop.js"));
    const ssh2 = req("ssh2") as { Server: new (o: unknown, cb: (c: any) => void) => net.Server; utils: { parseKey(k: Buffer): any } };
    const keys = path.join(box, "keys");
    fs.mkdirSync(keys, { recursive: true });
    const keygen = (f: string) => spawnSync("C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe", ["-q", "-t", "ed25519", "-N", "", "-C", "winfix", "-f", f], { encoding: "utf8" });
    for (const f of ["host", "user"]) { const k = keygen(path.join(keys, f)); assert.equal(k.status, 0, k.stderr); }
    // the private key goes into the agent and off the disk: the engine signs only through the pipe
    spawnSync("icacls.exe", [path.join(keys, "user"), "/inheritance:r", "/grant:r", `${os.userInfo().username}:F`], { encoding: "utf8" });
    const add = spawnSync("C:\\Windows\\System32\\OpenSSH\\ssh-add.exe", [path.join(keys, "user")], { encoding: "utf8" });
    assert.equal(add.status, 0, `${add.stdout} ${add.stderr}`);
    fs.rmSync(path.join(keys, "user"));
    const allowed = ssh2.utils.parseKey(fs.readFileSync(path.join(keys, "user.pub")));
    // a bare repository the server serves with git upload-pack
    const repo = path.join(box, "served.git");
    const seed = path.join(box, "seed");
    fs.mkdirSync(seed, { recursive: true });
    fs.writeFileSync(path.join(seed, "README"), "SSH-CLONE-CONTENT-8d0");
    for (const a of [["init", "-q", "-b", "main"], ["add", "README"], ["-c", "user.name=v", "-c", "user.email=v@v", "commit", "-q", "-m", "seed"], ["clone", "-q", "--bare", seed, repo]]) {
      const g = spawnSync("git", a, { cwd: seed, encoding: "utf8" });
      assert.equal(g.status, 0, g.stderr);
    }
    const signed: string[] = [];
    const seen: string[] = [];
    const server = new ssh2.Server({ hostKeys: [fs.readFileSync(path.join(keys, "host"))] }, (client: any) => {
      client.on("authentication", (ctx: any) => {
        seen.push(`auth ${ctx.method} ${ctx.username} ${ctx.key?.algo ?? ""} sig=${Boolean(ctx.signature)}`);
        if (ctx.method === "publickey" && ctx.key.algo === allowed.type && Buffer.compare(ctx.key.data, allowed.getPublicSSH()) === 0) {
          if (!ctx.signature) return ctx.accept();
          if (allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) { signed.push(ctx.username); return ctx.accept(); }
        }
        return ctx.reject(["publickey"]);
      }).on("ready", () => {
        client.on("session", (accept: () => any) => {
          accept().once("exec", (ok: () => any, _no: unknown, info: { command: string }) => {
            const stream = ok();
            seen.push(`exec ${info.command}`);
            const p = spawn("git", ["upload-pack", repo], { windowsHide: true });
            stream.pipe(p.stdin); p.stdout.pipe(stream); p.stderr.pipe(stream.stderr);
            p.on("exit", (code) => { stream.exit(code ?? 1); stream.end(); });
          });
        });
      }).on("error", (e: Error) => { seen.push(`error ${e.message}`); });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const sshPort = (server.address() as net.AddressInfo).port;
    // the turn's proxy, as the sandbox runs it, with a public host name that leads to this server: the proxy checks the name and the address it resolves to, then connects here
    const proxy = createEgressProxy({ allow: [], rule: PUBLIC_RULE, lookup: async () => ["93.184.215.14"], connect: (_h, _p, _ip) => new Promise((ok, bad) => { const s = net.connect(sshPort, "127.0.0.1", () => ok(s)); s.once("error", bad); }) });
    const { port } = await proxy.listen();
    try {
      const plan: SandboxPlan = { ...d.plan, sandbox: { ...(d.plan.sandbox as Extract<SandboxPlan["sandbox"], { kind: "lowil" }>), proxyPort: port } };
      const access = accessHere(dataDir, cwd, { where: "own", folders: [] });
      console.log(`agent: ${access.sshAuthSock}`);
      assert.equal(access.sshAuthSock, "\\\\.\\pipe\\openssh-ssh-agent");
      const wrap = sandboxWrap(plan, { homeFromScratch: true, access, basePath: process.env["PATH"] ?? "" });
      const keysAtLow = await run(wrap(["C:\\Windows\\System32\\OpenSSH\\ssh-add.exe", "-l"], { cwd, env: {} }), { cwd, ms: 60_000 });
      console.log(`ssh-add -l at Low: exit ${keysAtLow.code} ${keysAtLow.out.trim()} ${keysAtLow.err.trim()}`);
      const clone = await run(wrap(["git", "clone", "-q", "ssh://git@git.vyre-proof.example/served.git", "over-ssh"], { cwd, env: { GIT_TRACE: "1" } }), { cwd, ms: 180_000 });
      const cfg = fs.readdirSync(path.join(dataDir, "s")).map((p) => path.join(dataDir, "s", p, "home", ".ssh", "vyre_config")).find((f) => fs.existsSync(f));
      console.log(`vyre_config:\n${cfg ? fs.readFileSync(cfg, "utf8") : "(none)"}`);
      console.log(`git clone over ssh: exit ${clone.code}\n${clone.err.slice(-2500)}\nserver: ${seen.join(" | ")}`);
      if (clone.code !== 0) {
        const shim = (plan.sandbox as { ssh?: string }).ssh as string;
        const direct = await run(wrap([shim, "-v", "git@git.vyre-proof.example", "git-upload-pack '/served.git'"], { cwd, env: {} }), { cwd, ms: 60_000, input: "0000" });
        console.log(`ssh through the shim: exit ${direct.code}\n${direct.out.slice(0, 300)}\n${direct.err.slice(-4000)}\nserver: ${seen.join(" | ")}`);
      }
      assert.equal(keysAtLow.code, 0, "the Low engine reaches the agent's named pipe");
      assert.equal(clone.code, 0, clone.err.slice(-800));
      assert.equal(fs.readFileSync(path.join(cwd, "over-ssh", "README"), "utf8"), "SSH-CLONE-CONTENT-8d0");
      assert.ok(signed.length > 0, "the server checked a signature the agent made");
    } finally { await proxy.close(); server.close(); }
  });

  test("5. Codex's plugin launcher starts a .cmd server with the secret under its own name and every argument whole", async () => {
    const dir = path.join(box, "plugin server");
    fs.mkdirSync(dir, { recursive: true });
    const dump = path.join(dir, "dump.js");
    fs.writeFileSync(dump, "console.log(JSON.stringify({ token: process.env.ACME_TOKEN ?? null, vyre: process.env.VYRE_PLUGIN_1 ?? null, args: process.argv.slice(2) }));\n");
    fs.writeFileSync(path.join(dir, "acme-mcp.cmd"), `@echo off\r\n"${process.execPath}" "${dump}" %*\r\n`);
    const m = codexServer({ command: "acme-mcp", args: ["a b", "x&y|z", "100%", "say \"hi\""], env: { ACME_TOKEN: "${VYRE_PLUGIN_1}" } })!;
    const r = await run([m.command, ...m.args], { cwd: dir, env: { VYRE_PLUGIN_1: "s3cr3t", PATH: `${dir};${process.env["PATH"] ?? ""}` }, ms: 60_000 });
    console.log(`launcher: exit ${r.code} ${r.out.trim()} ${r.err.trim()}`);
    assert.equal(r.code, 0, r.err);
    const got = JSON.parse(r.out.trim().split(/\r?\n/).at(-1) as string) as { token: string | null; vyre: string | null; args: string[] };
    assert.equal(got.token, "s3cr3t");
    assert.equal(got.vyre, null);
    assert.deepEqual(got.args, ["a b", "x&y|z", "100%", "say \"hi\""]);
  });
});
