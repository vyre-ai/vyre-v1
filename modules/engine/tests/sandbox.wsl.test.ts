// The wrap of a CLI engine in the Windows sandbox (sandbox.ts, kind "wsl"), built on Linux with a stand-in for the VM's paths: wsl.exe starts bwrap as Vyre's unprivileged user in its distribution,
// with the walled Linux profile (no network but the wall, the work folder read-write, the scratch home as home), every folder and Windows-path argument as the VM sees it, none of Windows'
// own variables, Alpine's /bin and /lib bound as they are, and the turn's egress policy sent to the agent first.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxWrap, workFolder } from "../sandbox.ts";
import type { SandboxPlan } from "../sandbox.ts";

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-wslwrap-")));
const vm = (p: string): string => `/mnt/x${p}`;

test("the WSL wrap: wsl.exe, bwrap as vyre, the walled profile in VM paths, no Windows variables, the turn's policy first", () => {
  const policies: unknown[] = [];
  const agent = { wallDir: "/home/vyre/.vyre-run/vyre-net-abc", splitUsr: true, node: "/usr/bin/node", setPolicy: (w: unknown) => policies.push(w), openMcp: async () => "", closeMcp: () => undefined, close: async () => undefined, exited: new Promise<void>(() => undefined) };
  const plan: SandboxPlan = { dataDir: data, egressHosts: ["api.anthropic.com"], sandbox: { kind: "wsl", distro: "vyre-sandbox", user: "vyre", agent, wall: { allow: ["api.anthropic.com"] }, programRead: ["C:\\Users\\dana\\AppData\\Roaming\\ai.vyre.desktop\\engines\\wsl"], vmPath: (p) => (/^[A-Za-z]:/.test(p) ? `/mnt/c/${p.slice(3).replace(/\\/g, "/")}` : vm(p)) } };
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const argv = sandboxWrap(plan, { homeFromScratch: true })(["C:\\e\\claude", "-p", "--add-dir", "C:\\w\\thr_1", "--model", "x"], { cwd, env: { ANTHROPIC_API_KEY: "k", VYRE_MCP_TOKEN: "t", SystemRoot: "C:\\Windows", Path: "C:\\x", USERPROFILE: "C:\\Users\\dana", APPDATA: "C:\\a" } });
  assert.deepEqual(argv.slice(1, 9), ["-d", "vyre-sandbox", "-u", "vyre", "--cd", "/", "--exec", "/usr/bin/bwrap"]);
  assert.match(argv[0] as string, /wsl\.exe$/);
  const a = argv.slice(9);
  const at = (flag: string, v: string): boolean => a.some((x, i) => x === flag && a[i + 1] === v);
  assert.ok(a.includes("--unshare-all") && !a.includes("--share-net"), "no network but the wall");
  assert.ok(at("--bind", vm(cwd)), "the work folder, read-write, as the VM sees it");
  assert.ok(at("--chdir", vm(cwd)));
  assert.ok(at("--ro-bind", agent.wallDir), "the wall");
  assert.ok(at("--ro-bind-try", "/lib") && !a.includes("--symlink"), "Alpine's /lib as it is");
  assert.ok(at("--ro-bind-try", "/mnt/c/Users/dana/AppData/Roaming/ai.vyre.desktop/engines/wsl"), "Vyre's Linux engines, read-only");
  const tail = a.slice(a.lastIndexOf("--") + 1);
  assert.deepEqual(tail, ["/mnt/c/e/claude", "-p", "--add-dir", "/mnt/c/w/thr_1", "--model", "x"], "Windows-path arguments in VM paths, the rest as they were");
  const envs = new Map<string, string>();
  for (let i = 0; i < a.length; i++) if (a[i] === "--setenv") envs.set(a[i + 1] as string, a[i + 2] as string);
  assert.equal(envs.get("ANTHROPIC_API_KEY"), "k");
  assert.equal(envs.get("VYRE_MCP_TOKEN"), "t");
  assert.equal(envs.get("USE_BUILTIN_RIPGREP"), "0");
  assert.equal(envs.get("SHELL"), "/bin/bash");
  for (const k of ["SystemRoot", "Path", "USERPROFILE", "APPDATA"]) assert.ok(!envs.has(k), `${k} stays on Windows`);
  assert.deepEqual(policies, [{ allow: ["api.anthropic.com"] }]);
  assert.throws(() => sandboxWrap(plan)(["claude"], { cwd: path.join(data, "elsewhere"), env: {} }), (e: { code?: string }) => e.code === "sandbox.policy", "only the Space's own work folders");
});
