// The wrap of a CLI engine in a Windows Personal Space (sandbox.ts, kind "lowil"), built on any computer: vyre-lowrun starts it with the engine's argv as it was, after the folders it may
// change are labelled Low (the person's work folders, their scratch folder, the folders they added) and with its home, config and temp in the scratch folder and the egress proxy in its variables.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxWrap, workFolder } from "../sandbox.ts";
import type { SandboxPlan } from "../sandbox.ts";
import { forgetLabels, setLabelRunner } from "../../../sandbox/src/win/lowrun.ts";
import { engineAccess } from "../../../sandbox/src/index.ts";
import { winKeyStores } from "../sandbox-default.ts";

test("the Low-integrity wrap: the helper, the engine's argv untouched, its folders labelled Low, its home and temp in scratch, the proxy", () => {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-lowil-")));
  const added = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-added-"));
  const labelled: string[] = [];
  setLabelRunner((_c, args) => { labelled.push(args[0] as string); return { status: 0 }; });
  forgetLabels();
  const plan: SandboxPlan = { dataDir: data, egressHosts: [], sandbox: { kind: "lowil", helper: "C:\\v\\vyre-lowrun-abc.exe", proxyPort: 4321, writable: [added] } };
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const argv = sandboxWrap(plan, { homeFromScratch: true })(["C:\\e\\claude.exe", "-p", "--add-dir", cwd], { cwd, env: { ANTHROPIC_API_KEY: "k" } });
  assert.equal(argv[0], "C:\\v\\vyre-lowrun-abc.exe");
  assert.equal(argv[1], "--env");
  assert.equal(argv[3], "--");
  assert.deepEqual(argv.slice(4), ["C:\\e\\claude.exe", "-p", "--add-dir", cwd]);
  const env = Object.fromEntries(Buffer.from(argv[2] as string, "base64").toString("utf8").split("\0").map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
  const scratch = path.join(data, "scratch", "usr_dana");
  assert.equal(env["HTTPS_PROXY"], "http://127.0.0.1:4321");
  assert.equal(env["NO_PROXY"], "localhost,127.0.0.1", "Vyre's MCP endpoint on loopback is reached directly");
  assert.equal(env["USERPROFILE"], path.join(scratch, "home"));
  assert.equal(env["CLAUDE_CONFIG_DIR"], path.join(scratch, "home", ".claude"));
  assert.equal(env["TEMP"], path.join(scratch, "tmp"));
  assert.ok(!("ANTHROPIC_API_KEY" in env), "the key stays in the spawn's own environment");
  assert.deepEqual(labelled, [path.join(data, "work", "usr_dana"), fs.realpathSync(scratch), added]);
  setLabelRunner(null);
  forgetLabels();
});

test("git over SSH at Low (lane l-winfix): GIT_SSH is Vyre's ssh helper with a config of its own, the agent reached through a relay pipe, CODEX_HOME made", () => {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-lowil-")));
  setLabelRunner(() => ({ status: 0 }));
  forgetLabels();
  const plan: SandboxPlan = { dataDir: data, egressHosts: [], sandbox: { kind: "lowil", helper: "C:\\v\\vyre-lowrun-abc.exe", proxyPort: 4321, ssh: "C:\\d\\engines\\vyre-ssh\\vyre-ssh-abc.exe" } };
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const access = engineAccess({ where: "own", home: os.homedir(), dataDir: data, platform: "win32", sshAuthSock: "\\\\.\\pipe\\openssh-ssh-agent", exists: () => false });
  const argv = sandboxWrap(plan, { homeFromScratch: true, access })(["git", "clone", "ssh://git@example.com/x.git"], { cwd, env: {} });
  const relayAt = argv.indexOf("--agent-relay");
  assert.ok(relayAt > 0 && relayAt < argv.indexOf("--"));
  assert.match(argv[relayAt + 1] as string, /^vyre-agent-\d+-[0-9a-f]{12}$/);
  assert.equal(argv[relayAt + 2], "openssh-ssh-agent");
  const env = Object.fromEntries(Buffer.from(argv[2] as string, "base64").toString("utf8").split("\0").map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
  assert.equal(env["GIT_SSH"], "C:\\d\\engines\\vyre-ssh\\vyre-ssh-abc.exe");
  assert.equal(env["GIT_SSH_VARIANT"], "ssh");
  assert.equal(env["GIT_SSH_COMMAND"], undefined, "no shell: GIT_SSH_COMMAND would win over GIT_SSH and go through sh");
  const config = fs.readFileSync(env["VYRE_SSH_CONFIG"] as string, "utf8");
  assert.match(config, /^ {2}ProxyCommand ".*node(\.exe)?" ".*connect\.mjs" 4321 %h %p$/m);
  assert.ok(config.includes(`  IdentityAgent "\\\\\\\\.\\\\pipe\\\\${argv[relayAt + 1]}"`), config);
  assert.ok(fs.existsSync(env["CODEX_HOME"] as string), "codex.exe refuses a CODEX_HOME that is not there");
  setLabelRunner(null);
  forgetLabels();
});

test("the person's key stores on Windows: the ones there, folders private, single files private, ~/.ssh's known_hosts and config readable, never Vyre's own", () => {
  const home = "C:\\Users\\dana";
  const there: Record<string, "dir" | "file"> = {
    [`${home}\\.ssh`]: "dir", [`${home}\\.git-credentials`]: "file", [`${home}\\AppData\\Roaming\\Microsoft\\Credentials`]: "dir", [`${home}\\AppData\\Local\\Google\\Chrome\\User Data`]: "dir",
    [`${home}\\AppData\\Roaming\\ai.vyre.desktop`]: "dir",
  };
  const stat = (p: string) => (there[p] ? ({ isDirectory: () => there[p] === "dir" } as fs.Stats) : undefined);
  const ks = winKeyStores(home, [`${home}\\AppData\\Roaming\\ai.vyre.desktop`], stat, () => ["id_ed25519", "id_ed25519.pub", "known_hosts", "config", "authorized_keys"]);
  assert.deepEqual([...ks.dirs].sort(), [`${home}\\.ssh`, `${home}\\AppData\\Local\\Google\\Chrome\\User Data`, `${home}\\AppData\\Roaming\\Microsoft\\Credentials`].sort());
  assert.deepEqual(ks.files, [`${home}\\.git-credentials`]);
  assert.deepEqual([...ks.readable].sort(), [`${home}\\.ssh\\config`, `${home}\\.ssh\\id_ed25519.pub`, `${home}\\.ssh\\known_hosts`]);
});

test("an added folder that holds a key store: icacls labels it Low, then the key store is made private again before the engine starts", () => {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-lowil-")));
  const added = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-added-"));
  const calls: string[][] = [];
  setLabelRunner((c, args) => { calls.push([c, ...args]); return { status: 0 }; });
  forgetLabels();
  const inside = `${added}\\.ssh`;
  const keyStores = { dirs: [inside, "C:\\Elsewhere\\Credentials"], files: [], readable: [`${inside}\\known_hosts`] };
  const plan: SandboxPlan = { dataDir: data, egressHosts: [], sandbox: { kind: "lowil", helper: "C:\\v\\vyre-lowrun-abc.exe", proxyPort: 4321, writable: [added], keyStores } };
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const wrap = sandboxWrap(plan, { homeFromScratch: true });
  wrap(["C:\\e\\claude.exe", "-p"], { cwd, env: {} });
  const labels = calls.filter((c) => c[1] === "--label").map((c) => [c[2], c[3]]);
  assert.deepEqual(labels, [[inside, "S:(ML;OIIO;NRNW;;;ME)"], [`${inside}\\known_hosts`, "S:(ML;;NW;;;ME)"]], "only the store inside the added folder, after icacls");
  assert.ok(calls.findIndex((c) => c[1] === "--label") > calls.findIndex((c) => c[0] === "icacls.exe" && c[1] === added));
  calls.length = 0;
  wrap(["C:\\e\\claude.exe", "-p"], { cwd, env: {} });
  assert.equal(calls.length, 0, "once: the folders are labelled already");
  setLabelRunner(null);
  forgetLabels();
});
