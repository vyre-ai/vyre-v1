// A Vault handle written inside a command line (`mysql -p#DB.password`, `curl -H 'Authorization: Bearer #Api.key'`) never becomes the value in the line. The line names a variable instead, quoted
// for the place in the line it stands (unquoted, inside double quotes, inside single quotes, in a here-document), and the value travels as that variable's environment for this one command only.
// So a value is never typed into a shell, never kept in its history or scrollback, and can never run as shell code whatever characters it holds.

/** One spot in the line where a handle stands, and the variable that carries its value. */
export interface HandleRef { at: number; length: number; name: string }

export class QuotedHereDoc extends Error {
  readonly handle: string;
  constructor(handle: string) {
    super(`${handle} is inside a here-document whose end word is quoted, where the shell expands nothing. Use an unquoted end word, or pass it with env.`);
    this.handle = handle;
  }
}

type Frame = { kind: "plain" | "sub" | "tick"; parens: number; outer: "none" | "dq" };
type Here = { word: string; quoted: boolean; tabs: boolean };

/**
 * `command` with every spot in `refs` replaced by a reference to its variable that the shell reads as exactly the value: `"${N}"` where the text is unquoted, `${N}` inside double quotes or an
 * unquoted here-document, and closed and reopened around `"${N}"` inside single quotes. A spot inside a quoted here-document cannot be expanded at all and is refused (QuotedHereDoc).
 */
export function referHandles(command: string, refs: readonly HandleRef[]): string {
  if (refs.length === 0) return command;
  const byAt = new Map(refs.map((r) => [r.at, r] as const));
  let out = "";
  let i = 0;
  // the quoting the next character is in
  let q: "none" | "sq" | "dq" | "ansi" = "none";
  const stack: Frame[] = [{ kind: "plain", parens: 0, outer: "none" }];
  const pending: Here[] = [];
  const top = (): Frame => stack[stack.length - 1] as Frame;

  const take = (ref: HandleRef, mode: "none" | "sq" | "dq" | "ansi" | "here"): void => {
    const v = `\${${ref.name}}`;
    out += mode === "none" ? `"${v}"` : mode === "dq" || mode === "here" ? v : mode === "sq" ? `'"${v}"'` : `'"${v}"$'`;
    i += ref.length;
    taken++;
  };
  let taken = 0;

  /** The word after << (or <<-): its text without quotes, and whether any part of it was quoted. */
  const hereWord = (from: number): { here: Here; end: number } => {
    let j = from;
    let tabs = false;
    if (command[j] === "-") { tabs = true; j++; }
    while (command[j] === " " || command[j] === "\t") j++;
    let word = "";
    let quoted = false;
    while (j < command.length && !/[\s;|&<>()]/.test(command[j] as string)) {
      const c = command[j] as string;
      if (c === "'" || c === '"') { quoted = true; const close = command.indexOf(c, j + 1); const stop = close < 0 ? command.length : close; word += command.slice(j + 1, stop); j = stop + 1; continue; }
      if (c === "\\") { quoted = true; word += command[j + 1] ?? ""; j += 2; continue; }
      word += c; j++;
    }
    return { here: { word, quoted, tabs }, end: j };
  };

  /** The bodies of the here-documents opened on the line that just ended: up to each end word's own line. */
  const bodies = (): void => {
    while (pending.length > 0) {
      const h = pending.shift() as Here;
      for (;;) {
        if (i >= command.length) return;
        const nl = command.indexOf("\n", i);
        const lineEnd = nl < 0 ? command.length : nl;
        const line = command.slice(i, lineEnd);
        if ((h.tabs ? line.replace(/^\t+/, "") : line) === h.word) { out += line; i = lineEnd; if (nl >= 0) { out += "\n"; i++; } break; }
        while (i < lineEnd) {
          const ref = byAt.get(i);
          if (ref) { if (h.quoted) throw new QuotedHereDoc(command.slice(ref.at, ref.at + ref.length)); take(ref, "here"); continue; }
          out += command[i]; i++;
        }
        if (nl >= 0) { out += "\n"; i++; }
      }
    }
  };

  while (i < command.length) {
    const ref = byAt.get(i);
    if (ref) { take(ref, q); continue; }
    const c = command[i] as string;
    // a backslash before a handle (\#Api.key) would escape the quote that is put there: the handle means its value, so the backslash goes
    if (c === "\\" && q !== "sq" && byAt.has(i + 1)) { i++; continue; }
    if (q === "sq") { out += c; i++; if (c === "'") q = "none"; continue; }
    if (q === "ansi") {
      if (c === "\\") { out += command.slice(i, i + 2); i += 2; continue; }
      out += c; i++; if (c === "'") q = "none"; continue;
    }
    if (q === "dq") {
      if (c === "\\") { out += command.slice(i, i + 2); i += 2; continue; }
      if (c === '"') { out += c; i++; q = "none"; continue; }
      if (c === "$" && command[i + 1] === "(" && command[i + 2] !== "(") { out += "$("; i += 2; stack.push({ kind: "sub", parens: 0, outer: "dq" }); q = "none"; continue; }
      if (c === "`") { out += c; i++; stack.push({ kind: "tick", parens: 0, outer: "dq" }); q = "none"; continue; }
      out += c; i++; continue;
    }
    // unquoted
    if (c === "\\") { out += command.slice(i, i + 2); i += 2; continue; }
    if (c === "'") { out += c; i++; q = "sq"; continue; }
    if (c === "$" && command[i + 1] === "'") { out += "$'"; i += 2; q = "ansi"; continue; }
    if (c === '"') { out += c; i++; q = "dq"; continue; }
    if (c === "$" && command[i + 1] === "(" && command[i + 2] !== "(") { out += "$("; i += 2; stack.push({ kind: "sub", parens: 0, outer: "none" }); continue; }
    if (c === "`") {
      out += c; i++;
      if (top().kind === "tick") q = (stack.pop() as Frame).outer; else stack.push({ kind: "tick", parens: 0, outer: "none" });
      continue;
    }
    if (c === "(") { top().parens++; out += c; i++; continue; }
    if (c === ")") {
      const f = top();
      if (f.parens > 0) f.parens--;
      else if (f.kind === "sub" && stack.length > 1) { stack.pop(); q = f.outer; }
      out += c; i++; continue;
    }
    if (c === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      const { here, end } = hereWord(i + 2);
      out += command.slice(i, end); i = end;
      if (here.word !== "") pending.push(here);
      continue;
    }
    if (c === "\n") { out += c; i++; bodies(); continue; }
    out += c; i++;
  }
  // every handle must have become a reference: one left as written would be handed to the shell as its value
  if (taken !== refs.length) throw new Error("A Vault handle in that command could not be placed safely. Pass it with env instead.");
  return out;
}
