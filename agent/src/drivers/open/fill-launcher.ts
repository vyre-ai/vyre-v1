// A Launcher that puts an account's key into the engine process's environment through the Vault fill (vault-use). The handle is all the driver, the engine and the logs ever hold;
// the value exists in this call, in the child's environment, and in the scrubber that removes it from what the child writes. It is never in an argv, a file, an event or an error message.
import { createScrubber, runWithVault, WITHHELD } from "../../vault-use/index.ts";
import type { Scrubber, Secret, Used, ValueSource, VaultRunDeps, Where } from "../../vault-use/index.ts";
import { LaunchError } from "../cli/launcher.ts";
import { lines } from "../cli/lines.ts";
import type { CliProcess, LaunchSpec, Launcher } from "../cli/types.ts";

export interface FillWho { agentId: string; asker: string; where: Where; traceId: string }

export interface FillLauncherDeps {
  inner: Launcher;
  source: ValueSource;
  reportMiss: VaultRunDeps["reportMiss"];
  who: FillWho;
  /** Environment variable name to the Vault handle whose value goes there. */
  env: Readonly<Record<string, string>>;
  /** Items the fill used (ids and handles only): for the audit and the usage record. */
  onUsed?(used: readonly Used[]): void;
}

/** What a refusal from the Vault is called to the engine: the Vault's own permission codes pass through, the rest is the account being unusable. */
export function fillErrorCode(code: string): string {
  return code === "permission.no_grant" || code === "permission.provider_label" ? code : "engine.account_unavailable";
}

/**
 * The engine's output line by line, each line scrubbed on its own. The protocol is one JSON object per line, so a value never spans two lines; scrubbing per line adds no delay, where
 * the Vault's stream scrubber holds back the tail of a stream until more arrives (right for a command's output, wrong for an engine that stays up between turns).
 */
async function* scrubbedLines(source: AsyncIterable<Uint8Array | string>, scrubber: Scrubber, onMiss: (hit: readonly Secret[]) => void): AsyncGenerator<string> {
  for await (const line of lines(source)) {
    const clean = scrubber.scrub(line);
    const hit = scrubber.residual(clean);
    if (hit.length > 0) { onMiss(hit); yield `${WITHHELD}\n`; continue; }
    yield `${clean}\n`;
  }
}

export function createFillLauncher(d: FillLauncherDeps): Launcher {
  return {
    async spawn(spec: LaunchSpec): Promise<CliProcess> {
      // Set from inside the executor; held in an object so the code after the await sees them as they are.
      const got: { proc?: CliProcess; filled: Record<string, string>; failure?: unknown } = { filled: {} };
      const run = await runWithVault(
        { source: d.source, reportMiss: d.reportMiss },
        { tool: "engine_launch", args: { env: d.env }, traceId: d.who.traceId, agentId: d.who.agentId, asker: d.who.asker, where: d.who.where },
        async (args) => {
          got.filled = (args as { env: Record<string, string> }).env;
          // The Vault leaves a handle it does not know as text; a process must not start with that in place of a key.
          if (Object.entries(d.env).some(([name, handle]) => got.filled[name] === handle)) {
            got.failure = new LaunchError("engine.account_unavailable", "The account's key is not in the Vault.");
            throw got.failure;
          }
          let p: CliProcess;
          try { p = await d.inner.spawn({ ...spec, env: { ...spec.env, ...got.filled } }); }
          catch (e) { got.failure = e; throw e; }
          got.proc = p;
          // Nothing the vault scrubber would see: the engine's output is scrubbed below, line by line.
          return "";
        },
      );
      // A start that failed for its own reasons (the program is not installed) keeps its own code.
      if (got.failure instanceof LaunchError) throw got.failure;
      if (!run.ok) throw new LaunchError(fillErrorCode(run.error.code), run.error.message);
      const started = got.proc;
      const named = Object.values(d.env);
      if (started === undefined || run.used.length !== new Set(named).size) {
        // A handle the Vault did not know was left as text; the process must not run with that in its place.
        started?.kill("SIGKILL");
        throw new LaunchError("engine.account_unavailable", "The account's key is not in the Vault.");
      }
      d.onUsed?.(run.used);
      const secrets: Secret[] = Object.entries(d.env).map(([name, handle]) => ({ handle, itemId: run.used.find((u) => u.handle === handle)?.itemId ?? handle, value: got.filled[name] ?? "" }));
      const scrubber = createScrubber(secrets);
      return {
        pid: started.pid,
        stdout: scrubbedLines(started.stdout, scrubber, (hit) => { for (const h of hit) void Promise.resolve(d.reportMiss({ itemId: h.itemId, place: "terminal", traceId: d.who.traceId })).catch(() => undefined); }),
        write: (data) => started.write(data),
        endInput: () => started.endInput(),
        exited: started.exited,
        // The last bytes of stderr can start in the middle of a value; a fragment that survives the scrub withholds the whole tail.
        stderrTail: () => {
          const text = scrubber.scrub(started.stderrTail());
          return scrubber.residual(text).length > 0 ? WITHHELD : text;
        },
        kill: (signal) => started.kill(signal),
      };
    },
  };
}
