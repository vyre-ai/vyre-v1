// CLI engines in a Windows Personal Space (option E; owner ruling 3 Nov 2026, "Personal is personal and everything goes zero friction"): the engine runs at Low integrity in a Job Object
// (lowrun.cs). What it may change is exactly the folders labelled Low here: its work folder, its scratch home (its own config), its temp folder and the folders the person added to Vyre. It can
// read the computer as Claude Code does. Its network goes through the egress proxy by its variables; on the person's own computer a program that ignores them is accepted (the ruling).
//
// No admin, no download: the helper is compiled once from lowrun.cs by the .NET Framework compiler every Windows 10 and 11 has, into Vyre's own folder, and labelling a folder the person owns needs
// no privilege.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxError } from "../types.ts";

export const LOWRUN_SOURCE = fileURLToPath(new URL("./lowrun.cs", import.meta.url).href);

/** The compiler that ships with Windows (.NET Framework 4), 64-bit first. */
export function cscPath(env: Readonly<Record<string, string | undefined>> = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const win = env["WINDIR"] ?? env["SystemRoot"] ?? "C:\\Windows";
  for (const fw of ["Framework64", "Framework"]) {
    const p = path.win32.join(win, "Microsoft.NET", fw, "v4.0.30319", "csc.exe");
    if (exists(p)) return p;
  }
  return null;
}

/** Can this computer run engines at Low integrity? It can when the helper is built, or the compiler to build it is there. */
export function lowrunPossible(binDir: string, exists: (p: string) => boolean = fs.existsSync): boolean {
  if (cscPath(process.env, exists) !== null) return true;
  try { return fs.readdirSync(binDir).some((n) => /^vyre-lowrun-[0-9a-f]{12}\.exe$/.test(n)); } catch { return false; }
}

async function sourceHash(src: string): Promise<string> {
  return Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", fs.readFileSync(src))).toString("hex").slice(0, 12);
}

/** The helper for this version of its source, built if it is not there (a second or two, once). Throws sandbox.unavailable when it cannot be built. */
export async function ensureLowrun(binDir: string, o: { source?: string; csc?: string | null } = {}): Promise<string> {
  const src = o.source ?? LOWRUN_SOURCE;
  const exe = path.join(binDir, `vyre-lowrun-${await sourceHash(src)}.exe`);
  if (fs.existsSync(exe)) return exe;
  const csc = o.csc === undefined ? cscPath() : o.csc;
  if (csc === null) throw new SandboxError("sandbox.unavailable", "this Windows has no .NET Framework compiler to set up the engine's sandbox");
  fs.mkdirSync(binDir, { recursive: true });
  const part = `${exe}.part`;
  const r = await new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(csc, ["/nologo", "/optimize+", "/platform:anycpu", "/target:exe", `/out:${part}`, src], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.setEncoding("utf8").on("data", (d: string) => { out += d; });
    p.stderr.setEncoding("utf8").on("data", (d: string) => { out += d; });
    p.once("error", (e) => resolve({ code: null, out: e.message }));
    p.once("close", (code) => resolve({ code, out }));
  });
  if (r.code !== 0 || !fs.existsSync(part)) throw new SandboxError("sandbox.unavailable", `the engine's sandbox could not be built: ${r.out.trim().split(/\r?\n/).slice(-2).join(" ")}`);
  fs.renameSync(part, exe);
  return exe;
}

const labelled = new Set<string>();
type Runner = (cmd: string, args: readonly string[], o: { encoding: "utf8"; windowsHide: boolean; timeout: number }) => { status: number | null; stdout?: string | Buffer | null };
let runner: Runner = (cmd, args, o) => spawnSync(cmd, [...args], o);
/** Tests: what runs icacls. */
export function setLabelRunner(r: Runner | null): void { runner = r ?? ((cmd, args, o) => spawnSync(cmd, [...args], o)); }

/**
 * Labels a folder Low, with inheritance, so a Low process may write in it and in everything under it. Once per folder per process. `icacls /setintegritylevel` needs no admin on a folder the
 * person owns. Throws sandbox.policy when Windows refuses.
 */
export function labelLow(dir: string): void {
  const key = dir.toLowerCase();
  if (labelled.has(key)) return;
  fs.mkdirSync(dir, { recursive: true });
  const r = runner("icacls.exe", [dir, "/setintegritylevel", "(OI)(CI)low", "/T", "/C", "/Q"], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  if (r.status !== 0) throw new SandboxError("sandbox.policy", `Windows did not let Vyre mark ${dir} for the engine: ${String(r.stdout ?? "").trim().split(/\r?\n/).slice(-1)[0] ?? ""}`);
  labelled.add(key);
}
/** Forget which folders were labelled (tests). */
export function forgetLabels(): void { labelled.clear(); }

/**
 * The argv that starts `argv` at Low integrity with `env` added. `agentRelay`: the helper serves `pipe` (labelled Low, this user only) for the life of the job, passes each connection on to the
 * SSH agent's `target` pipe, and points SSH_AUTH_SOCK at it.
 */
export function lowrunArgv(helper: string, argv: readonly string[], env: Readonly<Record<string, string>>, o: { agentRelay?: { pipe: string; target: string } } = {}): string[] {
  const pairs = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\0");
  const relay = o.agentRelay && PIPE_NAME.test(o.agentRelay.pipe) && PIPE_NAME.test(o.agentRelay.target) ? ["--agent-relay", o.agentRelay.pipe, o.agentRelay.target] : [];
  return [helper, ...(pairs !== "" ? ["--env", Buffer.from(pairs, "utf8").toString("base64")] : []), ...relay, "--", ...argv];
}

/** A pipe's own name (what follows \\.\pipe\): letters, digits, dot, dash, underscore. */
export const PIPE_NAME = /^[A-Za-z0-9._-]{1,200}$/;

/** The pipe name of an SSH agent address (\\.\pipe\name, either slash), or null. */
export function pipeName(sock: string | undefined): string | null {
  const m = /^[\\/]{2}\.[\\/]pipe[\\/](.+)$/i.exec(sock ?? "");
  return m && PIPE_NAME.test(m[1] as string) ? (m[1] as string) : null;
}

/**
 * git's ssh on Windows: a copy of the helper named vyre-ssh-<version>.exe (its name makes it run Windows OpenSSH with -F %VYRE_SSH_CONFIG%), in `dir`, a folder the engine may read and not change.
 * Made once per helper version.
 */
export function ensureSshShim(helper: string, dir: string): string {
  const version = path.basename(helper).replace(/^vyre-lowrun-/, "").replace(/\.exe$/i, "");
  const shim = path.join(dir, `vyre-ssh-${version}.exe`);
  if (fs.existsSync(shim)) return shim;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(helper, `${shim}.part`);
  fs.renameSync(`${shim}.part`, shim);
  return shim;
}

/**
 * The labels that keep Vyre's own files from an engine that runs at Low integrity. A Low process can read whatever the person can, unless the file says "no read up":
 *   private  every FILE under the folder, at any depth, no read up and no write up (object-inherit, inherit-only): Vyre's data (admin.token, seal.key, vault-filler.key, relay.key, the
 *            databases, the logs, the webview's profile). The folders keep their default label and stay readable: programs check every folder above the one they work in (git does, for
 *            each folder it makes: "C:/.git: Permission denied" on windows-latest), and the work folders are below. A folder holds one mandatory label, so this is a single ACE.
 *   read     the folder and everything in it readable, not writable: the work and scratch roots, the engines Vyre installed, the engine's Git Bash.
 * Each is set protected and reset over what is already there. The folders an engine may change are labelled Low afterwards (labelLow).
 */
export const LABELS = { private: "S:(ML;OIIO;NRNW;;;ME)", read: "S:(ML;OICI;NW;;;ME)" } as const;

/** Sets one of LABELS on a folder with the helper. Throws sandbox.policy when Windows refuses. */
export function setLabel(helper: string, dir: string, label: keyof typeof LABELS, run: typeof spawnSync = spawnSync): void {
  fs.mkdirSync(dir, { recursive: true });
  const r = run(helper, ["--label", dir, LABELS[label]], { encoding: "utf8", windowsHide: true, timeout: 300_000 });
  if (r.status !== 0) throw new SandboxError("sandbox.policy", `Windows did not let Vyre protect ${dir}: ${String(r.stderr ?? "").trim().split(/\r?\n/).slice(-1)[0] ?? ""}`);
}
