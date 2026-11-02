// terminal module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: the tmux adapter every host shares. An agent computer, the Space server and a person's computer each run `tmux` their own way (agentd, a local process, the device daemon), so
// `createTmuxHost` takes that as a port (`Exec`) and the module itself never spawns anything. Sessions are tmux sessions: no native pty dependency, they survive their tab, and the screen
// is read back with capture-pane. Live frames come from a tmux control-mode client (`%output` lines, decoded here).
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { bindHost, bindKit, bindMachineHost, bindMachinePlace, bindPlace, bindTeam, bindValues, boundHost, redeemTicket, scrubberFor, spellingsFor } from "./projections.ts";
import type { Db, PlaceOf, Target, TermState, TerminalHost } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;
export { fetchesOutside, isDangerCall, outwardOf } from "./handlers/index.ts";

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
    // Scrub first, hold back after: a value that is whole in what has arrived is removed whole. Holding the tail before scrubbing cut the value's last character off whenever it could itself start another
    // spelling of the value (an s, a 7 for the hex form, a c for the base64 form) and the frame ended exactly on the value, which left the rest of the value in the stream.
    const text = sc.scrub(carry + frame);
    const hold = partialSpellingAt(text, spellingsFor(who.terminalId));
    const out = text.slice(0, text.length - hold);
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

// ---- a computer without tmux -------------------------------------------------------------------------------------------------------------------------------

/** Run one command line in a shell on this machine. `onData` gets what it prints (both streams) as it prints it; aborting `signal` stops it (Ctrl-C). */
export type ShellRun = (a: { command: string; cwd: string; env: Readonly<Record<string, string>>; onData(text: string): void; signal: AbortSignal }) => Promise<{ exitCode: number | null }>;

export interface ShellOptions {
  run: ShellRun;
  /** The folder a session starts in when none is named. */
  home: string;
  now?: () => number;
  /** Output kept from a command, from the end. Default 100,000 characters. */
  maxOutput?: number;
  /** Lines a session keeps for its screen. Default 5000. */
  scrollback?: number;
}

interface ShellSession { cwd: string; lines: string[]; partial: string; typed: string; running: AbortController | null; exitCode: number | null; listeners: Set<(text: string) => void> }

/**
 * A session on a computer that has no tmux (a Mac does not ship it): each command runs in its own shell in the session's folder, and the session keeps a screen of what ran and what it printed, so
 * "Open terminal" shows the agent's commands and a person can type a line and press Enter. It is not a full terminal: a program that needs a keyboard of its own (an editor, a pager) cannot run here.
 */
export function createShellHost(o: ShellOptions): TerminalHost {
  const now = o.now ?? Date.now;
  const maxOutput = o.maxOutput ?? 100_000;
  const scrollback = o.scrollback ?? 5000;
  const sessions = new Map<string, ShellSession>();
  const must = (id: string): ShellSession => {
    const s = sessions.get(id);
    if (!s) throw new Error("there is no such session on this computer");
    return s;
  };
  const screen = (s: ShellSession): string[] => (s.partial === "" ? s.lines : [...s.lines, s.partial]);
  /** Put text on the session's screen and send it to whoever watches, with the line ends a terminal expects. */
  const show = (s: ShellSession, text: string): void => {
    if (text === "") return;
    const parts = (s.partial + text.replace(/\r\n/g, "\n")).split("\n");
    s.partial = parts.pop() ?? "";
    s.lines.push(...parts);
    if (s.lines.length > scrollback) s.lines.splice(0, s.lines.length - scrollback);
    const frame = text.replace(/\r?\n/g, "\r\n");
    for (const f of s.listeners) f(frame);
  };
  const tidy = (text: string): string => text.replace(/\s+$/u, "");

  /** `typed`: the person typed the line, so it is on the screen already. */
  async function exec(s: ShellSession, r: { command: string; cwd?: string; env: Readonly<Record<string, string>>; timeoutMs: number }, typed = false): Promise<{ exitCode: number | null; output: string; truncated: boolean; durationMs: number }> {
    if (s.running) throw new Error("a command is still running in this session");
    for (const k of Object.keys(r.env)) if (!ENV_NAME.test(k)) throw new Error(`${k} is not a name an environment variable can have`);
    if (!typed) {
      if (s.partial !== "") show(s, "\n");
      show(s, `$ ${r.command}\n`);
    }
    const ac = new AbortController();
    s.running = ac;
    let out = "";
    let timedOut = false;
    const t0 = now();
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, r.timeoutMs);
    let res: { exitCode: number | null };
    try { res = await o.run({ command: r.command, cwd: r.cwd ?? s.cwd, env: r.env, signal: ac.signal, onData: (t) => { out += t; if (out.length > maxOutput * 2) out = out.slice(out.length - maxOutput); show(s, t); } }); }
    finally { clearTimeout(timer); s.running = null; }
    if (s.partial !== "") show(s, "\n");
    s.exitCode = res.exitCode;
    if (timedOut) throw Object.assign(new Error("the command did not finish in time"), { code: "timeout" });
    let output = tidy(out);
    let truncated = false;
    if (output.length > maxOutput) { output = output.slice(output.length - maxOutput); truncated = true; }
    return { exitCode: res.exitCode, output, truncated, durationMs: now() - t0 };
  }

  return {
    async open(a) {
      const cwd = a.cwd ?? o.home;
      sessions.set(a.terminalId, { cwd, lines: [], partial: "", typed: "", running: null, exitCode: null, listeners: new Set() });
      return { cwd };
    },
    // A person typing: the line is kept until Enter, then run like a command of their own. Backspace takes back a character; Ctrl-C stops what runs.
    async input(terminalId, data) {
      const s = must(terminalId);
      for (const ch of data) {
        if (ch === "\x03") { s.running?.abort(); s.typed = ""; show(s, "^C\n"); continue; }
        if (ch === "\r" || ch === "\n") {
          const line = s.typed;
          s.typed = "";
          show(s, "\n");
          if (line.trim() !== "" && !s.running) void exec(s, { command: line, env: {}, timeoutMs: 3_600_000 }, true).catch((e: unknown) => show(s, `${e instanceof Error ? e.message : "the command failed"}\n`));
          continue;
        }
        if (ch === "\x7f" || ch === "\b") { if (s.typed !== "") { s.typed = s.typed.slice(0, -1); s.partial = s.partial.slice(0, -1); for (const f of s.listeners) f("\b \b"); } continue; }
        if (s.typed === "" && s.partial === "") show(s, "$ ");
        s.typed += ch;
        show(s, ch);
      }
    },
    async interrupt(terminalId) { const s = must(terminalId); s.running?.abort(); show(s, "^C\n"); },
    async resize(terminalId) { must(terminalId); },
    async read(terminalId, r) {
      const all = screen(must(terminalId));
      const text = r.since === undefined ? all.slice(-r.lines) : all.slice(r.since);
      return { text: text.join("\n"), next: all.length };
    },
    run: async (terminalId, r) => exec(must(terminalId), r),
    async status(ids) {
      return ids.map((terminalId) => {
        const s = sessions.get(terminalId);
        if (!s) return { terminalId, state: "exited" as const, exitCode: null };
        const last = screen(s).filter((l) => l.trim() !== "").pop();
        return { terminalId, state: s.running ? ("running" as const) : ("idle" as const), ...(last === undefined ? {} : { lastLine: last.slice(0, 300) }), exitCode: s.exitCode };
      });
    },
    stream(terminalId, onFrame) {
      const s = sessions.get(terminalId);
      if (!s) return () => undefined;
      s.listeners.add(onFrame);
      return () => { s.listeners.delete(onFrame); };
    },
    async close(terminalId) {
      const s = sessions.get(terminalId);
      if (!s) return;
      s.running?.abort();
      s.listeners.clear();
      sessions.delete(terminalId);
    },
    async health() { return { ok: true, detail: "Commands run in a shell on this computer. Install tmux for full terminals.", sessions: sessions.size }; },
  };
}

// ---- this machine ---------------------------------------------------------------------------------------------------------------------------------------------

/** What the daemon hands over (setTerminalHost): this machine's way of running tmux and a plain shell, which sessions live here, and where a person's turn runs. */
export interface TerminalHostSeam {
  exec: Exec;
  control?: TmuxOptions["control"];
  shell: ShellRun;
  /** The folder a session starts in when none is named: the person's home folder on this computer. */
  home: string;
  /** A session for this target lives on this machine. Anything else is another machine, which this one cannot reach. */
  runsHere(target: Target): boolean;
  place?: PlaceOf;
}

/** The sessions of this machine: tmux when it is installed, else a plain shell. A target on another machine is refused at open. */
export function createLocalHost(o: Omit<TerminalHostSeam, "place">): TerminalHost {
  const tmux = createTmuxHost({ exec: o.exec, ...(o.control ? { control: o.control } : {}) });
  const plain = createShellHost({ run: o.shell, home: o.home });
  let tmuxKnown: boolean | null = null;
  let probe: Promise<boolean> | null = null;
  const hasTmux = (): Promise<boolean> => (probe ??= o.exec(["tmux", "-V"]).then((r) => r.code === 0, () => false).then((v) => { tmuxKnown = v; return v; }));
  const owner = new Map<string, TerminalHost>();
  /** Sessions opened before a restart are tmux ones when tmux is here: they outlive the daemon. */
  const of = async (id: string): Promise<TerminalHost> => owner.get(id) ?? ((await hasTmux()) ? tmux : plain);
  return {
    async open(a) {
      if (!o.runsHere(a.target)) throw new Error("that computer is not this one, and this one cannot reach it");
      const h = (await hasTmux()) ? tmux : plain;
      const r = await h.open(a);
      owner.set(a.terminalId, h);
      return r;
    },
    input: async (id, data) => (await of(id)).input(id, data),
    interrupt: async (id) => (await of(id)).interrupt(id),
    resize: async (id, cols, rows) => (await of(id)).resize(id, cols, rows),
    read: async (id, r) => (await of(id)).read(id, r),
    run: async (id, r) => (await of(id)).run(id, r),
    async status(ids) {
      const out: Awaited<ReturnType<TerminalHost["status"]>> = [];
      for (const id of ids) out.push(...(await (await of(id)).status([id])));
      return out;
    },
    stream(id, onFrame) {
      const h = owner.get(id) ?? (tmuxKnown === true ? tmux : plain);
      return h.stream ? h.stream(id, onFrame) : () => undefined;
    },
    async close(id) { await (await of(id)).close(id); owner.delete(id); },
    health: async () => ((await hasTmux()) ? tmux.health() : plain.health()),
  };
}

/** The daemon's half: this machine's sessions and where turns run. Null on shutdown. */
export function setTerminalHost(seam: TerminalHostSeam | null): void {
  bindMachineHost(seam === null ? null : createLocalHost(seam));
  bindMachinePlace(seam?.place ?? null);
}

// Only the setter the daemon wires is a host seam.
export const hostSeams = { setTerminalHost };

export { bindHost, bindKit, bindPlace, bindTeam, bindValues };
export { commandsOf, judge, redeemTicket, rulesOf } from "./projections.ts";
