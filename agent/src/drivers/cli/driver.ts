// The three CLI drivers behind the engine's driver port (ARCH 6.6): Claude Code, Codex, Grok Build. They plug into the warm pool beside the API drivers (agent/src/pool): `kind: "cli"`,
// a session bound to one thread, a process kept warm between turns.
import { DriverError } from "../api/driver.ts";
import type { ProbeOutcome } from "../api/driver.ts";
import type { AccountRef, ModelInfo } from "../api/types.ts";
import type { SessionSpec } from "../../turn-engine/types.ts";
import { claudeCode } from "./claude.ts";
import { codex } from "./codex.ts";
import { classifyCli } from "./errors.ts";
import { grok } from "./grok.ts";
import { LaunchError } from "./launcher.ts";
import { lines } from "./lines.ts";
import { createCliSession } from "./session.ts";
import type { CliSession, CliSessionDeps } from "./session.ts";
import type { CliAdapter, CliId, Launcher, McpEndpoint } from "./types.ts";

export const CLI_ADAPTERS: Readonly<Record<CliId, CliAdapter>> = Object.freeze({ claude_code: claudeCode, codex, grok });

export interface CliDriverDeps {
  launcher: Launcher;
  /** The loopback MCP session for this engine session: the address of the MCP server and a token that encodes {principal, actingFor, thread, run, trace} (ARCH 6.6). */
  mcp(spec: SessionSpec): Promise<McpEndpoint>;
  /** The session ended: revoke its token. */
  mcpClose?(spec: SessionSpec, endpoint: McpEndpoint): Promise<void> | void;
  /** The engine session id a checkpoint left for this thread and agent, if any. */
  resume?(spec: SessionSpec): string | null;
  system?(spec: SessionSpec): string | null;
  workFolder?(spec: SessionSpec): string | null;
  env?(spec: SessionSpec): Record<string, string>;
  planMode?(spec: SessionSpec): boolean;
  prompt?: CliSessionDeps["prompt"];
  /** Models an account can reach, when the host knows better than the built-in list (a subscription's plan). */
  modelsFor?(acct: AccountRef): Promise<ModelInfo[]> | ModelInfo[];
  idleMs?: number;
  graceMs?: number;
  /** Start a persistent engine's process when the session opens, before anyone waits for it. Default true. */
  prewarm?: boolean;
}

export interface CliDriver {
  readonly kind: "cli";
  readonly id: CliId;
  models(acct: AccountRef): Promise<ModelInfo[]>;
  /** "Test this engine": the program starts and answers `--version`. No Space data, no sign-in needed. */
  probe(acct: AccountRef): Promise<ProbeOutcome>;
  open(spec: SessionSpec): Promise<CliSession>;
}

const PREFIX = /^(claude_code|codex|grok)\//;

export function createCliDriver(adapter: CliAdapter, deps: CliDriverDeps): CliDriver {
  const graceMs = deps.graceMs ?? 1_500;
  return {
    kind: "cli",
    id: adapter.id,
    async models(acct) { return deps.modelsFor ? [...(await deps.modelsFor(acct))] : [...adapter.models]; },
    async probe(acct) {
      void acct;
      try {
        const proc = await deps.launcher.spawn({ argv: [adapter.bin, "--version"], env: {} });
        proc.endInput();
        let out = "";
        const reading = (async () => { for await (const l of lines(proc.stdout)) out += `${l}\n`; })().catch(() => undefined);
        const timer = new Promise<"timeout">((resolve) => { const t = setTimeout(() => resolve("timeout"), 15_000); t.unref?.(); });
        const exit = await Promise.race([proc.exited, timer]);
        if (exit === "timeout") { proc.kill("SIGKILL"); return { ok: false, error: { code: "engine.timeout", message: `${adapter.bin} did not answer.` } }; }
        await Promise.race([reading, new Promise<void>((r) => setTimeout(r, graceMs).unref?.())]);
        if (exit.code === 0) return { ok: true, models: adapter.models.length };
        const text = (proc.stderrTail() || out).trim().slice(0, 200);
        return { ok: false, error: { code: classifyCli(text), message: text !== "" ? text : `${adapter.bin} exited with ${exit.code ?? exit.signal ?? "an error"}.` } };
      } catch (e) {
        const code = e instanceof LaunchError ? e.code : "engine.cli_failed";
        return { ok: false, error: { code, message: e instanceof Error ? e.message : `${adapter.bin} could not start.` } };
      }
    },
    async open(spec) {
      const endpoint = await deps.mcp(spec);
      const session = createCliSession({
        adapter, launcher: deps.launcher, endpoint,
        model: spec.agent.model ? spec.agent.model.replace(PREFIX, "") : null,
        resume: deps.resume?.(spec) ?? null,
        system: deps.system?.(spec) ?? null,
        workFolder: deps.workFolder?.(spec) ?? null,
        env: deps.env?.(spec) ?? {},
        ...(deps.planMode ? { planMode: () => deps.planMode?.(spec) ?? false } : {}),
        ...(deps.prompt ? { prompt: deps.prompt } : {}),
        ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
        ...(deps.graceMs !== undefined ? { graceMs: deps.graceMs } : {}),
        onClose: async () => { await deps.mcpClose?.(spec, endpoint); },
      }, spec);
      if (deps.prewarm !== false) {
        try { await session.prewarm(); }
        catch (e) {
          await session.close();
          if (e instanceof LaunchError) throw new DriverError(e.code, e.message);
          throw e;
        }
      }
      return session;
    },
  };
}

/** The three CLI drivers, one each. */
export function createCliDrivers(deps: CliDriverDeps): CliDriver[] {
  return (["claude_code", "codex", "grok"] as const).map((id) => createCliDriver(CLI_ADAPTERS[id], deps));
}
