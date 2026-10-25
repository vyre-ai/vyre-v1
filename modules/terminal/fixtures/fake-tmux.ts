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

const RUN = /^printf '%s\\n' '(__VYRE_BEG_[0-9a-f]+__)'; (?:cd '((?:[^']|'\\'')*)' && )?([\s\S]*); printf '\\n%s:%d\\n' '(__VYRE_END_[0-9a-f]+__)' \$\?$/;

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

/** The command and variables inside `{ cmd\n}` or `( export A=1 B=2; cmd\n)`. */
function unwrap(body: string): { command: string; env: Record<string, string> } {
  if (body.startsWith("{ ") && body.endsWith("\n}")) return { command: body.slice(2, -2), env: {} };
  if (body.startsWith("( export ") && body.endsWith("\n)")) {
    const env: Record<string, string> = {};
    let i = "( export ".length;
    while (i < body.length) {
      const eq = body.indexOf("=", i);
      const name = body.slice(i, eq);
      const w = word(body, eq + 1);
      env[name] = w.value;
      i = w.end;
      if (body[i] === ";") { i += 2; break; }
      i += 1;
    }
    return { command: body.slice(i, -2), env };
  }
  return { command: body, env: {} };
}

export function fakeTmux(o: FakeTmuxOptions = {}) {
  const sessions = new Map<string, Sess>();
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
    const { command, env } = unwrap(body as string);
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

  const exec: Exec = async (argv) => {
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
    exec, control, calls, sessions, scripts,
    /** Print as if the program in the session wrote it. */
    write(session: string, text: string) { const s = sessions.get(session); if (s) print(s, text); },
    screen(session: string): string { return (sessions.get(session)?.lines ?? []).join("\n"); },
  };
}

export type FakeTmux = ReturnType<typeof fakeTmux>;
