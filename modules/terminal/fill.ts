// A Vault handle written inside a command line (`mysql -p#DB.password`, `curl -H 'Authorization: Bearer #Api.key'`) never becomes the value in the line. The line names a variable instead, quoted
// for the place in the line it stands (unquoted, inside double quotes, inside single quotes, in a here-document), and the value travels as that variable's environment for this one command only.
// So a value is never typed into a shell, never kept in its history or scrollback, and can never run as shell code whatever characters it holds.
//
// The reader below knows the quoting a shell uses: '...', "...", $'...', backslashes, $(...), backticks, here-documents (quoted or not), here-strings and # comments. Where it cannot be sure how the
// shell reads a spot (inside $(( )), (( )), $[ ], ${ } or a case ... esac) a handle there is refused with a line that says how to write it, so a value can never end up unquoted (review 12 Nov, 10).

/** One spot in the line where a handle stands, and the variable that carries its value. */
export interface HandleRef { at: number; length: number; name: string }
export interface Spot { at: number; length: number }

/** How the shell reads a spot: unquoted, in double, single or ANSI quotes, in a here-document body (quoted or not), in a comment, or in a place this reader cannot be sure of. */
export type Mode = "none" | "dq" | "sq" | "ansi" | "here" | "qhere" | "comment" | "unsure";

export class QuotedHereDoc extends Error {
  readonly handle: string;
  constructor(handle: string) {
    super(`${handle} is inside a here-document whose end word is quoted, where the shell expands nothing. Use an unquoted end word, or pass it with env.`);
    this.handle = handle;
  }
}
export class UnsurePlace extends Error {
  readonly handle: string;
  constructor(handle: string) {
    super(`${handle} stands where Vyre cannot tell how the shell will read it (inside $(( )), (( )), \${ } or a case). Pass it with env instead, for example env {"PW": "${handle}"}, and write "$PW" in the command.`);
    this.handle = handle;
  }
}

type Frame = { kind: "plain" | "sub" | "tick"; parens: number; outer: "none" | "dq" };
type Here = { word: string; quoted: boolean; tabs: boolean };

/** Characters after which a word starts (so a # there begins a comment). */
const WORD_BREAK = /[\s;&|()<>]/;

/**
 * Read `command` as a shell does and call `decide` for every spot with how it is read there. `decide` returns the text to put in its place, or null to leave it as written (then it is read like any
 * other text: a #word at the start of a word begins a comment). Returns the command with the replacements.
 */
function walk(command: string, spots: readonly Spot[], decide: (s: Spot, mode: Mode) => string | null): string {
  const byAt = new Map(spots.map((s) => [s.at, s] as const));
  let out = "";
  let i = 0;
  let q: "none" | "sq" | "dq" | "ansi" = "none";
  const stack: Frame[] = [{ kind: "plain", parens: 0, outer: "none" }];
  const pending: Here[] = [];
  const top = (): Frame => stack[stack.length - 1] as Frame;
  const wordStart = (at: number): boolean => at === 0 || WORD_BREAK.test(command[at - 1] as string);

  /** Copy from i to `end` as it is, telling `decide` that every spot in it is in `mode` (its answer is not used: nothing in such a region is replaced). */
  const copyRegion = (end: number, mode: Mode): void => {
    while (i < end) { const s = byAt.get(i); if (s) { decide(s, mode); out += command.slice(i, i + s.length); i += s.length; continue; } out += command[i]; i++; }
  };
  /** Where a region of nested pairs ends (`open` and `close` counted from a depth of `depth`), or the end of the command. */
  const closeOf = (from: number, open: string, close: string, depth: number): number => {
    let d = depth;
    for (let j = from; j < command.length; j++) { if (command[j] === open) d++; else if (command[j] === close) { d--; if (d === 0) return j + 1; } }
    return command.length;
  };
  /** A spot at i: replaced when `decide` says so. */
  const at = (mode: Mode): boolean => {
    const s = byAt.get(i);
    if (!s) return false;
    const put = decide(s, mode);
    if (put === null) return false;
    out += put; i += s.length;
    return true;
  };

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

  const bodies = (): void => {
    while (pending.length > 0) {
      const h = pending.shift() as Here;
      for (;;) {
        if (i >= command.length) return;
        const nl = command.indexOf("\n", i);
        const lineEnd = nl < 0 ? command.length : nl;
        const line = command.slice(i, lineEnd);
        if ((h.tabs ? line.replace(/^\t+/, "") : line) === h.word) { out += line; i = lineEnd; if (nl >= 0) { out += "\n"; i++; } break; }
        while (i < lineEnd) { if (at(h.quoted ? "qhere" : "here")) continue; out += command[i]; i++; }
        if (nl >= 0) { out += "\n"; i++; }
      }
    }
  };

  /** A construct this reader does not follow inside: $(( )), $[ ], ${ }. Returns true when one starts at i (and was copied whole). */
  const unsure = (): boolean => {
    const c = command[i];
    if (c === "$" && command[i + 1] === "(" && command[i + 2] === "(") { copyRegion(closeOf(i + 1, "(", ")", 0), "unsure"); return true; }
    if (c === "$" && command[i + 1] === "[") { copyRegion(closeOf(i + 1, "[", "]", 0), "unsure"); return true; }
    if (c === "$" && command[i + 1] === "{") { copyRegion(closeOf(i + 1, "{", "}", 0), "unsure"); return true; }
    return false;
  };

  while (i < command.length) {
    const c = command[i] as string;
    // a backslash before a handle (\#Api.key) would escape the quote that is put there: when the handle is replaced, the backslash goes
    if (c === "\\" && q !== "sq" && byAt.has(i + 1)) {
      const s = byAt.get(i + 1) as Spot;
      const put = decide(s, q === "ansi" ? "ansi" : q === "dq" ? "dq" : "none");
      if (put !== null) { out += put; i += 1 + s.length; continue; }
      out += command.slice(i, i + 2); i += 2; continue;
    }
    if (q === "sq") { if (at("sq")) continue; out += c; i++; if (c === "'") q = "none"; continue; }
    if (q === "ansi") {
      if (at("ansi")) continue;
      if (c === "\\") { out += command.slice(i, i + 2); i += 2; continue; }
      out += c; i++; if (c === "'") q = "none"; continue;
    }
    if (q === "dq") {
      if (at("dq")) continue;
      if (c === "\\") { out += command.slice(i, i + 2); i += 2; continue; }
      if (c === '"') { out += c; i++; q = "none"; continue; }
      if (unsure()) continue;
      if (c === "$" && command[i + 1] === "(") { out += "$("; i += 2; stack.push({ kind: "sub", parens: 0, outer: "dq" }); q = "none"; continue; }
      if (c === "`") { out += c; i++; stack.push({ kind: "tick", parens: 0, outer: "dq" }); q = "none"; continue; }
      out += c; i++; continue;
    }
    // unquoted
    if (at("none")) continue;
    if (c === "\\") { out += command.slice(i, i + 2); i += 2; continue; }
    // a comment, to the end of its line: nothing in it is a handle
    if (c === "#" && wordStart(i)) { const nl = command.indexOf("\n", i); copyRegion(nl < 0 ? command.length : nl, "comment"); continue; }
    if (c === "'") { out += c; i++; q = "sq"; continue; }
    if (c === "$" && command[i + 1] === "'") { out += "$'"; i += 2; q = "ansi"; continue; }
    if (c === '"') { out += c; i++; q = "dq"; continue; }
    if (unsure()) continue;
    // (( arithmetic )) at the start of a word, and a case ... esac (its patterns end in a bare ")"): not followed inside
    if (c === "(" && command[i + 1] === "(" && wordStart(i)) { copyRegion(closeOf(i, "(", ")", 0), "unsure"); continue; }
    if (wordStart(i) && /^case(?=[\s;]|$)/.test(command.slice(i, i + 5))) {
      const m = /(^|[\s;&|()])esac(?=[\s;&|()]|$)/.exec(command.slice(i + 4));
      copyRegion(m ? i + 4 + m.index + m[0].length : command.length, "unsure");
      continue;
    }
    if (c === "$" && command[i + 1] === "(") { out += "$("; i += 2; stack.push({ kind: "sub", parens: 0, outer: "none" }); continue; }
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
    // a here-string (<<<) is a plain word; a here-document (<< or <<-) has a body on the lines that follow
    if (c === "<" && command[i + 1] === "<" && command[i + 2] === "<") { out += "<<<"; i += 3; continue; }
    if (c === "<" && command[i + 1] === "<") {
      const { here, end } = hereWord(i + 2);
      out += command.slice(i, end); i = end;
      if (here.word !== "") pending.push(here);
      continue;
    }
    if (c === "\n") { out += c; i++; bodies(); continue; }
    out += c; i++;
  }
  return out;
}

/**
 * How the shell reads each spot. `isHandle(at)`: whether the spot is a Vault handle (true) or text the Vault does not know (false): text at the start of a word is a comment for the shell, and then so
 * is the rest of its line. A spot not yet asked about counts as a handle; asking in order, from the first spot not in a comment, and reading again after each answer, gives every spot its true place.
 */
export function classify(command: string, spots: readonly Spot[], isHandle: (at: number) => boolean): Map<number, Mode> {
  const modes = new Map<number, Mode>();
  walk(command, spots, (s, mode) => { modes.set(s.at, mode); return isHandle(s.at) && mode !== "comment" ? command.slice(s.at, s.at + s.length) : null; });
  return modes;
}

/**
 * `command` with every spot in `refs` replaced by a reference to its variable that the shell reads as exactly the value: `"${N}"` where the text is unquoted, `${N}` inside double quotes or an
 * unquoted here-document, and closed and reopened around `"${N}"` inside single quotes. A spot in a quoted here-document, or in a place this reader cannot be sure of, is refused with a line that
 * says how to write it: a value is never left unquoted.
 */
export function referHandles(command: string, refs: readonly HandleRef[]): string {
  if (refs.length === 0) return command;
  const byAt = new Map(refs.map((r) => [r.at, r] as const));
  let taken = 0;
  const out = walk(command, refs, (s, mode) => {
    const ref = byAt.get(s.at) as HandleRef;
    const handle = command.slice(s.at, s.at + s.length);
    if (mode === "comment") return null;
    if (mode === "qhere") throw new QuotedHereDoc(handle);
    if (mode === "unsure") throw new UnsurePlace(handle);
    taken++;
    const v = `\${${ref.name}}`;
    return mode === "none" ? `"${v}"` : mode === "dq" || mode === "here" ? v : mode === "sq" ? `'"${v}"'` : `'"${v}"$'`;
  });
  // every handle must have become a reference: one left as written would be handed to the shell as its value
  if (taken !== refs.length) throw new Error("A Vault handle in that command could not be placed safely. Pass it with env instead.");
  return out;
}
