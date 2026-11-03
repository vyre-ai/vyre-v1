// The CLI engines on a computer that joined a Space: what is installed here, and the launcher the node runs a pinned chat's engine with (host/src/compute/node.ts cliLauncher). The server image
// bakes Claude Code, Codex and Grok at their pinned versions (images/vyred/Dockerfile) and bubblewrap for the sandbox; a server whose image lacks one (an older image) installs it into its own engines
// folder the first time a turn needs it (engine-install.ts). This says exactly what is missing instead of failing with a bare "not found", and never starts an engine outside the sandbox.
import fs from "node:fs";
import path from "node:path";
import { LaunchError } from "../../agent/src/drivers/cli/launcher.ts";
import type { CliProcess, LaunchSpec } from "../../agent/src/drivers/cli/types.ts";
import { SandboxError } from "../../sandbox/src/index.ts";
import { CLI_NAME, findProgram } from "./cli-programs.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { EngineInstallError, configureEngines, createEngineInstaller, enginesRoot } from "./engine-install.ts";
import type { EngineInstaller } from "./engine-install.ts";
import { defaultPlan } from "./runtime.ts";
import { cliSandboxGap, defaultSandbox } from "./sandbox-default.ts";
import type { DefaultSandbox } from "./sandbox-default.ts";
import { workFolder } from "./sandbox.ts";
import type { SandboxPlan } from "./sandbox.ts";
import { ownedArgv, spawnCli } from "./session.ts";

/** The engines the report checks for. Grok is left out: current images bake it, and a server without it installs it the first time a turn needs it (engine-install.ts), as it would any of these. */
export const NODE_ENGINES = ["claude", "codex"] as const;
export { findProgram };
export type { NodeCliEnv, NodeCliProbe } from "./cli-programs.ts";
const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];

export interface NodeCliReport {
  /** Where each engine program is, or null. */
  programs: Record<(typeof NODE_ENGINES)[number], string | null>;
  sandbox: { ok: boolean; kind: string; reason?: string };
  /** One plain sentence per thing that is missing; empty when a pinned chat can run here. */
  missing: string[];
}

/**
 * On Windows this computer's engines serve Team Space turns (lane l-runson), which run in Vyre's WSL2 Linux under bubblewrap (option B, RULINGS 15): isolation from other people is the kernel's, not
 * Low integrity's (a Personal Space turn never comes here: the runtime's own opener runs it under E). So the engines looked for are Vyre's Linux builds in <engines>\wsl, and the computer offers
 * them only when WSL is on; without it Automatic skips the computer and the turn runs on the server.
 */
export const teamOnWindows = (platform: NodeJS.Platform = process.platform): boolean => platform === "win32";
/** Where the Linux builds of the engines live on a Windows computer, and how they are looked for. */
export function wslEngines(dataDir: string): { root: string; platform: "linux-x64-musl" | "linux-arm64-musl"; probe: NodeCliProbe } {
  const root = path.win32.join(enginesRoot({ dataDir }) ?? path.win32.join(dataDir, "engines"), "wsl");
  return { root, platform: process.arch === "arm64" ? "linux-arm64-musl" : "linux-x64-musl", probe: { platform: "linux", env: { PATH: "" }, enginesRoot: root } };
}

export function nodeCliReport(o: NodeCliProbe = {}): NodeCliReport {
  const platform = o.platform ?? process.platform;
  if (teamOnWindows(platform)) {
    // the Linux engines Vyre installs on the first turn that needs one; what decides is whether WSL is on
    const programs = { claude: findProgram("claude", { ...o, platform: "linux" }), codex: findProgram("codex", { ...o, platform: "linux" }) };
    const gap = cliSandboxGap({ platform, windowsMode: "contained" });
    const sandbox = gap === null ? { ok: true, kind: "wsl" } : { ok: false, kind: "wsl", reason: gap };
    return { programs, sandbox, missing: [...NODE_ENGINES.filter((n) => programs[n] === null).map((n) => `${n} is not installed on this computer`), ...(gap === null ? [] : [gap])] };
  }
  const programs = { claude: findProgram("claude", o), codex: findProgram("codex", o) };
  const exists = o.exists ?? fs.existsSync;
  let sandbox: NodeCliReport["sandbox"];
  if (platform === "linux") {
    const ok = (o.bwrapPaths ?? BWRAP).some((p) => exists(p));
    sandbox = ok ? { ok, kind: "bwrap" } : { ok, kind: "bwrap", reason: "bubblewrap (bwrap) is not installed on this server" };
  } else if (platform === "darwin") sandbox = { ok: true, kind: "seatbelt" };
  else sandbox = { ok: false, kind: "none", reason: `engines cannot be sandboxed on ${platform}` };
  const missing = [
    ...NODE_ENGINES.filter((n) => programs[n] === null).map((n) => `${n} is not installed on this server`),
    ...(sandbox.ok ? [] : [sandbox.reason ?? "no sandbox is available on this server"]),
  ];
  return { programs, sandbox, missing };
}

export interface NodeLauncherDeps {
  probe?: NodeCliProbe; spawn?: (spec: LaunchSpec) => Promise<CliProcess>;
  /** Install a missing engine into this computer's engines folder before starting it (the daemon's entry turns it on). */
  install?: boolean;
  /** The installer to use (a test's). Default: one for <data dir>/engines, made when `install` is on. */
  installer?: Pick<EngineInstaller, "root" | "supported" | "ensure">;
}

/** The node's launcher: installs a missing engine when it can, refuses with the exact reason when the engine or the sandbox is still missing, else starts the engine inside the sandbox. */
export function nodeCliLauncher(dataDir: string, deps: NodeLauncherDeps = {}): { spawn(spec: LaunchSpec): Promise<CliProcess>; workFolder(person: string, proc: string): string } {
  const team = teamOnWindows();
  const vm = team ? wslEngines(dataDir) : null;
  const root = deps.installer ? deps.installer.root : deps.install ? (vm ? vm.root : enginesRoot({ dataDir })) : null;
  // Team engines on Windows have an installer of their own: the process-wide one (engines()) is the Personal Space's, for the Windows builds
  const installer = deps.installer ?? (root === null ? null : vm ? createEngineInstaller({ root, platform: vm.platform }) : configureEngines({ root }));
  const probe: NodeCliProbe | undefined = vm ? { ...vm.probe, ...(installer ? { enginesRoot: installer.root } : {}) } : installer ? { ...deps.probe, enginesRoot: installer.root } : deps.probe;
  // the engines folder is readable inside the sandbox, so an engine installed there can run; on Windows the sandbox is the WSL one (B), built once for this computer's Team turns
  const plan = vm ? containedPlan(dataDir, installer ? [installer.root] : undefined) : defaultPlan(dataDir, installer ? [installer.root] : undefined);
  return {
    // a turn the Space sends here works in this computer's own folder for the person and the process, laid out as the sandbox requires (host/src/compute/node.ts cliRelay asks)
    workFolder: (person, proc) => workFolder(dataDir, person, proc),
    async spawn(spec) {
      const prog = spec.argv[0] ?? "";
      const name = path.basename(prog);
      if (Object.hasOwn(CLI_NAME, name) && findProgram(name, probe) === null) {
        if (!installer || !installer.supported(name)) throw new LaunchError("engine.cli_missing", `${name} is not installed on this server.`);
        try { await installer.ensure(name); }
        catch (e) { throw new LaunchError("engine.cli_missing", `${name} is not installed on this server (${e instanceof EngineInstallError ? e.reason : "failed"}).`); }
      }
      const report = nodeCliReport({ ...probe, ...(vm ? { platform: "win32" as const } : {}) });
      if (!report.sandbox.ok) throw new SandboxError("sandbox.unavailable", report.sandbox.reason ?? "no sandbox is available on this server");
      const argv = name === prog ? ownedArgv(spec.argv, probe) : spec.argv;
      return deps.spawn ? deps.spawn({ ...spec, argv }) : spawnCli(await plan(), spec, argv);
    },
  };
}

let containedBuilding: Promise<DefaultSandbox> | null = null;
let containedExtra: { wslTestRoutes?: Readonly<Record<string, number>> } = {};
/** Tests only: host names the VM's proxy routes to a local port (a fake model API in the VM). */
export function setContainedOptions(o: { wslTestRoutes?: Readonly<Record<string, number>> }): void { containedExtra = o; containedBuilding = null; }
/** The Windows sandbox for Team turns (B), built once per daemon and again after its VM stopped (`wsl --shutdown`, a Windows update). */
export function containedPlan(dataDir: string, programRead?: readonly string[]): () => Promise<SandboxPlan> {
  return async () => {
    const p = containedBuilding ??= defaultSandbox({ dataDir, windowsMode: "contained", ...(programRead ? { programRead } : {}), ...containedExtra }).then((d) => {
      if (d.plan.sandbox.kind === "wsl") void d.plan.sandbox.agent.exited.then(() => { if (containedBuilding === p) containedBuilding = null; });
      return d;
    }, (e: unknown) => { containedBuilding = null; throw e; });
    return (await p).plan;
  };
}
