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
import { EngineInstallError, configureEngines, enginesRoot } from "./engine-install.ts";
import type { EngineInstaller } from "./engine-install.ts";
import { defaultPlan } from "./runtime.ts";
import { cliSandboxGap } from "./sandbox-default.ts";
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

export function nodeCliReport(o: NodeCliProbe = {}): NodeCliReport {
  const platform = o.platform ?? process.platform;
  const programs = { claude: findProgram("claude", o), codex: findProgram("codex", o) };
  const exists = o.exists ?? fs.existsSync;
  let sandbox: NodeCliReport["sandbox"];
  if (platform === "linux") {
    const ok = (o.bwrapPaths ?? BWRAP).some((p) => exists(p));
    sandbox = ok ? { ok, kind: "bwrap" } : { ok, kind: "bwrap", reason: "bubblewrap (bwrap) is not installed on this server" };
  } else if (platform === "darwin") sandbox = { ok: true, kind: "seatbelt" };
  else if (platform === "win32") {
    // Windows runs the engine at Low integrity in a Job Object (sandbox/src/win), which needs the compiler Windows ships: a Windows computer reports its engines, and Automatic can pick it
    const gap = cliSandboxGap({ platform });
    sandbox = gap === null ? { ok: true, kind: "lowil" } : { ok: false, kind: "lowil", reason: gap };
  } else sandbox = { ok: false, kind: "none", reason: `engines cannot be sandboxed on ${platform}` };
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
export function nodeCliLauncher(dataDir: string, deps: NodeLauncherDeps = {}): { spawn(spec: LaunchSpec): Promise<CliProcess> } {
  const root = deps.installer ? deps.installer.root : deps.install ? enginesRoot({ dataDir }) : null;
  const installer = deps.installer ?? (root !== null ? configureEngines({ root }) : null);
  const probe: NodeCliProbe | undefined = installer ? { ...deps.probe, enginesRoot: installer.root } : deps.probe;
  // the engines folder is readable inside the sandbox, so an engine installed there can run
  const plan = defaultPlan(dataDir, installer ? [installer.root] : undefined);
  return {
    async spawn(spec) {
      const prog = spec.argv[0] ?? "";
      const name = path.basename(prog);
      if (Object.hasOwn(CLI_NAME, name) && findProgram(name, probe) === null) {
        if (!installer || !installer.supported(name)) throw new LaunchError("engine.cli_missing", `${name} is not installed on this server.`);
        try { await installer.ensure(name); }
        catch (e) { throw new LaunchError("engine.cli_missing", `${name} is not installed on this server (${e instanceof EngineInstallError ? e.reason : "failed"}).`); }
      }
      const report = nodeCliReport(probe);
      if (!report.sandbox.ok) throw new SandboxError("sandbox.unavailable", report.sandbox.reason ?? "no sandbox is available on this server");
      const argv = name === prog ? ownedArgv(spec.argv, probe) : spec.argv;
      return deps.spawn ? deps.spawn({ ...spec, argv }) : spawnCli(await plan(), spec, argv);
    },
  };
}
