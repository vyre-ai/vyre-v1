// A small stand-in for `tmux` for the tests of createTmuxHost: just enough of new-session, send-keys, capture-pane, resize-window, kill-session, has-session, list-sessions,
// display-message and control mode that the adapter's real command lines, its markers and its parsing are exercised. It does not run a shell: a typed command is looked up in `scripts`.
import type { Exec, ExecResult } from "../impl.ts";

export type ScriptResult = { out: string; code: number } | { hang: true };
export type Script = ScriptResult | ((command: string, env: Record<string, string>) => ScriptResult);

interface Sess { name: string; cols: number; rows: number; cwd: string; lines: string[]; typed: string; hung: boolean; env: Record<string, string>; up?: number; opts: Map<string, string> }

export interface FakeTmuxOptions {
  scripts?: Record<string, Script>;
  installed?: boolean;
  version?: string;
  /** Script outputs after which the end marker's row is drawn over (see overwriteEnd). */
  overwriteEnd?: string[];
  /** Lines of history a session keeps; past it a tenth is dropped at a time, as tmux does. Default 20000. */
  historyLimit?: number;
}

const RUN = /^ printf '%s\\n' '(__VYRE_BEG_[0-9a-f]+__)'; (?:cd '((?:[^']|'\\'')*)' && )?([\s\S]*); __vyre_rc=\$\?; '[^']*' set-option -q -t '[^']*' (@vyre_rc_[0-9a-f]+) "\$__vyre_rc" 2>\/dev\/null; printf '\\n%s:%d\\n' '(__VYRE_END_[0-9a-f]+__)' "\$__vyre_rc"; unset __vyre_rc$/;

/** Read one shell word starting at `at`: single quotes, a backslash-escaped character, and unquoted text up to a space. Returns the word's value and where it ended. */
function word(text: string, at: number): { value: string; end: number } {
  let i = at;
  let value = "";
  while (i < text.length && text[i] !== " " && text[i] !== ";") {
    const c = text[i] as string;
    if (c === "'") { const close = text.indexOf("'", i + 1); value += text.slice(i + 1, close); i = close + 1; }
    else if (c === "\\") { value += text[i + 1] ?? ""; i += 2; }
    else { value += c; i += 1; }
  }
  return { value, end: i };
}

/** The variables of a buffer the adapter loaded: `export A='1'` lines. */
function exportsOf(script: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of script.split("\n")) {
    if (!line.startsWith("export ")) continue;
    const eq = line.indexOf("=");
    env[line.slice("export ".length, eq)] = word(line, eq + 1).value;
  }
  return env;
}

const FETCH = /^\( \{ set \+xv; \} 2>\/dev\/null; __vyre_env="\$\('[^']*' save-buffer -b '([^']+)' - 2>\/dev\/null\)"; [\s\S]*?unset __vyre_env; /;

/** The command inside `{ cmd\n}`, or inside the subshell that fetches its variables from a buffer, with those variables (the buffer is deleted as the real line does). */
function unwrap(body: string, buffers: Map<string, string>): { command: string; env: Record<string, string> } {
  if (body.startsWith("{ ") && body.endsWith("\n}")) return { command: body.slice(2, -2), env: {} };
  const m = FETCH.exec(body);
  if (m && body.endsWith("\n)")) {
    const name = m[1] as string;
    const env = exportsOf(buffers.get(name) ?? "");
    buffers.delete(name);
    return { command: body.slice(m[0].length, -2), env };
  }
  return { command: body, env: {} };
}

export function fakeTmux(o: FakeTmuxOptions = {}) {
  const sessions = new Map<string, Sess>();
  /** Outputs of scripted commands that draw over the end marker's row (tput, a progress bar): the end line never shows on the screen. */
  const overwriteEnd = new Set<string>(o.overwriteEnd ?? []);
  /** A pane's shell pid, made up from its session name. */
  const pidOf = (name: string): number => 1000 + [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 50_000, 7) * 2;
  /** tmux paste buffers by name: what load-buffer read from its standard input. */
  const buffers = new Map<string, string>();
  const scripts = { ...(o.scripts ?? {}) };
  const calls: string[][] = [];
  const controls = new Map<string, Array<(line: string) => void>>();
  const installed = o.installed !== false;

  const escape = (text: string): string => Array.from(new TextEncoder().encode(text), (b) => (b < 32 || b === 92 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("");
  const limit = o.historyLimit ?? 20_000;
  const print = (s: Sess, text: string): void => {
    s.lines.push(...text.split("\n"));
    // the cursor's line is one more, under the printed ones; what does not fit on the screen is history, and history past the limit goes a tenth at a time
    while (s.lines.length + 1 - s.rows > limit) s.lines.splice(0, Math.max(1, Math.floor(limit / 10)));
    for (const cb of controls.get(s.name) ?? []) cb(`%output %1 ${escape(`${text}\n`)}`);
  };
  /** The screen as tmux holds it: the printed lines, then the cursor's line with what is typed on it; `h` of them are history, the last `rows` are the screen. */
  const grid = (s: Sess): { all: string[]; h: number; cy: number } => {
    const all = [...s.lines, s.typed];
    const h = Math.max(0, all.length - s.rows);
    // `up`: rows the program moved the cursor above the last line (an editor, tput); tmux's history size does not change for it
    return { all, h, cy: Math.max(0, all.length - 1 - h - (s.up ?? 0)) };
  };
  const result = (command: string, env: Record<string, string>): ScriptResult => {
    const sc = scripts[command];
    if (sc === undefined) return { out: `${command}: command not found`, code: 127 };
    return typeof sc === "function" ? sc(command, env) : sc;
  };

  function submit(s: Sess): void {
    const line = s.typed;
    s.typed = "";
    print(s, `$ ${line}`);
    const m = RUN.exec(line);
    if (!m) {
      const r = result(line.trim(), {});
      if ("hang" in r) { s.hung = true; return; }
      print(s, r.out);
      return;
    }
    const [, beg, , body, rcOption, end] = m;
    const { command, env } = unwrap(body as string, buffers);
    print(s, beg as string);
    const r = result(command.trim(), env);
    if ("hang" in r) { s.hung = true; return; }
    if (r.out !== "") print(s, r.out);
    s.opts.set(rcOption as string, String(r.code));
    // a program that drew over the marker's row (tput, a progress bar): the screen shows no end line, only the stored code says it ended
    if (overwriteEnd.has(r.out)) return;
    print(s, "");
    print(s, `${end as string}:${r.code}`);
  }

  const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
  const bad = (stderr: string): ExecResult => ({ code: 1, stdout: "", stderr });
  const flag = (argv: readonly string[], f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

  const exec: Exec = async (argv, x) => {
    // commands joined with ";" run one after another, their output together
    if (argv[0] === "tmux" && argv.includes(";")) {
      const out: string[] = [];
      let part: string[] = [];
      for (const a of [...argv.slice(1), ";"]) {
        if (a !== ";") { part.push(a); continue; }
        const r = await one(["tmux", ...part]);
        if (r.code !== 0) return r;
        out.push(r.stdout);
        part = [];
      }
      return ok(out.join(""));
    }
    return one(argv, x);
  };
  const one: Exec = async (argv, x) => {
    calls.push([...argv]);
    // the prompt check (shellAtPrompt): the terminal's foreground group is the shell's own pid unless something runs there
    if (argv[0] === "ps" && argv[1] === "-o" && argv[2] === "tpgid=") {
      const sess = [...sessions.values()].find((x) => String(pidOf(x.name)) === argv[4]);
      return sess ? ok(`${sess.hung ? pidOf(sess.name) + 1 : pidOf(sess.name)}\n`) : bad("no such process");
    }
    if (argv[0] !== "tmux") return bad("not tmux");
    if (!installed) return { code: 127, stdout: "", stderr: "tmux: command not found" };
    const sub = argv[1];
    if (sub === "-V") return ok(`${o.version ?? "tmux 3.4"}\n`);
    if (sub === "new-session") {
      const name = flag(argv, "-s") as string;
      if (sessions.has(name)) return bad(`duplicate session: ${name}`);
      sessions.set(name, { name, cols: Number(flag(argv, "-x")), rows: Number(flag(argv, "-y")), cwd: flag(argv, "-c") ?? "/home/agent", lines: [], typed: "", hung: false, env: {}, opts: new Map() });
      return ok();
    }
    if (sub === "list-buffers") return ok([...buffers.keys()].map((b) => `${b}\n`).join(""));
    if (sub === "load-buffer") { buffers.set(flag(argv, "-b") as string, x?.stdin ?? ""); return ok(); }
    if (sub === "delete-buffer") { const b = flag(argv, "-b") as string; return buffers.delete(b) ? ok() : bad(`no buffer ${b}`); }
    if (sub === "list-sessions") return ok([...sessions.keys()].join("\n") + (sessions.size ? "\n" : ""));
    const name = flag(argv, "-t") as string | undefined;
    const s = name === undefined ? undefined : sessions.get(name);
    if (sub === "has-session") return s ? ok() : bad(`can't find session: ${name}`);
    if (!s) return bad(`can't find session: ${String(name)}`);
    switch (sub) {
      case "display-message": {
        const fmt = argv[argv.length - 1];
        if (fmt === "#{history_size} #{cursor_y} #{history_limit}") { const g = grid(s); return ok(`${g.h} ${g.cy} ${limit}\n`); }
        if (fmt === "#{pane_pid} #{pane_dead} #{pane_in_mode}") return ok(`${pidOf(s.name)} 0 0\n`);
        // a user option in a format: its value, or nothing when unset
        const opt = /^(.*)#\{(@[A-Za-z0-9_]+)\}$/.exec(fmt ?? "");
        if (opt) return ok(`${opt[1]}${s.opts.get(opt[2] as string) ?? ""}\n`);
        return ok(`${fmt === "#{pane_current_path}" ? s.cwd : fmt === "#{pane_current_command}" ? (s.hung ? "sleep" : "bash") : ""}\n`);
      }
      case "send-keys": {
        // as tmux: an argument that ends in ";" loses that character, or the backslash before it
        if (argv.includes("-l")) { const a = argv[argv.length - 1] as string; s.typed += a.endsWith("\\;") ? `${a.slice(0, -2)};` : a.endsWith(";") ? a.slice(0, -1) : a; return ok(); }
        const key = argv[argv.length - 1];
        if (key === "Enter") submit(s);
        else if (key === "C-c") { s.hung = false; s.typed = ""; print(s, "^C"); }
        return ok();
      }
      case "capture-pane": {
        // as tmux: up to n lines of history above the screen, then every row of the screen (empty ones too)
        const n = Math.abs(Number(flag(argv, "-S")));
        const g = grid(s);
        const screen = g.all.slice(g.h);
        while (screen.length < s.rows) screen.push("");
        return ok(`${[...g.all.slice(Math.max(0, g.h - n), g.h), ...screen].join("\n")}\n`);
      }
      case "set-option": {
        const key = argv.find((a) => a.startsWith("@"));
        if (key === undefined) return ok();
        if (argv.includes("-u")) s.opts.delete(key); else s.opts.set(key, argv[argv.indexOf(key) + 1] ?? "");
        return ok();
      }
      case "resize-window": s.cols = Number(flag(argv, "-x")); s.rows = Number(flag(argv, "-y")); return ok();
      case "kill-session": sessions.delete(s.name); return ok();
      default: return bad(`unknown command: ${String(sub)}`);
    }
  };

  const control = (session: string, onLine: (line: string) => void): (() => void) => {
    const list = controls.get(session) ?? [];
    list.push(onLine);
    controls.set(session, list);
    return () => { controls.set(session, (controls.get(session) ?? []).filter((x) => x !== onLine)); };
  };

  return {
    exec, control, calls, sessions, scripts, buffers,
    /** Print as if the program in the session wrote it. */
    write(session: string, text: string) { const s = sessions.get(session); if (s) print(s, text); },
    screen(session: string): string { return (sessions.get(session)?.lines ?? []).join("\n"); },
  };
}

export type FakeTmux = ReturnType<typeof fakeTmux>;
