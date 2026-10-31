// An account pays for a turn only if its engine can run on the computer the turn runs on. A Codex sign-in on a computer with no `codex` would pick, spawn, and fail with a bare error; this skips it
// for another usable account of the person (the one connected most recently), says so in the chat in one line, and leaves the pick alone when it can run. When nothing can run, the pick stays and the
// start fails with engine.cli_missing, which the chat draws as an Install card (status.ts). A turn pinned to a server is checked on that server (node-cli.ts), never here.
import { LaunchError } from "../../agent/src/drivers/cli/launcher.ts";
import type { AccountQuery, OpenSession, ResolvedAccount } from "../../agent/src/turn-engine/types.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { CLI_NAME, CLI_PROGRAM, findProgram } from "./cli-programs.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { mintId } from "./projections.ts";

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
}

/** The program a CLI account needs that this computer does not have, or null (an API account, or the program is here). */
export function missingProgram(driver: string, d: Pick<RunnableDeps, "command" | "probe">): string | null {
  const program = CLI_PROGRAM[driver];
  if (program === undefined || d.command?.[program] !== undefined) return null;
  return findProgram(program, d.probe) === null ? program : null;
}

const WORDS = (program: string, to: string): string => `${CLI_NAME[program] ?? program} is not installed here, so ${to} answered.`;

export function createRunnableAccount(d: RunnableDeps): (q: AccountQuery) => Promise<ResolvedAccount | null> {
  const said = new Set<string>();

  async function pinnedToServer(q: AccountQuery): Promise<boolean> {
    try {
      const p = (await d.call("engine.placement.decide", { threadId: q.threadId, agentId: q.agentId, kind: "message" }, q.askerId)) as { reason?: string };
      return p.reason === "chosen_server" || p.reason === "server_off";
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
    const lacking = missingProgram(first.driver, d);
    if (lacking === null || await pinnedToServer(q)) return first;

    // The other accounts that could pay, in the order the policy would try them; those whose program is missing are skipped too.
    const skipped = [first.ref];
    const options: ResolvedAccount[] = [];
    for (let i = 0; i < 8; i++) {
      const next = await d.resolve({ ...q, unavailable: [...(q.unavailable ?? []), ...skipped, ...options.map((o) => o.ref)] });
      if (!next) break;
      if (missingProgram(next.driver, d) === null) options.push(next); else skipped.push(next.ref);
    }
    if (options.length === 0) {
      d.log?.("no account of this person can run on this computer", { threadId: q.threadId, program: lacking });
      return first;   // the start fails with engine.cli_missing, precisely
    }
    let pick = options[0] as ResolvedAccount;
    if (options.length > 1) {
      // The list is in the order the accounts were connected, oldest first: the last one is the newest.
      const order = await d.call("engine.accounts.list", {}, first.payer).then((r) => (r as { accounts: Array<{ ref: string }> }).accounts.map((a) => a.ref), () => [] as string[]);
      pick = options.reduce((best, o) => (order.indexOf(o.ref) > order.indexOf(best.ref) ? o : best), pick);
    }
    const to = CLI_NAME[CLI_PROGRAM[pick.driver] ?? ""] ?? pick.provider.charAt(0).toUpperCase() + pick.provider.slice(1);
    await say(q, WORDS(lacking, to), `${q.threadId}|${q.agentId}|${first.ref}|${pick.ref}`);
    return pick;
  };
}

/**
 * The opener with the program check in front: a turn whose account needs an engine this computer does not have fails at once with engine.cli_missing, before the Vault is asked for the account's key
 * and before any sandbox starts. A turn pinned to a server never gets here (node-turns.ts routes it first).
 */
export function checkedOpen(open: OpenSession, d: Pick<RunnableDeps, "command" | "probe">): OpenSession {
  return (spec) => {
    const lacking = spec.account ? missingProgram(spec.account.driver, d) : null;
    if (lacking !== null) return Promise.reject(new LaunchError("engine.cli_missing", `${lacking} is not installed on this computer.`));
    return open(spec);
  };
}
