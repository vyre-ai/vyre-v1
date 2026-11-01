// The CLI engines on a computer that joined a Space: what is installed here, and the launcher the node runs a pinned chat's engine with (host/src/compute/node.ts cliLauncher). The server image
// ships Claude Code and Codex (images/vyred/Dockerfile) and bubblewrap for the sandbox. This says exactly what is missing instead of failing with a bare "not found", and never starts an engine
// outside the sandbox.
import fs from "node:fs";
import path from "node:path";
import { LaunchError } from "../../agent/src/drivers/cli/launcher.ts";
import type { CliProcess, LaunchSpec } from "../../agent/src/drivers/cli/types.ts";
import { SandboxError } from "../../sandbox/src/index.ts";
import { findProgram } from "./cli-programs.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { defaultPlan } from "./runtime.ts";
import { spawnCli } from "./session.ts";

/** The engines a server is expected to run. Grok is the person's own on their computer; a server image does not ship it. */
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
  else sandbox = { ok: false, kind: "none", reason: `engines cannot be sandboxed on ${platform}` };
  const missing = [
    ...NODE_ENGINES.filter((n) => programs[n] === null).map((n) => `${n} is not installed on this server`),
    ...(sandbox.ok ? [] : [sandbox.reason ?? "no sandbox is available on this server"]),
  ];
  return { programs, sandbox, missing };
}

export interface NodeLauncherDeps { probe?: NodeCliProbe; spawn?: (spec: LaunchSpec) => Promise<CliProcess> }

/** The node's launcher: refuses with the exact reason when the engine or the sandbox is missing, else starts the engine inside the sandbox. */
export function nodeCliLauncher(dataDir: string, deps: NodeLauncherDeps = {}): { spawn(spec: LaunchSpec): Promise<CliProcess> } {
  const plan = defaultPlan(dataDir);
  return {
    async spawn(spec) {
      const prog = spec.argv[0] ?? "";
      const name = path.basename(prog);
      if ((NODE_ENGINES as readonly string[]).includes(name) && findProgram(name, deps.probe) === null) throw new LaunchError("engine.cli_missing", `${name} is not installed on this server.`);
      const report = nodeCliReport(deps.probe);
      if (!report.sandbox.ok) throw new SandboxError("sandbox.unavailable", report.sandbox.reason ?? "no sandbox is available on this server");
      return deps.spawn ? deps.spawn(spec) : spawnCli(await plan(), spec, spec.argv);
    },
  };
}
