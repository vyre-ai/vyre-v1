// An account pays for a turn only if its engine can run on the computer the turn runs on. When the account's program is missing and Vyre can install it here (engine-install.ts), the pick stays and the
// turn waits for the install, its live line saying "Setting up Codex". Only when that cannot happen (no build for this computer, or the last try failed a short while ago, offline or not the pinned file)
// does another usable account of the person answer (the one connected most recently), said in the chat in one line. When nothing can run, the pick stays and the start fails with engine.cli_missing,
// which the chat draws as an Install card (status.ts) whose button tries again. A turn pinned to a server is checked on that server (node-cli.ts), never here.
import { LaunchError } from "../../agent/src/drivers/cli/launcher.ts";
import { SandboxError } from "../../sandbox/src/types.ts";
import type { AccountQuery, OpenSession, ResolvedAccount } from "../../agent/src/turn-engine/types.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { PostAs, StreamEvent } from "./handlers/bridge.ts";
import { CLI_NAME, CLI_PROGRAM, findProgram } from "./cli-programs.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { EngineInstallError } from "./engine-install.ts";
import type { EngineInstaller } from "./engine-install.ts";
import { mintId } from "./projections.ts";

/** What the account check needs of the installer. */
export type EngineSetup = Pick<EngineInstaller, "supported" | "failedRecently" | "ensure"> & Partial<Pick<EngineInstaller, "state">>;

/** How often a waiting turn's live line says how far the download has got: often enough that a screen never takes the turn for a dead one (it lets a silent turn go after 90 s). */
export const SETUP_BEAT_MS = 10_000;

/** The live step of a turn waiting for its engine: the activity line reads it as "Setting up <name>" (apps/app/src/places/chats/conversation/activity.ts). */
export const ENGINE_SETUP_STEP = "engine_setup";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

export interface RunnableDeps {
  call: Call;
  /** One answer of engine.account.resolve (with `unavailable`). */
  resolve(q: AccountQuery): Promise<ResolvedAccount | null>;
  /** A CLI engine swapped for a command (a test's fake CLI) is there by definition. */
  command?: Readonly<Record<string, readonly string[]>>;
  probe?: NodeCliProbe;
  postAs?: PostAs;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
  /** Vyre's installer on this computer. Absent: a missing program is never installed, and another account answers as before. */
  engines?: EngineSetup;
  /** Why this computer cannot sandbox a CLI engine (sandbox-default.ts cliSandboxGap), or null. A CLI account is then passed over like a missing program, and its start refuses with sandbox.unavailable. */
  unsandboxed?: () => string | null;
}

/** Will a turn that needs this program wait for Vyre to install it? Yes when there is a build for this computer and the last try did not just fail. */
export const willInstall = (program: string, d: Pick<RunnableDeps, "engines">): boolean => d.engines !== undefined && d.engines.supported(program) && !d.engines.failedRecently(program);

/** The program a CLI account needs that this computer does not have, or null (an API account, or the program is here). */
export function missingProgram(driver: string, d: Pick<RunnableDeps, "command" | "probe">): string | null {
  const program = CLI_PROGRAM[driver];
  if (program === undefined || d.command?.[program] !== undefined) return null;
  return findProgram(program, d.probe) === null ? program : null;
}

const WORDS = (program: string, to: string, tried: boolean): string => `${CLI_NAME[program] ?? program} ${tried ? "could not be set up" : "is not installed"} here, so ${to} answered.`;
const UNSAFE_WORDS = (program: string, to: string): string => `${CLI_NAME[program] ?? program} cannot run safely on this computer yet, so ${to} answered.`;

/** Why a CLI account cannot run here: no sandbox for CLI engines on this computer, or its program is missing. Null for an API account or one that can run. */
export function cannotRun(driver: string, d: Pick<RunnableDeps, "command" | "probe" | "unsandboxed">): "sandbox" | "missing" | null {
  if (CLI_PROGRAM[driver] === undefined) return null;
  if ((d.unsandboxed?.() ?? null) !== null) return "sandbox";
  return missingProgram(driver, d) !== null ? "missing" : null;
}

export function createRunnableAccount(d: RunnableDeps): (q: AccountQuery) => Promise<ResolvedAccount | null> {
  const said = new Set<string>();

  async function pinnedToServer(q: AccountQuery): Promise<boolean> {
    try {
      const p = (await d.call("engine.placement.decide", { threadId: q.threadId, agentId: q.agentId, kind: "message" }, q.askerId)) as { reason?: string; placement?: string };
      // a turn on one of the person's servers or computers is checked there (node-cli.ts), never against this server's programs
      return p.reason === "chosen_server" || p.reason === "server_off" || p.reason === "own_server" || p.placement === "device";
    } catch { return false; }
  }

  async function say(q: AccountQuery, text: string, key: string): Promise<void> {
    if (!d.postAs || said.has(key)) return;
    said.add(key);
    try {
      await d.postAs(q.agentId, { actingFor: q.askerId, threadId: q.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintId("b").slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text } }] });
    } catch (e) { d.log?.("the account change could not be shown in the chat", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
  }

  return async (q) => {
    const first = await d.resolve(q);
    if (!first) return first;
    const why = cannotRun(first.driver, d);
    if (why === null || await pinnedToServer(q)) return first;
    const lacking = CLI_PROGRAM[first.driver] as string;
    if (why === "missing" && willInstall(lacking, d)) {
      // the download starts now, while the turn is being set up; the opener waits for this same install (checkedOpen)
      d.engines?.ensure(lacking).catch(() => undefined);
      return first;
    }

    // The other accounts that could pay, in the order the policy would try them; those whose program is missing are skipped too.
    const skipped = [first.ref];
    const options: ResolvedAccount[] = [];
    for (let i = 0; i < 8; i++) {
      const next = await d.resolve({ ...q, unavailable: [...(q.unavailable ?? []), ...skipped, ...options.map((o) => o.ref)] });
      if (!next) break;
      if (cannotRun(next.driver, d) === null) options.push(next); else skipped.push(next.ref);
    }
    if (options.length === 0) {
      d.log?.("no account of this person can run on this computer", { threadId: q.threadId, program: lacking, why });
      return first;   // the start fails with sandbox.unavailable or engine.cli_missing, precisely
    }
    let pick = options[0] as ResolvedAccount;
    if (options.length > 1) {
      // The list is in the order the accounts were connected, oldest first: the last one is the newest.
      const order = await d.call("engine.accounts.list", {}, first.payer).then((r) => (r as { accounts: Array<{ ref: string }> }).accounts.map((a) => a.ref), () => [] as string[]);
      pick = options.reduce((best, o) => (order.indexOf(o.ref) > order.indexOf(best.ref) ? o : best), pick);
    }
    const to = CLI_NAME[CLI_PROGRAM[pick.driver] ?? ""] ?? pick.provider.charAt(0).toUpperCase() + pick.provider.slice(1);
    await say(q, why === "sandbox" ? UNSAFE_WORDS(lacking, to) : WORDS(lacking, to, d.engines?.failedRecently(lacking) === true), `${q.threadId}|${q.agentId}|${first.ref}|${pick.ref}`);
    return pick;
  };
}

/**
 * The opener with the program check in front: a turn whose account needs an engine this computer does not have waits while Vyre installs it, with a live step the activity line reads as "Setting up Codex",
 * and then opens as usual. Where it cannot be installed, or the install fails, the turn fails with engine.cli_missing before the Vault is asked for the account's key and before any sandbox starts; the
 * message names the program and, in brackets, why (offline, checksum, unsupported, disk, failed), which the chat turns into a sentence. A turn pinned to a server never gets here (node-turns.ts routes it first).
 */
export function checkedOpen(open: OpenSession, d: Pick<RunnableDeps, "command" | "probe" | "engines" | "unsandboxed"> & { live?: (e: StreamEvent) => void; beatMs?: number }): OpenSession {
  return async (spec) => {
    // a computer that cannot sandbox a CLI engine refuses before anything is downloaded, filled or started
    if (spec.account && cannotRun(spec.account.driver, d) === "sandbox") throw new SandboxError("sandbox.unavailable", d.unsandboxed?.() ?? "CLI engines cannot be sandboxed on this computer");
    const lacking = spec.account ? missingProgram(spec.account.driver, d) : null;
    if (lacking === null) return open(spec);
    const setup = d.engines;
    if (!setup || !setup.supported(lacking)) throw new LaunchError("engine.cli_missing", `${lacking} is not installed on this computer${setup ? " (unsupported)" : ""}.`);
    const name = CLI_NAME[lacking] ?? lacking;
    const step = { threadId: spec.threadId, turnId: spec.turnId, agentId: spec.agent.id, id: `setup_${lacking}` };
    const live = (e: StreamEvent): void => { try { d.live?.(e); } catch { /* the live line is a courtesy; the install goes on */ } };
    // how far it has got, in the step's detail: "Setting up Codex, 40%"
    const said = (): string => { const s = setup.state?.(lacking); return s?.phase === "installing" && s.total && s.done ? `${name}, ${Math.min(99, Math.floor(((s.done ?? 0) / s.total) * 100))}%` : name; };
    live({ kind: "step", phase: "call", ...step, name: ENGINE_SETUP_STEP });
    live({ kind: "step", phase: "input", ...step, detail: said() });
    const beat = setInterval(() => live({ kind: "step", phase: "input", ...step, detail: said() }), d.beatMs ?? SETUP_BEAT_MS);
    beat.unref?.();
    try { await setup.ensure(lacking); }
    catch (e) {
      live({ kind: "step", phase: "result", ...step, ok: false });
      const reason = e instanceof EngineInstallError ? e.reason : "failed";
      throw new LaunchError("engine.cli_missing", `${lacking} is not installed on this computer (${reason}).`);
    } finally { clearInterval(beat); }
    live({ kind: "step", phase: "result", ...step, ok: true });
    return open(spec);
  };
}
