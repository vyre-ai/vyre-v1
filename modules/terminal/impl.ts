// terminal module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: the tmux adapter every host shares. An agent computer, the Space server and a person's computer each run `tmux` their own way (agentd, a local process, the device daemon), so
// `createTmuxHost` takes that as a port (`Exec`) and the module itself never spawns anything. Sessions are tmux sessions: no native pty dependency, they survive their tab, and the screen
// is read back with capture-pane. Live frames come from a tmux control-mode client (`%output` lines, decoded here).
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { bindHost, bindTeam, bindValues, boundHost, redeemTicket, scrubberFor, spellingsFor } from "./projections.ts";
import type { Db, TermState, TerminalHost } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

// ---- tmux ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface ExecResult { code: number; stdout: string; stderr: string }
/** Run `argv` (argv[0] is "tmux") on the machine the session lives on, without a shell. */
export type Exec = (argv: readonly string[]) => Promise<ExecResult>;

export interface TmuxOptions {
  exec: Exec;
  /** A control-mode client for live frames: runs `tmux -C attach -t <session>` and calls `onLine` for every line it prints. Returns the function that stops it. */
  control?: (session: string, onLine: (line: string) => void) => () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How often a running command's screen is read. Default 50 ms. */
  pollMs?: number;
  /** Output kept from a command, from the end. Default 100,000 characters. */
  maxOutput?: number;
  /** Lines of scrollback read when looking for a command's end. Default 5000. */
  scrollback?: number;
  /** tmux session names are `<prefix><terminalId>`. Default "vyre-". */
  prefix?: string;
}

const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish", "ksh", "ash", "tmux"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rnd = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Quote for a POSIX shell: one pair of single quotes, with every embedded single quote closed, escaped and reopened. */
export const shQuote = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

/** tmux control mode escapes a byte it will not print as a three digit octal number after a backslash, and the backslash itself the same way. */
export function decodeControlOutput(data: string): string {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const chars = Array.from(data);   // by code point, so a character outside the basic plane is encoded whole
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    const oct = chars.slice(i + 1, i + 4).join("");
    if (c === "\\" && /^[0-7]{3}$/.test(oct)) { bytes.push(parseInt(oct, 8)); i += 3; }
    else bytes.push(...enc.encode(c));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `%output %<pane> <data>` is a frame; every other control line (%begin, %end, %session-changed ...) is not. */
export function frameOf(line: string): string | null {
  const m = /^%output %\d+ (.*)$/s.exec(line);
  return m && m[1] !== undefined ? decodeControlOutput(m[1]) : null;
}

export function createTmuxHost(o: TmuxOptions): TerminalHost {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? realSleep;
  const pollMs = o.pollMs ?? 50;
  const maxOutput = o.maxOutput ?? 100_000;
  const scrollback = o.scrollback ?? 5000;
  const prefix = o.prefix ?? "vyre-";
  const nameOf = (terminalId: string): string => `${prefix}${terminalId}`;

  async function tmux(args: readonly string[]): Promise<string> {
    const r = await o.exec(["tmux", ...args]);
    if (r.code !== 0) throw new Error(`tmux ${args[0] ?? ""} failed: ${r.stderr.trim().slice(0, 200)}`);
    return r.stdout;
  }
  const tidy = (text: string): string => text.replace(/\s+$/u, "");
  async function capture(session: string, lines: number): Promise<string> {
    return tidy(await tmux(["capture-pane", "-p", "-J", "-t", session, "-S", `-${Math.max(1, lines)}`]));
  }

  const host: TerminalHost = {
    async open(a) {
      const session = nameOf(a.terminalId);
      await tmux(["new-session", "-d", "-s", session, "-x", String(a.cols), "-y", String(a.rows), ...(a.cwd === undefined ? [] : ["-c", a.cwd])]);
      const cwd = tidy(await tmux(["display-message", "-p", "-t", session, "#{pane_current_path}"])) || a.cwd || "~";
      return { cwd };
    },
    async input(terminalId, data) {
      const session = nameOf(terminalId);
      for (let i = 0; i < data.length; i += 1000) await tmux(["send-keys", "-t", session, "-l", "--", data.slice(i, i + 1000)]);
    },
    async interrupt(terminalId) { await tmux(["send-keys", "-t", nameOf(terminalId), "C-c"]); },
    async resize(terminalId, cols, rows) { await tmux(["resize-window", "-t", nameOf(terminalId), "-x", String(cols), "-y", String(rows)]); },
    async read(terminalId, r) {
      const all = (await capture(nameOf(terminalId), r.since === undefined ? r.lines : scrollback)).split("\n");
      const text = r.since === undefined ? all.slice(-r.lines) : all.slice(r.since);
      return { text: text.join("\n"), next: all.length };
    },
    async run(terminalId, r) {
      const session = nameOf(terminalId);
      const nonce = rnd(6);
      const beg = `__VYRE_BEG_${nonce}__`;
      const end = `__VYRE_END_${nonce}__`;
      for (const k of Object.keys(r.env)) if (!ENV_NAME.test(k)) throw new Error(`${k} is not a name an environment variable can have`);
      const exports = Object.entries(r.env).map(([k, v]) => `${k}=${shQuote(v)}`);
      // With variables the command runs in a subshell so they do not stay in the session; without, in braces so `cd` and exports persist like typing it.
      const body = exports.length > 0 ? `( export ${exports.join(" ")}; ${r.command}\n)` : `{ ${r.command}\n}`;
      const cd = r.cwd === undefined ? "" : `cd ${shQuote(r.cwd)} && `;
      // Begin and end markers are printed by the shell, so the typed line (which holds them only inside quotes) never matches a marker line.
      const line = `printf '%s\\n' ${shQuote(beg)}; ${cd}${body}; printf '\\n%s:%d\\n' ${shQuote(end)} $?`;
      const t0 = now();
      await tmux(["send-keys", "-t", session, "-l", "--", line]);
      await tmux(["send-keys", "-t", session, "Enter"]);
      const endRe = new RegExp(`^${end}:(\\d+)$`, "m");
      for (;;) {
        const screen = await capture(session, scrollback);
        const m = endRe.exec(screen);
        if (m && m.index !== undefined) {
          const before = screen.slice(0, m.index);
          const lines = before.split("\n");
          let from = -1;
          for (let i = lines.length - 1; i >= 0; i--) if (lines[i] === beg) { from = i; break; }
          let output = tidy(lines.slice(from + 1).join("\n"));
          const scrolledOff = from < 0;
          let truncated = scrolledOff;
          if (output.length > maxOutput) { output = output.slice(output.length - maxOutput); truncated = true; }
          return { exitCode: Number(m[1]), output, truncated, durationMs: now() - t0 };
        }
        if (now() - t0 >= r.timeoutMs) {
          await tmux(["send-keys", "-t", session, "C-c"]).catch(() => undefined);
          throw Object.assign(new Error("the command did not finish in time"), { code: "timeout" });
        }
        await sleep(pollMs);
      }
    },
    async status(ids) {
      const out: Array<{ terminalId: string; state: TermState; lastLine?: string; exitCode: number | null }> = [];
      for (const terminalId of ids) {
        const session = nameOf(terminalId);
        const has = await o.exec(["tmux", "has-session", "-t", session]);
        if (has.code !== 0) { out.push({ terminalId, state: "exited", exitCode: null }); continue; }
        const cmd = tidy(await tmux(["display-message", "-p", "-t", session, "#{pane_current_command}"]));
        const last = (await capture(session, 5)).split("\n").filter((l) => l.trim() !== "").pop();
        out.push({ terminalId, state: SHELLS.has(cmd) ? "idle" : "running", ...(last === undefined ? {} : { lastLine: last.slice(0, 300) }), exitCode: null });
      }
      return out;
    },
    async close(terminalId) {
      const r = await o.exec(["tmux", "kill-session", "-t", nameOf(terminalId)]);
      // A session that is already gone is closed.
      if (r.code !== 0 && !/can't find session|no server running|no such session/i.test(r.stderr)) throw new Error(`tmux kill-session failed: ${r.stderr.trim().slice(0, 200)}`);
    },
    async health() {
      const v = await o.exec(["tmux", "-V"]);
      if (v.code !== 0) return { ok: false, detail: "tmux is not installed on this host", sessions: 0 };
      const l = await o.exec(["tmux", "list-sessions", "-F", "#{session_name}"]);
      const sessions = l.code === 0 ? l.stdout.split("\n").filter((n) => n.startsWith(prefix)).length : 0;
      return { ok: true, detail: v.stdout.trim(), sessions };
    },
  };
  if (o.control) {
    const control = o.control;
    host.stream = (terminalId, onFrame) => control(nameOf(terminalId), (line) => { const f = frameOf(line); if (f !== null) onFrame(f); });
  }
  return host;
}

// ---- the live relay ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The host's live connection spends an attach ticket and gets the session's frames. Frames pass through the session's scrubber, so a Vault value filled into a command never reaches the tab.
 * Output goes out as it arrives; only a tail that is the start of a secret's spelling is held back until the next frame shows whether it was one (and dropped if the tab closes first).
 * Null when the ticket is unknown, spent or expired, or this host runs no terminals.
 */
export async function openFrames(db: Db, ticket: string, now: number, send: (text: string) => void): Promise<{ terminalId: string; personId: string; close(): void } | null> {
  const host = boundHost();
  if (!host?.stream) return null;
  const who = await redeemTicket(db, ticket, now);
  if (!who) return null;
  let carry = "";
  let closed = false;
  const stop = host.stream(who.terminalId, (frame) => {
    if (closed) return;
    const sc = scrubberFor(who.terminalId);
    if (!sc) { send(carry + frame); carry = ""; return; }
    const text = carry + frame;
    const hold = partialSpellingAt(text, spellingsFor(who.terminalId));
    const out = sc.scrub(text.slice(0, text.length - hold));
    carry = text.slice(text.length - hold);
    if (out !== "") send(out);
  });
  return { ...who, close() { closed = true; carry = ""; stop(); } };
}

/** Length of the longest tail of `text` that is a proper prefix of one of the spellings. */
export function partialSpellingAt(text: string, spellings: readonly string[]): number {
  const longest = spellings.reduce((n, x) => Math.max(n, x.length), 0);
  for (let len = Math.min(longest - 1, text.length); len >= 1; len--) {
    const tail = text.slice(text.length - len);
    if (spellings.some((x) => x.length > len && x.startsWith(tail))) return len;
  }
  return 0;
}

export { bindHost, bindTeam, bindValues };
export { commandsOf, judge, redeemTicket, rulesOf } from "./projections.ts";
