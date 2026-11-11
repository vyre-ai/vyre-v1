// A small stand-in for `tmux` for the tests of createTmuxHost: just enough of new-session, send-keys, capture-pane, resize-window, kill-session, has-session, list-sessions,
// display-message and control mode that the adapter's real command lines, its markers and its parsing are exercised. It does not run a shell: a typed command is looked up in `scripts`.
import type { Exec, ExecResult } from "../impl.ts";

export type ScriptResult = { out: string; code: number } | { hang: true };
export type Script = ScriptResult | ((command: string, env: Record<string, string>) => ScriptResult);

interface Sess { name: string; cols: number; rows: number; cwd: string; lines: string[]; typed: string; hung: boolean; env: Record<string, string> }

export interface FakeTmuxOptions {
  scripts?: Record<string, Script>;
  installed?: boolean;
  version?: string;
}

const RUN = /^ printf '%s\\n' '(__VYRE_BEG_[0-9a-f]+__)'; (?:cd '((?:[^']|'\\'')*)' && )?([\s\S]*); printf '\\n%s:%d\\n' '(__VYRE_END_[0-9a-f]+__)' \$\?$/;

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

const FETCH = /^\( __vyre_env="\$\('[^']*' save-buffer -b '([^']+)' - 2>\/dev\/null\)"; [\s\S]*?unset __vyre_env; /;

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
  /** tmux paste buffers by name: what load-buffer read from its standard input. */
  const buffers = new Map<string, string>();
  const scripts = { ...(o.scripts ?? {}) };
  const calls: string[][] = [];
  const controls = new Map<string, Array<(line: string) => void>>();
  const installed = o.installed !== false;

  const escape = (text: string): string => Array.from(new TextEncoder().encode(text), (b) => (b < 32 || b === 92 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("");
  const print = (s: Sess, text: string): void => {
    s.lines.push(...text.split("\n"));
    for (const cb of controls.get(s.name) ?? []) cb(`%output %1 ${escape(`${text}\n`)}`);
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
    const [, beg, , body, end] = m;
    const { command, env } = unwrap(body as string, buffers);
    print(s, beg as string);
    const r = result(command.trim(), env);
    if ("hang" in r) { s.hung = true; return; }
    if (r.out !== "") print(s, r.out);
    print(s, "");
    print(s, `${end as string}:${r.code}`);
  }

  const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
  const bad = (stderr: string): ExecResult => ({ code: 1, stdout: "", stderr });
  const flag = (argv: readonly string[], f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

  const exec: Exec = async (argv, x) => {
    calls.push([...argv]);
    if (argv[0] !== "tmux") return bad("not tmux");
    if (!installed) return { code: 127, stdout: "", stderr: "tmux: command not found" };
    const sub = argv[1];
    if (sub === "-V") return ok(`${o.version ?? "tmux 3.4"}\n`);
    if (sub === "new-session") {
      const name = flag(argv, "-s") as string;
      if (sessions.has(name)) return bad(`duplicate session: ${name}`);
      sessions.set(name, { name, cols: Number(flag(argv, "-x")), rows: Number(flag(argv, "-y")), cwd: flag(argv, "-c") ?? "/home/agent", lines: [], typed: "", hung: false, env: {} });
      return ok();
    }
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
        return ok(`${fmt === "#{pane_current_path}" ? s.cwd : fmt === "#{pane_current_command}" ? (s.hung ? "sleep" : "bash") : ""}\n`);
      }
      case "send-keys": {
        if (argv.includes("-l")) { s.typed += argv[argv.length - 1] as string; return ok(); }
        const key = argv[argv.length - 1];
        if (key === "Enter") submit(s);
        else if (key === "C-c") { s.hung = false; s.typed = ""; print(s, "^C"); }
        return ok();
      }
      case "capture-pane": {
        const n = Math.abs(Number(flag(argv, "-S")));
        return ok(`${s.lines.slice(-n).join("\n")}\n`);
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
