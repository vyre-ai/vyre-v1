import { eraseCmdLogsOfAgent, eraseCmdLogsOfPerson, expireCmdLogs } from "./cmdlog.ts";
import { tryAll, tryRun } from "../../lib/erase-agent.ts";
import { ensure as ensureTerminalTables, forgetAgentSecrets } from "./projections.ts";
type Row = Record<string, unknown>;
// terminal module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: the tmux adapter every host shares. An agent computer, the Space server and a person's computer each run `tmux` their own way (agentd, a local process, the device daemon), so
// `createTmuxHost` takes that as a port (`Exec`) and the module itself never spawns anything. Sessions are tmux sessions: no native pty dependency, they survive their tab, and the screen
// is read back with capture-pane. Live frames come from a tmux control-mode client (`%output` lines, decoded here).
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import {
  forgetExpiredWorkspaces,
  onAgentGone,
  onHolderGone,
  onAgentRestored,
  onPersonBack,
  onPersonLeft,
  reconcileAccess,
  forgetExpiredPeople,
  openTabForRun,
  stopRuns,
} from "./handlers/sessions.ts";
import type { AccessDeps } from "./handlers/sessions.ts";
import { chatFolderCommand, chatLinkCommand, grantCommand, removeCommand } from "./asker.ts";
import {
  bindWorkspaceStatus,
  bindChatFolder,
  bindNotes,
  bindPlaceGrant,
  bindHost,
  bindKit,
  bindMachineHost,
  bindMachinePlace,
  bindMachineValues,
  bindPlace,
  bindTeam,
  bindValues,
  bindWorkspaces,
  boundHost,
  hideRunLine,
  redeemTicket,
  scopeOfId,
  scrubberFor,
  spellingsFor,
} from "./projections.ts";
import { unixSocketHttp } from "../../sandbox/src/docker.ts";
import { buildWorkspaceManager, createWorkspaceTerminalHost } from "./workspace.ts";
import type { WorkspaceManager, WorkspaceOptions, WorkspaceTerminalHost } from "./workspace.ts";
import { createWorkspaceFleet, remoteDockerHttp } from "./fleet.ts";
import type { WorkspaceFleet } from "./fleet.ts";
import type { AdoptArgs, Db, PlaceOf, Target, TermCtx, TermState, TerminalHost, ValueSource } from "./projections.ts";
import { networkRoom, networkRoomFinding, siteRoom } from "./netroom.ts";
import { DEFAULT_SOFT_CAP_MB, volumeFinding } from "./volumes.ts";
import type { RoomFinding } from "./netroom.ts";

/**
 * The folders and file a Files event names: every folder it touches, so a mirror on either side is brought forward (a file or folder moved between two agents' folders: both; sixth look W2,
 * folder.moved names the parents as fromParentId and toParentId).
 */
export function filesChangeOf(p: Record<string, unknown>): { folderIds: string[]; fileId?: string; by?: string } {
  const folderIds = ["folderId", "fromFolderId", "toFolderId", "parentId", "fromParentId", "toParentId"]
    .map((k) => p[k])
    .filter((v): v is string => typeof v === "string");
  return {
    folderIds: [...new Set(folderIds)],
    ...(typeof p["fileId"] === "string" ? { fileId: p["fileId"] } : {}),
    ...(typeof p["by"] === "string" ? { by: p["by"] } : {}),
  };
}

import { STOPPED_LINE } from "./stop-line.ts";
import { createRunLineFilter } from "./stream-log.ts";
export { STOPPED_LINE };

/** The reasons a turn's end record carries when work was stopped on purpose: these interrupt the turn's terminal command (closing, lease and anything else never do). */
const STOP_REASONS = new Set(["stop", "interrupt", "limit", "left", "moved"]);

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;
export { fetchesOutside, isDangerCall, outwardOf } from "./handlers/index.ts";
export { mayEnterWorkspace } from "./handlers/sessions.ts";

// ---- tmux ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Run `argv` (argv[0] is "tmux") on the machine the session lives on, without a shell. `stdin`: what the program reads on its standard input (the values of a command, for `tmux load-buffer -`). */
export type Exec = (argv: readonly string[], o?: { stdin?: string }) => Promise<ExecResult>;

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
  /** Run a command through one script inside the machine (type, wait, read, clear) instead of a round trip per look: a host whose exec is a container exec asks for it. Default off. */
  oneExec?: boolean;
  /** The command a new session runs instead of the default shell (a workspace: a bash with a private umask). */
  shell?: readonly string[];
  /** tmux session names are `<prefix><terminalId>`. Default "vyre-". */
  prefix?: string;
  /** How a tab's live read (read with `since`) runs tmux: an exec that neither wakes the machine nor counts as use (a workspace). Default `exec`. */
  quietExec?: Exec;
  /** How the shell in a session names tmux, to fetch a command's values from it. Default "tmux" (found on the shell's own PATH). */
  tmuxPath?: string;
  /**
   * This daemon's mark in the names of its values buffers. Two daemons can share one tmux server (the desktop app runs a Personal Space daemon and a device daemon on one computer, both on the
   * person's default tmux server): each sweeps only buffers with its own mark. It must stay the same across restarts (the daemon derives it from its data folder). Default "0".
   */
  mark?: string;
}

/**
 * Where a session's screen is, in lines counted from the first line it ever printed: tmux's history size and cursor row, and how many lines tmux dropped. Once the history is full tmux drops a tenth
 * of its limit at a time, so between two reads it may have dropped some whole number of tenths; the last finished lines seen (the anchor) say which number it was: the one that puts them back where
 * they were. With no anchor to go by (a full-screen program redrew everything) the fewest drops that explain the history size are taken, which can only show a line twice, never skip one.
 */
interface Marks {
  h: number;
  dropped: number;
  anchor?: { at: number; lines: string[] };
}
const POS = "#{history_size} #{cursor_y} #{history_limit}";
const CAP = "__VYRE_CAP__:";
/** The names tmux send-keys takes for a key a person presses: a few words, Ctrl or Alt with one character, and F1 to F12. Anything else is not a key. */
const KEY_NAME =
  /^(Enter|Tab|BTab|BSpace|Escape|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|DC|IC|F([1-9]|1[0-2])|[CM]-[A-Za-z0-9]|C-M-[A-Za-z0-9])$/;

const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish", "ksh", "ash", "tmux"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** What a session's shell starts with so that a line typed with a leading space (every agent command) is kept out of its history, in memory and on disk. */
export const HISTORY_ENV: readonly string[] = ["-e", "HISTCONTROL=ignorespace"];
/** The name every values buffer starts with (a random 32 hex characters follow). */
export const ENV_BUFFER = "vyre-env-";
/** What a command answers when its tab was busy with something else for all of its time: what runs there, and the two ways on. */
export const busyLine = (what: string): string =>
  `That tab is still running something${what !== "" ? ` (${what})` : ""}, so this command was not typed into it. Run it in another tab (name a session), or interrupt what runs there first.`;
const BUSY =
  "This tab is still running something, so no Vault value is handed to it. Wait for it to finish, or run the command in another tab.";
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rnd = (n: number): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * An argument tmux takes as it is. tmux reads an argument that ends in ";" as the end of a command and drops that character (or, after a backslash, the backslash): a lone ";" key, or a chunk of typing
 * that ends in one, never reached the shell (12 Nov). A backslash before the final ";" makes tmux keep the text as given (tmux 3.4, checked on the box).
 */
export const tmuxLiteral = (t: string): string => (t.endsWith(";") ? `${t.slice(0, -1)}\\;` : t);

/** Quote for a POSIX shell: one pair of single quotes, with every embedded single quote closed, escaped and reopened. */
export const shQuote = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

/** tmux control mode escapes a byte it will not print as a three digit octal number after a backslash, and the backslash itself the same way. */
export function decodeControlOutput(data: string): string {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const chars = Array.from(data); // by code point, so a character outside the basic plane is encoded whole
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    const oct = chars.slice(i + 1, i + 4).join("");
    if (c === "\\" && /^[0-7]{3}$/.test(oct)) {
      bytes.push(parseInt(oct, 8));
      i += 3;
    } else bytes.push(...enc.encode(c));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `%output %<pane> <data>` is a frame; every other control line (%begin, %end, %session-changed ...) is not. */
export function frameOf(line: string): string | null {
  const m = /^%output %\d+ (.*)$/s.exec(line);
  return m && m[1] !== undefined ? decodeControlOutput(m[1]) : null;
}

/**
 * Is the tab's shell waiting for a line: does the shell itself own the terminal (review 12 Nov, 3a)? The foreground process group of the pane's terminal must be the pane's shell: `ps -o tpgid=` of
 * #{pane_pid} equals that pid. A program, a shell script, `sh -c`, a loop running a command or a script blocked on `read` each hold the terminal in a process group of their own, so they say no; a
 * background job with the prompt back says yes. The name of the foreground program is not enough: a shell script is "bash" too. `target` is a tmux target (a session name). Anything that cannot be
 * told is a no. (Lane f-term calls this before every run.)
 */
export async function shellAtPrompt(exec: Exec, target: string): Promise<boolean> {
  const r = await exec([
    "tmux",
    "display-message",
    "-p",
    "-t",
    target,
    "#{pane_pid} #{pane_dead} #{pane_in_mode} #{cursor_y} #{pane_current_command}",
  ]).catch(() => null);
  if (!r || r.code !== 0) return false;
  const [pid, dead, mode, cursor, cmd] = r.stdout.trim().split(/\s+/);
  if (pid === undefined || !/^\d+$/.test(pid) || dead === "1" || mode === "1") return false;
  // the foreground program must be a shell as well: `exec python` keeps the shell's pid and process group (third look, F2)
  if (cmd === undefined || !SHELLS.has(cmd) || cmd === "tmux") return false;
  // the process group and the cursor's line depend only on what the first look said: asked together, one round trip instead of two (every check still has to pass)
  const cursorOk = cursor !== undefined && /^\d+$/.test(cursor);
  const [p, line] = await Promise.all([
    exec(["ps", "-o", "tpgid=", "-p", pid]).catch(() => null),
    cursorOk
      ? exec(["tmux", "capture-pane", "-p", "-t", target, "-S", cursor, "-E", cursor]).catch(() => null)
      : Promise.resolve(undefined),
  ]);
  if (p === null || p.code !== 0 || p.stdout.trim() !== pid) return false;
  // a construct a person left open (an open bracket or quote, a here-document) has the shell on its continuation prompt: the line the cursor is on starts with PS2, by default "> ".
  // A prompt of one's own that starts with "> " reads as one too, which is the safe side. A `read` a person typed shows no prompt and cannot be seen from here.
  if (cursorOk) {
    // tmux trims a line's trailing spaces, so an empty continuation line reads as ">"
    if (line === undefined || line === null || line.code !== 0 || /^>( |\n|$)/.test(line.stdout)) return false;
  }
  return true;
}

/** The tmux host, with the sweep of leftover values buffers for a caller that makes a session itself (a workspace that lost its tmux) or starts using a server. */
export type TmuxHost = TerminalHost & { sweep(): Promise<void> };

/** The most a command's retained output holds: the answer is cut to `maxOutput`, the kept copy to this (the log's per-command cap is the same). */
const FULL_MAX = 5 * 1024 * 1024;
/**
 * The script of a run, run as `sh -c SCRIPT sh session line end rcOption scrollbackLines deadlineMs cancelOption` in the machine the session lives on. It types the line, then looks at the pane (the screen and the
 * stored exit code and the cancel option, in ONE tmux call) until the end marker shows, the exit code is stored, the cancel option is set (the turn was stopped) or the deadline passes; then it prints one header
 * line, the screen, and, when the command ended, the whole history of the pane, and clears both options. The header carries the byte length of each part, so what the command printed can never be taken for
 * the script's own marks. Exit 90 means the line was not typed, 91 that it was typed and Enter failed (typed again, never). The cancel is a tmux option of the session, not a file: only what can reach the
 * session's tmux server can set it. The looks come fast at first (most commands end at once) and back off to 0.2 s, so a long build costs about 15 forks a second, not about 250.
 */
export const RUN_SCRIPT = `# vyre-run
s=$1; line=$2; end=$3; rc=$4; scroll=$5; deadline=$6; cx=$7
tmux send-keys -t "$s" -l -- "$line" || exit 90
tmux send-keys -t "$s" Enter || exit 91
printf '__VYRE_SENT__\n' >&2
nl='
'
t0=$(date +%s); st=wait; n=0; cap=; rcv=
while :; do
  n=$((n + 1))
  out=$(tmux capture-pane -p -J -t "$s" -S "-$scroll" \\; display-message -p -t "$s" "__VYRE_X__#{$rc}|#{$cx}")
  meta=\${out##*__VYRE_X__}; cap=\${out%__VYRE_X__*}
  rcv=\${meta%%|*}; cxv=\${meta#*|}
  # the end mark counts only as a whole line of its own: a command that prints the mark text in the middle of a line, or with more after the digits, does not end the run
  rest=\${nl}\${cap}; rest=\${rest#*"\${nl}$end:"}
  if [ "$rest" != "\${nl}\${cap}" ]; then
    num=\${rest%%"$nl"*}
    case $num in ''|*[!0-9]*) ;; *) st=done; break;; esac
  fi
  case $rcv in ''|*[!0-9]*) ;; *) st=done; break;; esac
  if [ -n "$cxv" ]; then st=cancel; break; fi
  if [ $n -gt 25 ]; then
    now=$(date +%s)
    if [ $(( (now - t0) * 1000 )) -ge "$deadline" ]; then st=timeout; break; fi
    if [ $n -gt 45 ]; then sleep 0.2; else sleep 0.05; fi
  else sleep 0.02; fi
done
full=
if [ "$st" = done ]; then full=$(tmux capture-pane -p -J -t "$s" -S -); fi
sl=$(printf '%s' "$cap" | wc -c); fl=$(printf '%s' "$full" | wc -c)
printf '__VYRE_HDR__:%s:%s:%s:%s\n' "$((sl + 0))" "$((fl + 0))" "$rcv" "$st"
printf '%s%s' "$cap" "$full"
tmux set-option -u -q -t "$s" "$rc" 2>/dev/null
tmux set-option -u -q -t "$s" "$cx" 2>/dev/null
exit 0
`;
/** What the script printed, taken apart by the lengths in its header: the screen, the stored exit code, how it ended, and the whole history when it ended well. Null when it is not the script's output or the parts do not add up. */
export function parseRunScript(out: string): { screen: string; rc: string; status: string; full?: string } | null {
  const m = /^__VYRE_HDR__:(\d+):(\d+):([^:\n]*):(\w+)\n/.exec(out);
  if (!m) return null;
  const buf = Buffer.from(out.slice(m[0].length), "utf8");
  const sl = Number(m[1]);
  const fl = Number(m[2]);
  if (buf.length !== sl + fl) return null;
  const screen = buf.subarray(0, sl).toString("utf8");
  const full = m[4] === "done" ? buf.subarray(sl).toString("utf8") : undefined;
  return { screen, rc: (m[3] ?? "").trim(), status: m[4] ?? "", ...(full === undefined ? {} : { full }) };
}

export function createTmuxHost(o: TmuxOptions): TmuxHost {
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
  /** Is the pty's echo off (a program reading a password)? Asked of the terminal itself; a host that cannot say is taken to echo. */
  async function echoOff(tty: string): Promise<boolean> {
    if (!/^\/dev\/[\w/.-]+$/.test(tty)) return false;
    const r = await o.exec(["stty", "-a", "-F", tty]).catch(() => null);
    // a line editor (bash at its prompt) turns echo off too, and draws the line itself; it also leaves line mode. A password prompt keeps line mode: echo off and icanon on
    return (
      r !== null &&
      r.code === 0 &&
      /(^|[\s;])-echo([\s;]|$)/.test(r.stdout) &&
      /(^|[\s;])icanon([\s;]|$)/.test(r.stdout)
    );
  }
  /** A session's shell keeps no line that starts with a space in its history (agent commands are typed that way). A tmux older than 3.0 has no -e: the session opens without it. */
  async function newSession(
    session: string,
    cols: number,
    rows: number,
    cwd: string | undefined,
    env: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    const rest = [
      "-d",
      "-s",
      session,
      "-x",
      String(cols),
      "-y",
      String(rows),
      ...(cwd === undefined ? [] : ["-c", cwd]),
    ];
    // a person who uses a shared agent without owning it: their shell's home, history and config folders (asker.ts)
    const own = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const r = await o.exec(["tmux", "new-session", ...HISTORY_ENV, ...own, ...rest, ...(o.shell ?? [])]);
    if (r.code === 0) return;
    if (/unknown option|invalid option|usage:/i.test(r.stderr)) {
      await tmux(["new-session", ...rest]);
      return;
    }
    throw new Error(`tmux new-session failed: ${r.stderr.trim().slice(0, 200)}`);
  }
  async function capture(session: string, lines: number): Promise<string> {
    return tidy(await tmux(["capture-pane", "-p", "-J", "-t", session, "-S", `-${Math.max(1, lines)}`]));
  }
  const marks = new Map<string, Marks>();
  type Pos = { h: number; cy: number; ny: number };
  const posOf = (line: string): Pos | null => {
    const [h, cy, lim] = line.trim().split(" ").map(Number);
    if (h === undefined || cy === undefined || !Number.isFinite(h) || !Number.isFinite(cy)) return null;
    return { h, cy, ny: Math.max(1, Math.floor((lim !== undefined && Number.isFinite(lim) ? lim : 2000) / 10)) };
  };
  async function position(run: Exec, session: string): Promise<Pos> {
    const r = await run(["tmux", "display-message", "-p", "-t", session, POS]);
    const p = r.code === 0 ? posOf(r.stdout) : null;
    if (!p) throw new Error(`tmux did not say where the screen is: ${r.stderr.trim().slice(0, 200)}`);
    return p;
  }
  /** The last `back` lines of history and the whole screen, with the position, in one tmux call (output between two calls would shift one against the other). */
  async function grab(run: Exec, session: string, back: number): Promise<{ parts: string[]; p: Pos; shown: number }> {
    const r = await run([
      "tmux",
      "capture-pane",
      "-p",
      "-t",
      session,
      "-S",
      `-${back}`,
      ";",
      "display-message",
      "-p",
      "-t",
      session,
      POS,
    ]);
    if (r.code !== 0) throw new Error(`tmux capture-pane failed: ${r.stderr.trim().slice(0, 200)}`);
    const parts = r.stdout
      .replace(/\n$/, "")
      .split("\n")
      .map((l) => l.replace(/\s+$/u, ""));
    const p = posOf(parts.pop() ?? "");
    if (!p) throw new Error("tmux did not say where the screen is");
    return { parts, p, shown: Math.min(back, p.h) };
  }
  /** The session's lines from `since` (counted from its first line, or the cursor's line when not given) through the cursor's line, and the cursor's line. Moves the session's marks on. */
  async function locate(
    run: Exec,
    session: string,
    since: number | undefined,
  ): Promise<{ lines: string[]; cursor: number }> {
    const mk = marks.get(session);
    const pre = await position(run, session);
    const kmin = (h: number, ny: number): number => (mk ? Math.max(0, Math.ceil((mk.h - h) / ny)) : 0);
    const estTop = (mk?.dropped ?? 0) + kmin(pre.h, pre.ny) * pre.ny + pre.h;
    const want = since === undefined ? 0 : Math.max(0, estTop - since);
    const fits = (g: Awaited<ReturnType<typeof grab>>, k: number): boolean => {
      if (!mk?.anchor) return true;
      const first = mk.dropped + k * g.p.ny + g.p.h - g.shown;
      const at = mk.anchor.at - first;
      return at >= 0 && mk.anchor.lines.every((l, i) => g.parts[at + i] === l);
    };
    let g = await grab(run, session, Math.min(scrollback * 4, want + 100));
    let k: number | null = fits(g, kmin(g.p.h, g.p.ny)) ? kmin(g.p.h, g.p.ny) : null;
    if (k === null && mk) {
      // tmux may have dropped whole tenths of its history while the history size looked no smaller: look further back for the anchor
      g = await grab(run, session, Math.min(g.p.h, Math.min(scrollback * 4, want + 100) + 10 * g.p.ny));
      const k0 = kmin(g.p.h, g.p.ny);
      for (let x = k0; x <= k0 + 10 && k === null; x++) if (fits(g, x)) k = x;
      k ??= k0;
    }
    const dropped = (mk?.dropped ?? 0) + (k ?? 0) * g.p.ny;
    const first = dropped + g.p.h - g.shown;
    const cursor = dropped + g.p.h + g.p.cy;
    const from = since === undefined ? cursor : Math.max(first, Math.min(since, cursor));
    const lines = g.parts.slice(from - first, cursor - first + 1);
    const anchorFrom = Math.max(first, cursor - 3);
    marks.set(session, {
      h: g.p.h,
      dropped,
      ...(cursor > anchorFrom
        ? { anchor: { at: anchorFrom, lines: g.parts.slice(anchorFrom - first, cursor - first) } }
        : {}),
    });
    return { lines, cursor };
  }
  /**
   * The lines from `since` through the cursor's line, and the cursor's line as `next`: the line being typed on is sent again on every read until it is finished, so a prompt or a line that changes
   * between two reads is never lost.
   */
  async function readSince(run: Exec, session: string, since: number): Promise<{ text: string; next: number }> {
    const r = await locate(run, session, since);
    // the cursor went up (a full-screen program, tput): nothing new for an append-only view, and the place read up to stays, so the lines are not sent again when the program ends
    if (r.cursor < since) return { text: "", next: since };
    return { text: r.lines.join("\n"), next: r.cursor };
  }

  /** Sessions a run of this host is in now, and the values buffers of those runs. */
  const running = new Set<string>();
  const mine = new Set<string>();
  const own = `${ENV_BUFFER}${(o.mark ?? "0").replace(/[^A-Za-z0-9]/g, "")}-`;
  /**
   * Every values buffer of this daemon on this tmux server that no run of this host is using: one a run left when the daemon died between load and delete (review 12 Nov, 3b). After a restart the
   * scrubber has forgotten that run's values, so nothing it left may stay readable: this runs when a session is opened or made again, and at the start of every run, with values or not.
   */
  async function sweepBuffers(): Promise<void> {
    const l = await o.exec(["tmux", "list-buffers", "-F", "#{buffer_name}"]).catch(() => null);
    if (!l || l.code !== 0) return;
    for (const name of l.stdout.split("\n").map((x) => x.trim()))
      if (name.startsWith(own) && !mine.has(name))
        await o.exec(["tmux", "delete-buffer", "-b", name]).catch(() => undefined);
  }

  /** Type one line, press Enter and read the screen until the end marker shows: the output between the markers and the exit code. */
  /**
   * Type one line, press Enter and wait for its end. The end is known by two things: the end marker on the screen (fast, and what the output is cut at), and the exit code the line stores in a tmux
   * option of the session (rcOption), which no program can overwrite. A command that moved the cursor up, cleared the screen or drew a progress bar can write over the marker's row; the option still says
   * it ended, so the run never waits out its time for nothing (12 Nov).
   */
  /**
   * The turn that started a command was stopped (release gate, 12 Nov): Ctrl-C to its pane; if the shell is not back at its prompt within 3 s, Ctrl-C again and the pane's foreground process
   * group is killed; then the run answers at once, exit 130, with what the command printed and one line saying it was stopped. The next command finds a shell at its prompt.
   */
  async function stopIn(session: string): Promise<void> {
    await tmux(["send-keys", "-t", session, "C-c"]).catch(() => undefined);
    const back = async (ms: number): Promise<boolean> => {
      const t1 = now();
      while (now() - t1 < ms) {
        if (await shellAtPrompt(o.exec, session).catch(() => false)) return true;
        await sleep(Math.max(pollMs, 100));
      }
      return false;
    };
    if (await back(3000)) return;
    await tmux(["send-keys", "-t", session, "C-c"]).catch(() => undefined);
    const pid = tidy(await tmux(["display-message", "-p", "-t", session, "#{pane_pid}"]).catch(() => ""));
    if (/^\d+$/.test(pid))
      await o
        .exec([
          "sh",
          "-c",
          `g=$(ps -o tpgid= -p ${pid} | tr -d ' '); [ -n "$g" ] && [ "$g" != "${pid}" ] && [ "$g" -gt 1 ] && kill -KILL -"$g"`,
        ])
        .catch(() => undefined);
    await back(2000);
  }

  async function runLine(
    session: string,
    line: string,
    beg: string,
    end: string,
    timeoutMs: number,
    rcOption: string,
    signal?: AbortSignal,
  ): Promise<{ exitCode: number | null; output: string; truncated: boolean; durationMs: number; full?: string }> {
    const t0 = now();
    const endRe = new RegExp(`^${end}:(\\d+)$`, "m");
    const RC = "__VYRE_RC__:";
    /** The output of the command from its begin marker, cut to `limit` characters from the end. */
    const body = (lines: string[], limit: number): { output: string; truncated: boolean } => {
      let from = -1;
      for (let i = lines.length - 1; i >= 0; i--)
        if (lines[i] === beg) {
          from = i;
          break;
        }
      let output = tidy(
        lines
          .slice(from + 1)
          .filter((l) => !l.includes(end))
          .join("\n"),
      );
      let truncated = from < 0;
      if (output.length > limit) {
        output = output.slice(output.length - limit);
        truncated = true;
      }
      return { output, truncated };
    };
    /** `fullScreen`: the whole history of the pane (a run through the script reads it once at the end), from which the retained output is cut: far more than the answer holds. */
    const cut = (lines: string[], code: number, fullLines?: string[]) => {
      const { output, truncated } = body(lines, maxOutput);
      // the history is kept only from this command's own begin marker: when it is not in the history (scrolled out), nothing of it is kept and the log keeps the answer, never another command's lines
      const full = fullLines === undefined || !fullLines.includes(beg) ? undefined : body(fullLines, FULL_MAX).output;
      return { exitCode: code, output, truncated, durationMs: now() - t0, ...(full === undefined ? {} : { full }) };
    };
    let polls = 0;
    const forget = (): Promise<unknown> =>
      o.exec(["tmux", "set-option", "-u", "-q", "-t", session, rcOption]).catch(() => undefined);

    // One exec for the whole run on a host that asks for it (a workspace): type the line, wait for the end marker or the stored exit code inside the container, read the screen and the history once, clear the
    // exit-code option, and answer. The wait costs no round trips, so a quick command is one exec instead of about seven. Anything unexpected falls back to the polling loop below: a script that could not
    // type the line (exit 90) lets the loop type it, one that typed it and then failed lets the loop go on watching without typing again.
    let sent = false;
    if (o.oneExec === true) {
      // the stop is a tmux option of the session: nothing on the disk, and the name is worth nothing to anyone who cannot reach the session's tmux server
      const cancel = `@vyre_cancel_${end.replace(/\W/g, "")}`;
      const onAbort = (): void =>
        void o.exec(["tmux", "set-option", "-q", "-t", session, cancel, "1"]).catch(() => undefined);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      let r: ExecResult | null = null;
      try {
        r = await o.exec([
          "sh",
          "-c",
          RUN_SCRIPT,
          "sh",
          session,
          line,
          end,
          rcOption,
          String(Math.max(1, scrollback)),
          String(Math.max(1000, timeoutMs)),
          cancel,
        ]);
      } catch {
        // the exec was cut: the line may be typed, and typing it again could run it twice. It is read, never typed again.
        sent = true;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        // a stop that came after the script ended leaves its option behind: it is taken off (only then, so a run that ends by itself stays one exec)
        if (signal?.aborted)
          await o.exec(["tmux", "set-option", "-u", "-q", "-t", session, cancel]).catch(() => undefined);
      }
      if (r !== null) {
        const parsed = parseRunScript(r.stdout);
        // The line is typed again ONLY when the script itself said it typed nothing: exit 90 (or 127, no sh) with nothing printed. Every other answer (a kill, a cut, a silent exit, an
        // exit 91 where Enter failed) means it may have been typed: the loop below reads the screen and never types the line (after 91 it presses Enter only).
        sent = !((r.code === 90 || r.code === 127) && r.stdout === "");
        if (r.code === 91) await tmux(["send-keys", "-t", session, "Enter"]).catch(() => undefined);
        if (parsed !== null) {
          const screen = tidy(parsed.screen);
          // the history ends at the end marker, like the screen: what follows (the next prompt, the empty rows of the screen) is not the command's
          const fullTidy = parsed.full === undefined ? undefined : tidy(parsed.full);
          const fm = fullTidy === undefined ? null : endRe.exec(fullTidy);
          const fullLines =
            fullTidy === undefined
              ? undefined
              : (fm && fm.index !== undefined ? fullTidy.slice(0, fm.index) : fullTidy).split("\n");
          const m = endRe.exec(screen);
          if (m && m.index !== undefined) return cut(screen.slice(0, m.index).split("\n"), Number(m[1]), fullLines);
          if (/^\d+$/.test(parsed.rc)) return cut(screen.split("\n"), Number(parsed.rc), fullLines);
          if (parsed.status === "cancel") {
            await stopIn(session);
            await forget();
            const c = cut(screen.split("\n"), 130);
            return { ...c, output: `${c.output}\n${STOPPED_LINE}`.trim() };
          }
          if (parsed.status === "timeout") {
            await tmux(["send-keys", "-t", session, "C-c"]).catch(() => undefined);
            throw Object.assign(new Error("the command did not finish in time"), { code: "timeout" });
          }
        }
      }
    }
    if (!sent) {
      await tmux(["send-keys", "-t", session, "-l", "--", line]);
      await tmux(["send-keys", "-t", session, "Enter"]);
    }
    for (;;) {
      // the screen and the stored exit code in one tmux call
      const both = tidy(
        await tmux([
          "capture-pane",
          "-p",
          "-J",
          "-t",
          session,
          "-S",
          `-${Math.max(1, scrollback)}`,
          ";",
          "display-message",
          "-p",
          "-t",
          session,
          `${RC}#{${rcOption}}`,
        ]),
      );
      const at = both.lastIndexOf(RC);
      const rc = at >= 0 ? both.slice(at + RC.length).trim() : "";
      const screen = tidy(at >= 0 ? both.slice(0, at) : both);
      const m = endRe.exec(screen);
      if (m && m.index !== undefined) {
        await forget();
        return cut(screen.slice(0, m.index).split("\n"), Number(m[1]));
      }
      if (/^\d+$/.test(rc)) {
        await forget();
        return cut(screen.split("\n"), Number(rc));
      }
      if (signal?.aborted) {
        await stopIn(session);
        await forget();
        const r = cut(screen.split("\n"), 130);
        return { ...r, output: `${r.output}\n${STOPPED_LINE}`.trim() };
      }
      if (now() - t0 >= timeoutMs) {
        await tmux(["send-keys", "-t", session, "C-c"]).catch(() => undefined);
        throw Object.assign(new Error("the command did not finish in time"), { code: "timeout" });
      }
      // the first looks come quickly (most commands end at once), then at the poll interval
      polls += 1;
      await sleep(polls <= 2 ? Math.min(10, pollMs) : pollMs);
    }
  }

  const host: TmuxHost = {
    sweep: sweepBuffers,
    async open(a) {
      const session = nameOf(a.terminalId);
      await newSession(session, a.cols, a.rows, a.cwd ?? a.place?.home, a.place?.env);
      await sweepBuffers();
      const cwd = tidy(await tmux(["display-message", "-p", "-t", session, "#{pane_current_path}"])) || a.cwd || "~";
      return { cwd };
    },
    async input(terminalId, data) {
      const session = nameOf(terminalId);
      for (let i = 0; i < data.length; i += 1000)
        await tmux(["send-keys", "-t", session, "-l", "--", tmuxLiteral(data.slice(i, i + 1000))]);
    },
    async interrupt(terminalId) {
      await tmux(["send-keys", "-t", nameOf(terminalId), "C-c"]);
    },
    async capture(terminalId, r) {
      const session = nameOf(terminalId);
      // the screen with its colours and the facts about it in one tmux call, so a line of output between two calls cannot shift one against the other
      const both = await o.exec([
        "tmux",
        "capture-pane",
        "-e",
        "-p",
        "-t",
        session,
        "-S",
        `-${Math.max(1, Math.min(r.lines, 5000))}`,
        ";",
        "display-message",
        "-p",
        "-t",
        session,
        `${CAP}#{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{history_size} #{pane_tty} #{cursor_flag}`,
      ]);
      if (both.code !== 0) throw new Error(`tmux capture-pane failed: ${both.stderr.trim().slice(0, 200)}`);
      const at = both.stdout.lastIndexOf(CAP);
      const text = (at >= 0 ? both.stdout.slice(0, at) : both.stdout).replace(/\n$/, "");
      const f = (at >= 0 ? both.stdout.slice(at + CAP.length) : "").trim().split(" ");
      const num = (i: number): number => (Number.isFinite(Number(f[i])) ? Number(f[i]) : 0);
      return {
        text,
        cols: num(0) || 80,
        rows: num(1) || 24,
        cursor: f[6] === "0" ? null : { x: num(2), y: num(3) },
        history: num(4),
        hidden: await echoOff(f[5] ?? ""),
      };
    },
    async keys(terminalId, ks) {
      const session = nameOf(terminalId);
      // a pane left in tmux's copy mode reads keys by tmux's own bindings (q, /, Enter...): leave it first, so what a person types reaches the shell
      const mode = await o.exec(["tmux", "display-message", "-p", "-t", session, "#{pane_in_mode}"]).catch(() => null);
      if (mode !== null && mode.code === 0 && mode.stdout.trim() === "1")
        await tmux(["send-keys", "-t", session, "-X", "cancel"]).catch(() => undefined);
      for (const k of ks) {
        if ("text" in k) {
          for (let i = 0; i < k.text.length; i += 1000)
            await tmux(["send-keys", "-t", session, "-l", "--", tmuxLiteral(k.text.slice(i, i + 1000))]);
        } else if ("key" in k) {
          if (!KEY_NAME.test(k.key))
            throw Object.assign(new Error("That key is not one a terminal takes."), { code: "bad_input" });
          await tmux(["send-keys", "-t", session, k.key]);
        } else {
          // a paste is one write, whatever its size: into a tmux buffer through stdin, then into the pane, and the buffer is dropped
          const name = `vyre-paste-${globalThis.crypto.randomUUID()}`;
          const r = await o.exec(["tmux", "load-buffer", "-b", name, "-"], { stdin: k.paste });
          if (r.code !== 0) throw new Error(`tmux load-buffer failed: ${r.stderr.trim().slice(0, 200)}`);
          await tmux(["paste-buffer", "-b", name, "-d", "-t", session]);
        }
      }
    },
    async resize(terminalId, cols, rows) {
      await tmux(["resize-window", "-t", nameOf(terminalId), "-x", String(cols), "-y", String(rows)]);
    },
    async read(terminalId, r) {
      const session = nameOf(terminalId);
      if (r.since !== undefined) return readSince(o.quietExec ?? o.exec, session, r.since);
      const all = (await capture(session, r.lines)).split("\n");
      // the replay, and where a live read goes on from: the cursor's line, which the next read sends again
      return { text: all.slice(-r.lines).join("\n"), next: (await locate(o.exec, session, undefined)).cursor };
    },
    async run(terminalId, r) {
      const session = nameOf(terminalId);
      const nonce = rnd(6);
      const beg = `__VYRE_BEG_${nonce}__`;
      const end = `__VYRE_END_${nonce}__`;
      for (const k of Object.keys(r.env))
        if (!ENV_NAME.test(k)) throw new Error(`${k} is not a name an environment variable can have`);
      // Values are never typed (W6): they go into a tmux buffer through the standard input of `tmux load-buffer`, in the tmux server's memory only, never on disk and never in a program's arguments.
      // The typed line reads the buffer inside a subshell, deletes it before the command starts and exports the values there, so they are the environment of this one command and gone after it.
      // Without variables the command runs in braces so `cd` and exports persist like typing it.
      const withValues = Object.keys(r.env).length > 0;
      // Every run waits for the tab's shell to own its terminal (shellAtPrompt) before anything is typed (review 12 Nov, 3): after a restart this process knows nothing of what runs there, and a
      // person's own program (npm run dev) in the tab would take the line as its input. It waits within the command's own time, then answers what runs there and what to do instead.
      const t0 = now();
      while (!(await shellAtPrompt(o.exec, session))) {
        // stopped before it was typed: nothing is typed
        if (r.signal?.aborted) throw Object.assign(new Error(STOPPED_LINE), { code: "stopped" });
        if (now() - t0 >= r.timeoutMs) {
          const what =
            (
              await o
                .exec(["tmux", "display-message", "-p", "-t", session, "#{pane_current_command}"])
                .catch(() => null)
            )?.stdout.trim() ?? "";
          throw Object.assign(new Error(busyLine(what)), { code: "busy" });
        }
        await sleep(Math.max(pollMs, 250));
      }
      // A run of this host that was stopped is still finishing (its script notices the stop within a moment, then its answer is made): the next command is typed only after it, so the stopped command's
      // answer is recorded before the next one starts and the two can never swap. Bounded, so a run that does not end cannot hold the next one.
      // This orders a run behind the stopped one; it is not a queue: two runs waiting at once both type when the earlier one clears.
      const inFlight = now();
      while (running.has(session) && now() - inFlight < 3000) await sleep(Math.max(10, Math.min(pollMs, 50)));
      const leftMs = Math.max(1000, r.timeoutMs - (now() - t0));
      // what a run of an earlier daemon left behind is removed first, whatever this run carries; the buffers of runs of this host still in flight are theirs
      await sweepBuffers();
      // A tab that is not at its prompt would leave the values waiting in the buffer until the run gave up (review 12 Nov, finding 3), and the typed line would go to whatever runs there:
      // a run that carries values goes only to a tab whose shell is waiting for a line, and never while another run of this host is in it.
      if (withValues) {
        if (running.has(session)) throw Object.assign(new Error(BUSY), { code: "busy" });
        if (!(await shellAtPrompt(o.exec, session))) throw Object.assign(new Error(BUSY), { code: "busy" });
      }
      running.add(session);
      const buffer = withValues ? `${own}${rnd(16)}` : null;
      try {
        if (buffer !== null) {
          const script = Object.entries(r.env)
            .map(([k, v]) => `export ${k}=${shQuote(v)}\n`)
            .join("");
          mine.add(buffer);
          const loaded = await o.exec(["tmux", "load-buffer", "-b", buffer, "-"], { stdin: script });
          if (loaded.code !== 0) throw new Error(`tmux load-buffer failed: ${loaded.stderr.trim().slice(0, 200)}`);
        }
        const tm = shQuote(o.tmuxPath ?? "tmux");
        // a tab may have xtrace or verbose on (set -x, set -v): the subshell turns both off before it touches a value, or the shell would print the values, re-quoted, past the scrubber
        const body =
          buffer !== null
            ? `( { set +xv; } 2>/dev/null; __vyre_env="$(${tm} save-buffer -b ${shQuote(buffer)} - 2>/dev/null)"; ${tm} delete-buffer -b ${shQuote(buffer)} 2>/dev/null; [ -n "$__vyre_env" ] || { echo 'Vyre could not hand this command its values.' >&2; exit 125; }; eval "$__vyre_env"; unset __vyre_env; ${r.command}\n)`
            : `{ ${r.command}\n}`;
        const cd = r.cwd === undefined ? "" : `cd ${shQuote(r.cwd)} && `;
        // Begin and end markers are printed by the shell, so the typed line (which holds them only inside quotes) never matches a marker line. The leading space keeps the line out of the shell's history.
        // the exit code also goes into a tmux option of the session, which nothing on the screen can overwrite (runLine)
        const rcOption = `@vyre_rc_${nonce}`;
        const line = ` printf '%s\\n' ${shQuote(beg)}; ${cd}${body}; __vyre_rc=$?; ${tm} set-option -q -t ${shQuote(session)} ${rcOption} "$__vyre_rc" 2>/dev/null; printf '\\n%s:%d\\n' ${shQuote(end)} "$__vyre_rc"; unset __vyre_rc`;
        return await runLine(session, line, beg, end, leftMs, rcOption, r.signal);
      } finally {
        running.delete(session);
        if (buffer !== null) {
          await o.exec(["tmux", "delete-buffer", "-b", buffer]).catch(() => undefined);
          mine.delete(buffer);
        }
      }
    },
    async status(ids) {
      const out: Array<{ terminalId: string; state: TermState; lastLine?: string; exitCode: number | null }> = [];
      // a status read is quiet (rc.44): the pane asks every few seconds for every row, and it must neither wait behind a wake (the serial chain), nor count as use (a page left open kept the workspace awake for
      // ever), nor start the container; where the host has no quiet way it is the ordinary one
      const q = o.quietExec ?? o.exec;
      const qt = async (args: readonly string[]): Promise<string> => {
        const r = await q(["tmux", ...args]);
        if (r.code !== 0) throw new Error(`tmux ${args[0] ?? ""} failed: ${r.stderr.trim().slice(0, 200)}`);
        return r.stdout;
      };
      for (const terminalId of ids) {
        const session = nameOf(terminalId);
        const has = await q(["tmux", "has-session", "-t", session]);
        if (has.code !== 0) {
          out.push({ terminalId, state: "exited", exitCode: null });
          continue;
        }
        const cmd = tidy(await qt(["display-message", "-p", "-t", session, "#{pane_current_command}"]));
        const last = tidy(await qt(["capture-pane", "-p", "-J", "-t", session, "-S", "-5"]))
          .split("\n")
          .filter((l) => l.trim() !== "")
          .pop();
        out.push({
          terminalId,
          state: SHELLS.has(cmd) ? "idle" : "running",
          ...(last === undefined ? {} : { lastLine: last.slice(0, 300) }),
          exitCode: null,
        });
      }
      return out;
    },
    async close(terminalId) {
      marks.delete(nameOf(terminalId));
      const r = await o.exec(["tmux", "kill-session", "-t", nameOf(terminalId)]);
      // A session that is already gone is closed.
      if (r.code !== 0 && !/can't find session|no server running|no such session/i.test(r.stderr))
        throw new Error(`tmux kill-session failed: ${r.stderr.trim().slice(0, 200)}`);
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
    host.stream = (terminalId, onFrame) => {
      // Stopping a viewer ends its tmux client, which takes a moment: lines it had already written still arrive. Once stop() has been called nothing more may reach the viewer.
      let live = true;
      const stop = control(nameOf(terminalId), (line) => {
        if (!live) return;
        const f = frameOf(line);
        if (f !== null) onFrame(f);
      });
      return () => {
        live = false;
        stop();
      };
    };
  }
  return host;
}

// ---- the live relay ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The host's live connection spends an attach ticket and gets the session's frames. Frames pass through the session's scrubber, so a Vault value filled into a command never reaches the tab.
 * Output goes out as it arrives; only a tail that is the start of a secret's spelling is held back until the next frame shows whether it was one (and dropped if the tab closes first).
 * Null when the ticket is unknown, spent or expired, or this host runs no terminals.
 */
export async function openFrames(
  db: Db,
  ticket: string,
  now: number,
  send: (text: string) => void,
): Promise<{ terminalId: string; personId: string; close(): void } | null> {
  const host = boundHost();
  if (!host?.stream) return null;
  const who = await redeemTicket(db, ticket, now);
  if (!who) return null;
  let carry = "";
  let closed = false;
  // the session's workspace: a value another tab of it filled is taken out too
  const scope = scopeOfId(db, who.terminalId);
  // the typed wrapper line of terminal.run is never shown (stream-log.ts), and a frame that holds the start of it waits for its end
  const runLine = createRunLineFilter(hideRunLine);
  const stop = host.stream(who.terminalId, (raw) => {
    if (closed) return;
    const frame = runLine.push(raw);
    if (frame === "") return;
    const sc = scrubberFor(scope);
    if (!sc) {
      send(carry + frame);
      carry = "";
      return;
    }
    // Scrub first, hold back after: a value that is whole in what has arrived is removed whole. Holding the tail before scrubbing cut the value's last character off whenever it could itself start another
    // spelling of the value (an s, a 7 for the hex form, a c for the base64 form) and the frame ended exactly on the value, which left the rest of the value in the stream.
    const text = sc.scrub(carry + frame);
    const hold = partialSpellingAt(text, spellingsFor(scope));
    const out = text.slice(0, text.length - hold);
    carry = text.slice(text.length - hold);
    if (out !== "") send(out);
  });
  return {
    ...who,
    close() {
      closed = true;
      carry = "";
      stop();
    },
  };
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
export type ShellRun = (a: {
  command: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
  onData(text: string): void;
  signal: AbortSignal;
}) => Promise<{ exitCode: number | null }>;

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

interface ShellSession {
  cwd: string;
  lines: string[];
  partial: string;
  typed: string;
  running: AbortController | null;
  exitCode: number | null;
  listeners: Set<(text: string) => void>;
  dropped: number;
}

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
    if (s.lines.length > scrollback) {
      s.dropped += s.lines.length - scrollback;
      s.lines.splice(0, s.lines.length - scrollback);
    }
    const frame = text.replace(/\r?\n/g, "\r\n");
    for (const f of s.listeners) f(frame);
  };
  const tidy = (text: string): string => text.replace(/\s+$/u, "");

  /** `typed`: the person typed the line, so it is on the screen already. */
  async function exec(
    s: ShellSession,
    r: { command: string; cwd?: string; env: Readonly<Record<string, string>>; timeoutMs: number },
    typed = false,
  ): Promise<{ exitCode: number | null; output: string; truncated: boolean; durationMs: number }> {
    if (s.running) throw new Error("a command is still running in this session");
    for (const k of Object.keys(r.env))
      if (!ENV_NAME.test(k)) throw new Error(`${k} is not a name an environment variable can have`);
    if (!typed) {
      if (s.partial !== "") show(s, "\n");
      show(s, `$ ${r.command}\n`);
    }
    const ac = new AbortController();
    s.running = ac;
    let out = "";
    let timedOut = false;
    const t0 = now();
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, r.timeoutMs);
    // the turn that started it was stopped: the command stops as a Ctrl-C would stop it
    let stopped = false;
    const onStop = (): void => {
      stopped = true;
      ac.abort();
    };
    if (r.signal?.aborted) onStop();
    else r.signal?.addEventListener("abort", onStop, { once: true });
    let res: { exitCode: number | null };
    try {
      res = await o.run({
        command: r.command,
        cwd: r.cwd ?? s.cwd,
        env: r.env,
        signal: ac.signal,
        onData: (t) => {
          out += t;
          if (out.length > maxOutput * 2) out = out.slice(out.length - maxOutput);
          show(s, t);
        },
      });
    } finally {
      clearTimeout(timer);
      s.running = null;
      r.signal?.removeEventListener("abort", onStop);
    }
    if (s.partial !== "") show(s, "\n");
    if (stopped && !timedOut) {
      show(s, `${STOPPED_LINE}\n`);
      return {
        exitCode: 130,
        output: `${tidy(out)}\n${STOPPED_LINE}`.trim(),
        truncated: false,
        durationMs: now() - t0,
      };
    }
    s.exitCode = res.exitCode;
    if (timedOut) throw Object.assign(new Error("the command did not finish in time"), { code: "timeout" });
    let output = tidy(out);
    let truncated = false;
    if (output.length > maxOutput) {
      output = output.slice(output.length - maxOutput);
      truncated = true;
    }
    return { exitCode: res.exitCode, output, truncated, durationMs: now() - t0 };
  }

  return {
    async open(a) {
      const cwd = a.cwd ?? o.home;
      sessions.set(a.terminalId, {
        cwd,
        lines: [],
        partial: "",
        typed: "",
        running: null,
        exitCode: null,
        listeners: new Set(),
        dropped: 0,
      });
      return { cwd };
    },
    // A person typing: the line is kept until Enter, then run like a command of their own. Backspace takes back a character; Ctrl-C stops what runs.
    async input(terminalId, data) {
      const s = must(terminalId);
      for (const ch of data) {
        if (ch === "\x03") {
          s.running?.abort();
          s.typed = "";
          show(s, "^C\n");
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          const line = s.typed;
          s.typed = "";
          show(s, "\n");
          if (line.trim() !== "" && !s.running)
            void exec(s, { command: line, env: {}, timeoutMs: 3_600_000 }, true).catch((e: unknown) =>
              show(s, `${e instanceof Error ? e.message : "the command failed"}\n`),
            );
          continue;
        }
        if (ch === "\x7f" || ch === "\b") {
          if (s.typed !== "") {
            s.typed = s.typed.slice(0, -1);
            s.partial = s.partial.slice(0, -1);
            for (const f of s.listeners) f("\b \b");
          }
          continue;
        }
        if (s.typed === "" && s.partial === "") show(s, "$ ");
        s.typed += ch;
        show(s, ch);
      }
    },
    async interrupt(terminalId) {
      const s = must(terminalId);
      s.running?.abort();
      show(s, "^C\n");
    },
    async resize(terminalId) {
      must(terminalId);
    },
    async read(terminalId, r) {
      // lines are counted from the session's first one, and the line being written on (the partial one) is `next`, sent again until it ends: the same reading as a tmux session's
      const s = must(terminalId);
      const all = screen(s);
      const text = r.since === undefined ? all.slice(-r.lines) : all.slice(Math.max(0, r.since - s.dropped));
      return { text: text.join("\n"), next: s.dropped + s.lines.length };
    },
    run: async (terminalId, r) => exec(must(terminalId), r),
    async status(ids) {
      return ids.map((terminalId) => {
        const s = sessions.get(terminalId);
        if (!s) return { terminalId, state: "exited" as const, exitCode: null };
        const last = screen(s)
          .filter((l) => l.trim() !== "")
          .pop();
        return {
          terminalId,
          state: s.running ? ("running" as const) : ("idle" as const),
          ...(last === undefined ? {} : { lastLine: last.slice(0, 300) }),
          exitCode: s.exitCode,
        };
      });
    },
    stream(terminalId, onFrame) {
      const s = sessions.get(terminalId);
      if (!s) return () => undefined;
      s.listeners.add(onFrame);
      return () => {
        s.listeners.delete(onFrame);
      };
    },
    async close(terminalId) {
      const s = sessions.get(terminalId);
      if (!s) return;
      s.running?.abort();
      s.listeners.clear();
      sessions.delete(terminalId);
    },
    async health() {
      return {
        ok: true,
        detail: "Commands run in a shell on this computer. Install tmux for full terminals.",
        sessions: sessions.size,
      };
    },
    // a plain session lives in this process: after a restart its row is made a session again, empty, in its folder
    adopt(a) {
      if (!sessions.has(a.terminalId))
        sessions.set(a.terminalId, {
          cwd: a.cwd ?? o.home,
          lines: [],
          partial: "",
          typed: "",
          running: null,
          exitCode: null,
          listeners: new Set(),
          dropped: 0,
        });
    },
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
  /** Where tmux is on this computer (TmuxOptions.tmuxPath). */
  tmuxPath?: string;
  /** This daemon's mark in its values buffers' names (TmuxOptions.mark). */
  mark?: string;
  /** A session for this target lives on this machine. Anything else is another machine, which this one cannot reach. */
  runsHere(target: Target): boolean;
  place?: PlaceOf;
  /** The Space's Vault, for a #Handle.field in a command: the vault.use check as the agent for the person, then the value (host/src/seams/engine-session.ts). Omitted: a handle stays text. */
  values?: ValueSource;
  /** Agent workspaces on this machine (the Space server): where Docker is and which image, and the Files and project folders to mount. Omitted: this host has none. */
  workspaces?: WorkspaceConfig;
}

/** What the daemon hands over for agent workspaces (host/src/seams/terminal-host.ts): configuration only. The module builds the Docker managers from it, as agent computers are built. */
export interface WorkspaceConfig
  extends Pick<
    WorkspaceOptions,
    | "image"
    | "limits"
    | "idleMs"
    | "home"
    | "projectsOf"
    | "projectAccessOf"
    | "admit"
    | "capacity"
    | "log"
    | "owner"
    | "ownsAgent"
    | "inTurn"
    | "folders"
  > {
  /** Is this agent in Trash now (agents_agent.deletedAt)? Read before Trash volumes go and when agent.deleted is consumed, so a restored agent never loses them (third look T2). */
  inTrash?: (agentId: string) => boolean | undefined;
  /** The Docker Engine socket of this machine. With no socket and no runner the Space has no runtime of its own, and its workspaces go on servers that joined. */
  socketPath?: string;
  /** A Team server: the container runner's socket and its token (read again on each call). vyred holds no Docker socket there. */
  runner?: { socket: string; token(): string };
  /** Servers that joined the Space: a question for one over its live socket, and which one (connected, with Docker) an agent's workspace goes on when the Space has no runtime of its own. */
  nodes?: {
    ask(nodeId: string, kind: string, input: unknown, timeoutMs?: number): Promise<unknown>;
    place(agentId: string): Promise<string | null>;
    /** Is this server's link to the Space private? Absent: no server's is, so none gets a Vault value. */ secure?(
      nodeId: string,
    ): boolean;
  };
}

/** The manager of one machine's Docker engine, not yet used: the first terminal command or attach makes the workspace. */
export function buildWorkspaces(c: WorkspaceConfig): WorkspaceManager {
  const http = c.runner
    ? unixSocketHttp(c.runner.socket, undefined, () => ({ authorization: `Bearer ${c.runner!.token()}` }))
    : unixSocketHttp(c.socketPath);
  const { socketPath: _s, runner, nodes: _n, ...rest } = c;
  return buildWorkspaceManager({ ...rest, http, ...(runner ? { runner: true } : {}) } as Omit<WorkspaceOptions, "api">);
}

/** The managers of every machine an agent's workspace may live on, as the one the terminal sees: the Space's own runtime and each server that joined. */
export function buildWorkspaceFleet(c: WorkspaceConfig): WorkspaceFleet {
  const hasRuntime = c.socketPath !== undefined || c.runner !== undefined;
  const nodes = c.nodes;
  const { nodes: _n, ...own } = c;
  return createWorkspaceFleet({
    space: hasRuntime ? buildWorkspaces(own) : null,
    node: (nodeId) => {
      if (!nodes) throw new Error("This Space has no servers to run workspaces on.");
      const { socketPath: _s, runner: _r, nodes: _x, capacity, ...rest } = c;
      const http = remoteDockerHttp((input, timeoutMs) => nodes.ask(nodeId, "docker", input, timeoutMs));
      return buildWorkspaceManager({
        ...rest,
        valuesAllowed: () => nodes.secure?.(nodeId) === true,
        ...(capacity
          ? {
              capacity: {
                claim: (a: string) => capacity.claim(a, nodeId),
                release: (a: string) => capacity.release(a, nodeId),
                ...(capacity.waiting ? { waiting: (a: string) => capacity.waiting!(a, nodeId) } : {}),
              },
            }
          : {}),
        http,
        runner: true,
      } as Omit<WorkspaceOptions, "api">);
    },
    place: async (agentId) => (nodes ? nodes.place(agentId) : null),
  });
}
/** The sessions of this machine: tmux when it is installed, else a plain shell. A target on another machine is refused at open. */
export function createLocalHost(
  o: Omit<TerminalHostSeam, "place" | "workspaces" | "values">,
  workspaces?: WorkspaceManager | WorkspaceTerminalHost,
): TerminalHost {
  const ws: WorkspaceTerminalHost | null =
    workspaces === undefined
      ? null
      : "has" in workspaces
        ? workspaces
        : createWorkspaceTerminalHost({ manager: workspaces });
  const tmux = createTmuxHost({
    exec: o.exec,
    ...(o.control ? { control: o.control } : {}),
    ...(o.tmuxPath ? { tmuxPath: o.tmuxPath } : {}),
    ...(o.mark ? { mark: o.mark } : {}),
  });
  const plain = createShellHost({ run: o.shell, home: o.home });
  let tmuxKnown: boolean | null = null;
  let probe: Promise<boolean> | null = null;
  const hasTmux = (): Promise<boolean> =>
    (probe ??= o
      .exec(["tmux", "-V"])
      .then(
        (r) => r.code === 0,
        () => false,
      )
      .then((v) => {
        tmuxKnown = v;
        return v;
      }));
  // a host that starts removes what a run of this daemon left on this computer's tmux server before it died (review 12 Nov, 3b)
  void hasTmux()
    .then((on) => (on ? tmux.sweep() : undefined))
    .catch(() => undefined);
  const owner = new Map<string, TerminalHost>();
  /** Sessions whose row this process has been told about (adopt), so a session is looked for and made again at most once per process. */
  const adopted = new Set<string>();
  /** Sessions opened before a restart are tmux ones when tmux is here: they outlive the daemon. */
  const revive = new Map<string, AdoptArgs>();
  /** A session on this computer that tmux lost (a reboot), made again for the first thing done in it, with the same history rule as a new one (HISTORY_ENV; a tmux older than 3.0 has no -e). */
  const ready = async (id: string): Promise<void> => {
    const a = revive.get(id);
    if (a === undefined) return;
    revive.delete(id);
    const session = `vyre-${id}`;
    if ((await o.exec(["tmux", "has-session", "-t", session])).code === 0) return;
    const rest = [
      "-d",
      "-s",
      session,
      "-x",
      String(a.cols),
      "-y",
      String(a.rows),
      ...(a.cwd === undefined ? [] : ["-c", a.cwd]),
    ];
    const made = await o.exec(["tmux", "new-session", ...HISTORY_ENV, ...rest]);
    if (made.code !== 0 && /unknown option|invalid option|usage:/i.test(made.stderr))
      await o.exec(["tmux", "new-session", ...rest]);
  };
  const of = async (id: string): Promise<TerminalHost> =>
    owner.get(id) ?? (ws && (await ws.has(id)) ? ws : (await hasTmux()) ? tmux : plain);
  return {
    async open(a) {
      // an agent's workspace is a container on this machine, whatever machine the person is on
      if (a.target.host === "agent_computer" && ws) {
        const r = await ws.open(a);
        owner.set(a.terminalId, ws);
        adopted.add(a.terminalId);
        return r;
      }
      if (!o.runsHere(a.target)) throw new Error("that computer is not this one, and this one cannot reach it");
      const h = (await hasTmux()) ? tmux : plain;
      const r = await h.open(a);
      owner.set(a.terminalId, h);
      adopted.add(a.terminalId);
      return r;
    },
    input: async (id, data) => {
      await ready(id);
      return (await of(id)).input(id, data);
    },
    interrupt: async (id) => {
      await ready(id);
      return (await of(id)).interrupt(id);
    },
    resize: async (id, cols, rows) => {
      await ready(id);
      return (await of(id)).resize(id, cols, rows);
    },
    // an attach (the replay) makes it again; the live read of an open tab does not
    read: async (id, r) => {
      if (r.since === undefined) await ready(id);
      return (await of(id)).read(id, r);
    },
    capture: async (id, r) => {
      await ready(id);
      const h = await of(id);
      if (!h.capture)
        throw Object.assign(new Error("This terminal has no screen to draw with colours."), { code: "unsupported" });
      return h.capture(id, r);
    },
    keys: async (id, ks) => {
      await ready(id);
      const h = await of(id);
      if (!h.keys) throw Object.assign(new Error("This terminal takes lines, not keys."), { code: "unsupported" });
      return h.keys(id, ks);
    },
    run: async (id, r) => {
      await ready(id);
      return (await of(id)).run(id, r);
    },
    async status(ids) {
      const out: Awaited<ReturnType<TerminalHost["status"]>> = [];
      for (const id of ids) out.push(...(await (await of(id)).status([id])));
      return out;
    },
    stream(id, onFrame) {
      const h = owner.get(id) ?? (tmuxKnown === true ? tmux : plain);
      return h.stream ? h.stream(id, onFrame) : () => undefined;
    },
    async close(id) {
      await (await of(id)).close(id);
      owner.delete(id);
      adopted.delete(id);
    },
    health: async () => ((await hasTmux()) ? tmux.health() : plain.health()),
    async adopt(a) {
      // the first use of a session in this process: an agent's goes to its workspace (asleep or not, made or not); one on this computer to tmux, made again when tmux lost it, or to the plain shell
      if (adopted.has(a.terminalId)) return;
      if (a.target.host === "agent_computer") {
        if (!ws) return;
        ws.adopt(a);
        owner.set(a.terminalId, ws);
        adopted.add(a.terminalId);
        return;
      }
      if (!o.runsHere(a.target)) return;
      const viaTmux = await hasTmux();
      // a tmux session is made again only when something is done in it (a command, keys, an attach), never by a status read: one the person ended with exit reads as exited until then
      if (viaTmux) revive.set(a.terminalId, a);
      else plain.adopt?.(a);
      if (!owner.has(a.terminalId)) owner.set(a.terminalId, viaTmux ? tmux : plain);
      adopted.add(a.terminalId);
    },
  };
}

/** The daemon's half: this machine's sessions and where turns run. Null on shutdown. */
let workspaceManager: WorkspaceManager | null = null;
let inTrashCheck: ((agentId: string) => boolean | undefined) | null = null;
/** The workspaces of this machine, for the host's Computer tab and tests: null when there are none. */
export const boundWorkspaces = (): WorkspaceManager | null => workspaceManager;

/** The daemon has told this module what runtime the Space has (a workspace manager, or none): until then an erase cannot know whether a container is to be removed. */
let hostBound = false;
export function setTerminalHost(seam: TerminalHostSeam | null): void {
  hostBound = true;
  workspaceManager?.close();
  const fleet = seam?.workspaces ? buildWorkspaceFleet(seam.workspaces) : null;
  workspaceManager = fleet;
  inTrashCheck = seam?.workspaces?.inTrash ?? null;
  bindMachineHost(seam === null ? null : createLocalHost(seam, workspaceManager ?? undefined));
  bindMachinePlace(seam?.place ?? null);
  bindMachineValues(seam?.values ?? null);
  // agent commands go to a workspace when there is a machine for this agent's one right now; with none (no runtime, no server) they go where the turn runs, as before
  bindWorkspaces(fleet ? (agentId) => fleet.available(agentId) : false);
  bindWorkspaceStatus(fleet ? (agentId) => fleet.status(agentId) : null);
  bindNotes(fleet ? (agentId) => fleet.takeNotes(agentId) : null);
  bindPlaceGrant(
    fleet
      ? async (agentId, place) => {
          const projects = await fleet.projectAccess(agentId, place.person);
          const g = await fleet.exec(agentId, grantCommand(place, projects));
          if (g.code !== 0)
            throw new Error(`What this person may reach could not be set (${g.stderr.trim().slice(0, 160)}).`);
        }
      : null,
  );
  bindChatFolder(
    fleet
      ? async (agentId, thread, place) => {
          const made = await fleet.exec(agentId, chatFolderCommand(thread, place?.uid));
          if (made.code !== 0)
            throw new Error(`the chat's folder could not be made (${made.stderr.trim().slice(0, 120)})`);
          await fleet.exec(agentId, chatLinkCommand(thread, place?.home ?? "/home/agent"), {
            ...(place === undefined ? {} : { user: place.uid }),
          });
        }
      : null,
  );
}

// Only the setter the daemon wires is a host seam.
export const hostSeams = { setTerminalHost };

/**
 * This module's part of the daemon's registry of agent networks (host/src/routes/site-host.ts agentSubnetsOf, lane f-sbrowser): the subnets agent workspaces are on, so the daemon's guard keeps its own
 * routes from a workspace terminal as it does from an agent's browser.
 */
export const agentSubnets = (): string[] => workspaceManager?.subnets() ?? [];

/** Server health's count of the networks this host's Docker has left (12 Nov: each site takes one; agent workspaces share one), or nothing when Docker does not answer. */
export async function networkRoomFindings(ok: string): Promise<RoomFinding[]> {
  const subnets = await workspaceManager?.hostSubnets().catch(() => null);
  // while workspaces go on Docker's default network because the shared one cannot be had: one line an admin sees, gone once the network exists (third look T3)
  const note = workspaceManager?.networkNote() ?? null;
  const vols = await workspaceManager?.hostVolumes().catch(() => null);
  const capMb =
    Number(process.env["VYRE_VOLUME_SOFT_CAP_MB"]) > 0
      ? Number(process.env["VYRE_VOLUME_SOFT_CAP_MB"])
      : DEFAULT_SOFT_CAP_MB;
  return [
    ...(subnets ? [networkRoomFinding(networkRoom(subnets), ok, siteRoom(subnets))] : []),
    ...(vols ? [volumeFinding(vols, capMb, ok)] : []),
    ...(note
      ? [
          {
            key: "host.workspace_network",
            state: "degraded" as const,
            detail: note,
            next: "Free Docker address pools (remove networks you no longer use, or add default-address-pools to Docker's daemon.json), then restart Docker. Workspaces move to their own network when they are next quiet.",
          },
        ]
      : []),
  ];
}

/** The subnets of the networks running workspaces are on, read: the daemon awaits this before it takes calls, so its guard refuses them from the first one (third look T5). */
export async function workspacesReady(): Promise<void> {
  await workspaceManager?.ready().catch(() => undefined);
}

/** Jobs the host runs on a clock. */
/** What the sweep asks of the host: the access answers (as the host, so any person can be asked about) and the commands in a workspace. */
function accessDeps(ctx: TermCtx): AccessDeps {
  const check = async (person: string, level: string, resource: { type: string; id: string }): Promise<boolean> => {
    const r = (await ctx.call?.("access.check", {
      principal: { kind: "person", id: person },
      action: { level },
      resource,
    })) as { decision?: { effect?: string } } | undefined;
    if (r?.decision?.effect === undefined) throw new Error("the access answer could not be read");
    return r.decision.effect === "allow";
  };
  const wm = workspaceManager;
  return {
    mayUse: (person, agentId) => check(person, "use", { type: "agent", id: agentId }),
    // who may read a chat is who is in it: its members (a person who left, or was never in it, has no entry on its folder)
    mayView: async (person, thread) => {
      const r = (await ctx.call?.("threads.get", { threadId: thread })) as
        | { thread?: { members?: Array<{ kind?: string; id?: string }> } }
        | undefined;
      if (r?.thread?.members === undefined) throw new Error("the chat could not be read");
      return r.thread.members.some((m) => m.kind === "person" && m.id === person);
    },
    stopFor: async (agentId, place) => {
      await wm?.exec(agentId, ["sh", "-c", "kill -9 -1; true"], { quiet: true, user: place.uid });
    },
    run: wm
      ? async (agentId, argv, user) => {
          const r = await wm.exec(agentId, argv, { quiet: true, ...(user === undefined ? {} : { user }) });
          return { code: r.code };
        }
      : null,
  };
}

export const periodic = {
  /** Hourly: the kept output of commands that ended a week ago or more is deleted (cmdlog.ts). */
  "terminal.cmdlog_expire": {
    everyMs: 60 * 60_000,
    run: (ctx: TermCtx): string[] => {
      ensureTerminalTables(ctx.db);
      const n = expireCmdLogs(ctx.db, ctx.now());
      return n > 0 ? [`${n} kept outputs expired`] : [];
    },
  },
  /** Every 15 seconds: whoever lost the use of an agent in any way (a group, a role, an expiry, a suspension) is out of its computer and their programs there end; chat folders follow chat membership. */
  "terminal.use_sweep": {
    everyMs: 15_000,
    run: (ctx: TermCtx): Promise<string[]> => reconcileAccess(ctx, accessDeps(ctx)),
  },
  /** Hourly: the home and Files volumes of an agent in Trash longer than the Space's Trash retention are removed (12 Nov, the Space browser's rule for its profiles). */
  "terminal.trash_volumes": {
    everyMs: 60 * 60_000,
    run: (ctx: TermCtx): Promise<string[]> =>
      forgetExpiredWorkspaces(
        ctx,
        workspaceManager ? (agentId) => (workspaceManager as WorkspaceManager).remove(agentId) : null,
        inTrashCheck,
      ),
  },
  /** Hourly: the folders of people who left the Space more than the Trash time ago are removed from the workspaces that are awake. */
  "terminal.leavers_folders": {
    everyMs: 60 * 60_000,
    run: (ctx: TermCtx): Promise<string[]> =>
      forgetExpiredPeople(
        ctx,
        workspaceManager
          ? async (agentId, place) => {
              const r = await (workspaceManager as WorkspaceManager).exec(agentId, removeCommand(place), {
                quiet: true,
                user: place.uid,
              });
              return r.code === 0;
            }
          : null,
      ),
  },
};

/**
 * Work the host hands this module, with the module's own ctx (host/src/daemon/consumers.ts). `terminal.workspace_revoke`: leaving a project, done before the removal answers (the projects module awaits it
 * inside its per-project queue): the agent's workspace stops mounting and mirroring the project now; the consumer on project.member_removed is the backstop.
 */
export const hostCalls = {
  /**
   * Delete for good (F77): the agent's terminals and their commands, tabs, keys and holds go; its workspace container and both volumes (its home, and its Files with every person's own place on it, with the
   * terminals' tmux state, browser profile files and downloads that live there) are removed from every machine. A machine that does not answer fails the step, so the job tries again; none is skipped.
   */
  "terminal.erase_agent": async (
    ctx: TermCtx,
    i: { agentId: string; dry?: boolean },
  ): Promise<{ bytes?: number; folderPeople?: string[] }> => {
    ensureTerminalTables(ctx.db);
    const ids = (
      tryAll(ctx.db, "SELECT terminal_id FROM terminal_sessions WHERE agent_id = ?", i.agentId) as Row[]
    ).map((r) => String(r["terminal_id"]));
    if (i.dry === true)
      // the people who have worked on this computer have their own place on it
      return {
        folderPeople: [
          ...new Set([
            // a person who has a folder on this computer (terminal_person_places), and, as a backstop, anyone who has had a terminal on it
            ...tryAll(ctx.db, "SELECT person FROM terminal_person_places WHERE agent_id = ?", i.agentId).map((r) =>
              String(r["person"]),
            ),
            ...tryAll(
              ctx.db,
              "SELECT DISTINCT owner FROM terminal_sessions WHERE agent_id = ? AND owner LIKE 'usr_%'",
              i.agentId,
            ).map((r) => String(r["owner"])),
          ]),
        ],
      };
    // the manager is not bound yet (the daemon is still starting): the container and its volumes are still to be removed, so this step fails and the job tries again, never skips
    if (!workspaceManager && !hostBound)
      throw new Error("The workspace manager is not ready yet, so the computer is kept for the next try.");
    if (workspaceManager) await (workspaceManager as WorkspaceManager).remove(i.agentId);
    forgetAgentSecrets(i.agentId);
    for (const id of ids) {
      for (const t of [
        "terminal_commands",
        "terminal_tabs",
        "terminal_hold",
        "terminal_lease",
        "terminal_key_batch",
        "terminal_tickets",
        "terminal_cmd_log",
      ])
        tryRun(ctx.db, `DELETE FROM ${t} WHERE terminal_id = ?`, id);
      tryRun(ctx.db, "DELETE FROM terminal_sessions WHERE terminal_id = ?", id);
    }
    tryRun(ctx.db, "DELETE FROM terminal_workspace_gone WHERE agent_id = ?", i.agentId);
    tryRun(ctx.db, "DELETE FROM terminal_person_places WHERE agent_id = ?", i.agentId);
    return {};
  },
  /** terminal_run's new tab, opened and committed before its command runs (only terminal.run may call it: host/src/daemon/consumers.ts MODULE_PATH_CALL). */
  "terminal.open_tab": (ctx: TermCtx, input: unknown): Promise<{ terminalId: string }> =>
    openTabForRun(ctx, input as Parameters<typeof openTabForRun>[1]),
  "terminal.workspace_revoke": async (
    _ctx: TermCtx,
    input: { agentId?: unknown; projectId?: unknown },
  ): Promise<{ done: boolean }> => {
    if (typeof input?.agentId !== "string" || typeof input.projectId !== "string" || !workspaceManager)
      return { done: false };
    await workspaceManager.cut(input.agentId, input.projectId);
    return { done: true };
  },
};

/** What the module reads from the event log (host/src/daemon/consumers.ts runs each after commit, at least once). */
export const consumers = {
  /** A person left the Space: what their commands printed (run by them, or by an agent for them) is erased with them (cmdlog.ts). */
  "terminal.cmdlog_person_left": {
    on: ["member.removed"],
    run: (ctx: TermCtx, event: { payload: { personId?: unknown } }): number => {
      ensureTerminalTables(ctx.db);
      return typeof event.payload.personId === "string" ? eraseCmdLogsOfPerson(ctx.db, event.payload.personId) : 0;
    },
  },
  /** An agent was deleted for good: the output its commands kept goes with it (cmdlog.ts). */
  "terminal.cmdlog_agent_deleted": {
    on: ["agent.deleted"],
    run: (ctx: TermCtx, event: { payload: { agentId?: unknown } }): number => {
      ensureTerminalTables(ctx.db);
      return typeof event.payload.agentId === "string" ? eraseCmdLogsOfAgent(ctx.db, event.payload.agentId) : 0;
    },
  },
  /** A person left the Space: unreachable at once, their processes stopped where they run; their folder is erased at once where it is (and by the hourly pass where the workspace could not be reached). */
  "terminal.person_left": {
    on: ["member.removed"],
    run: (ctx: TermCtx, event: { payload: { personId?: unknown } }): Promise<string[]> =>
      onPersonLeft(ctx, event, async (agentId, place) => {
        // as them, and only where it runs: a sleeping workspace has nothing of theirs running and is not woken
        await workspaceManager?.exec(agentId, ["sh", "-c", "kill -9 -1; true"], { quiet: true, user: place.uid });
        // and what they made is erased at once (a person who leaves the Space takes nothing of theirs with the next person who gets their user)
        await workspaceManager?.exec(agentId, removeCommand(place), { user: place.uid });
      }),
  },
  /** What a person may reach on an agent's computer may have changed (a grant, a group, a role, an expiry, a suspension, a chat's members): it is brought back to what they may reach now at once (handlers/sessions.ts reconcileAccess). */
  "terminal.use_gone": {
    on: ["grant.revoked", "grant.updated", "access.changed", "principal.suspended", "channel.member_removed"],
    run: (ctx: TermCtx): Promise<string[]> => reconcileAccess(ctx, accessDeps(ctx)),
  },
  /** Back inside the Trash time: their folder is theirs again. */
  "terminal.person_back": {
    on: ["member.joined"],
    run: (ctx: TermCtx, event: { payload: { personId?: unknown } }): boolean => onPersonBack(ctx, event),
  },
  /** An agent went to Trash (deleted, or the Assistant of a person removed from the Space): its sessions close and its workspace's container and room go; what it kept stays (handlers/sessions.ts onAgentGone). */
  "terminal.agent_gone": {
    on: ["agent.deleted"],
    run: (ctx: TermCtx, event: { payload: { agentId?: unknown } }): Promise<string[]> =>
      onAgentGone(
        ctx,
        event,
        workspaceManager
          ? (agentId) => (workspaceManager as WorkspaceManager).remove(agentId, { keepVolumes: true })
          : null,
        inTrashCheck,
      ),
  },
  /** Something changed in Files: awake workspaces whose Files mirror slowed down while quiet make their next pass within seconds, so a file a person drops appears without a command (fourth look U2). */
  "terminal.files_changed": {
    on: [
      "file.created",
      "file.version_added",
      "file.moved",
      "file.renamed",
      "file.deleted",
      "file.restored",
      "folder.created",
      "folder.moved",
      "folder.renamed",
      "folder.deleted",
    ],
    run: (_ctx: TermCtx, event: { payload: Record<string, unknown> }): string[] => {
      workspaceManager?.filesChanged(filesChangeOf(event.payload ?? {}));
      return [];
    },
  },
  /** A turn was stopped: the commands it started in a terminal are interrupted at once (release gate, 12 Nov). */
  "terminal.turn_stopped": {
    on: ["turn.cancelled", "run.stopped", "run.node_state"],
    run: (_ctx: TermCtx, event: { name?: string; payload: Record<string, unknown>; at?: number }): string[] => {
      const p = event.payload ?? {};
      const str = (k: string): string | undefined => (typeof p[k] === "string" ? (p[k] as string) : undefined);
      // a node of the agent work tree that stands for a command left running was stopped (a person pressed Stop on it): the command is interrupted in its tab
      if (event.name === "run.node_state") {
        const runId = str("runId");
        if (!runId || p["to"] !== "stopped") return [];
        const n = stopRuns({ runId, ...(typeof event.at === "number" ? { at: event.at } : {}) });
        return n > 0 ? [String(n)] : [];
      }
      // a Run stopped: its own commands, matched on the run (its reason is the stopper's free text, never a marker; ninth look Z1)
      if (event.name === "run.stopped") {
        const runId = str("runId");
        if (!runId) return [];
        const n = stopRuns({ runId, ...(typeof event.at === "number" ? { at: event.at } : {}) });
        return n > 0 ? [String(n)] : [];
      }
      // Only a Stop: an event written at the press (Stop, Interrupt, an agent paused, removed or leaving: pressed true), or a turn's end record whose reason is one that stops work. A daemon
      // stopping or updating (reason closing), a lost host (lease), a recovered turn, or an event with neither: nothing is interrupted (eighth look Y1). Decided by these facts, never by who
      // `by` names (a turn's end record runs as its asker). A run with no mark here (it ended, or this process started after it) is left alone; a second event finds it already stopped.
      const pressed = p["pressed"] === true;
      if (!pressed && !STOP_REASONS.has(str("reason") ?? "")) return [];
      // the cancel's commit time: a command asked for after it belongs to a later turn (seventh look X1)
      const n = stopRuns({
        ...(str("agentId") ? { agentId: str("agentId") as string } : {}),
        ...(str("threadId") ? { threadId: str("threadId") as string } : {}),
        ...(str("runId") ? { runId: str("runId") as string } : {}),
        ...(typeof event.at === "number" ? { at: event.at } : {}),
      });
      return n > 0 ? [String(n)] : [];
    },
  },
  /** A person who held a terminal's keyboard was suspended, removed from the Space or signed out: the keyboard goes back to the agent at once (the agent's next command runs). */
  "terminal.holder_gone": {
    on: ["principal.suspended", "member.removed", "session.revoked"],
    run: (
      ctx: TermCtx,
      event: { name?: string; payload: { principalId?: unknown; personId?: unknown; person?: unknown } },
    ): Promise<string[]> =>
      onHolderGone(
        ctx,
        event.payload.principalId ?? event.payload.personId ?? event.payload.person,
        event.name === "principal.suspended" || event.name === "member.removed",
      ),
  },
  /** An agent came back from Trash: its workspace may be made again, over the volumes it kept. */
  "terminal.agent_restored": {
    on: ["agent.restored"],
    run: (ctx: TermCtx, event: { payload: { agentId?: unknown } }): string[] => {
      const id = event.payload.agentId;
      if (typeof id !== "string") return [];
      onAgentRestored(ctx, id);
      workspaceManager?.restore(id);
      return [id];
    },
  },
  /** An agent was taken off a project: its workspace stops mounting and mirroring the project's folder now, even while something runs in it (12 Nov, lead's decision). */
  "terminal.project_left": {
    on: ["project.member_removed"],
    run: async (_ctx: TermCtx, event: { payload: { principal?: unknown } }): Promise<string[]> => {
      const who = event.payload.principal;
      if (typeof who !== "string" || !who.startsWith("agt_") || !workspaceManager) return [];
      await workspaceManager.revoke(who);
      return [who];
    },
  },
};

export { bindHost, bindKit, bindPlace, bindTeam, bindValues, bindWorkspaces };
export { createWorkspaceFleet, remoteDockerHttp } from "./fleet.ts";
export {
  buildWorkspaceManager,
  createWorkspaceManager,
  createWorkspaceTerminalHost,
  reviewWorkspaceConfig,
  workspaceContainerConfig,
} from "./workspace.ts";
export type { WorkspaceManager, WorkspaceRow } from "./workspace.ts";
export { commandsOf, judge, redeemTicket, rulesOf } from "./projections.ts";
