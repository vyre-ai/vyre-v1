// raise-after-write: a handler that writes module rows (ctx.db or tx .run) and then refuses leaves those rows behind with no event, because a handler runs in no transaction (ruling 90).
//   node scripts/lint/raise-after-write.ts [--enforce]      report mode (default) prints every finding and exits 0
// The fix is ordering: every raise, refuse or fail comes before the handler's first write. A write that must survive a refusal on purpose (a rate counter, a single-use claim, a failure row)
// is listed in scripts/lint/raise-after-write-known.json as "<file>#<function>": "<reason>".
// How it reads: functions are found by header (function f(, const f = (...) =>, "cap.name": async (...) =>); inside one, the first write is a .run( on db, ctx.db or tx. A later raise( refuse( fail(
// or throw fail( / throw new is a finding, unless the write sat in a block that ended in return or throw (another branch), or in a try whose catch comes first (the author handles the failure).
// A bare `throw e` is a rethrow and not judged. Not seen: writes made through helper functions, and refusals raised by a ctx.call.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export type RawFinding = { file: string; fn: string; writeLine: number; raiseLine: number; message: string };

/** The source as code only: comments, string and template contents and regex literals become spaces (newlines kept, so line numbers hold), so a brace or quote inside them never counts. */
export function scrub(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  const blank = (ch: string): string => (ch === "\n" ? "\n" : " ");
  while (i < n) {
    const c = source[i]!;
    const d = source[i + 1];
    if (c === "/" && d === "/") { while (i < n && source[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) out += blank(source[i]!);
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      out += c; i++;
      while (i < n && source[i] !== c) {
        if (source[i] === "\\") { out += " "; i++; if (i < n) { out += blank(source[i]!); i++; } continue; }
        out += blank(source[i]!); i++;
      }
      if (i < n) { out += c; i++; }
      continue;
    }
    if (c === "/") {
      const before = out.slice(-40).trimEnd();
      const last = before.slice(-1);
      if (last === "" || /[(,=:[!&|?{};]/.test(last) || /(?:^|[^\w$])return$/.test(before)) {
        out += c; i++;
        let inClass = false;
        while (i < n && source[i] !== "\n") {
          const r = source[i]!;
          if (r === "\\") { out += "  "; i += 2; continue; }
          if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) break;
          out += " "; i++;
        }
        if (i < n && source[i] === "/") { out += "/"; i++; }
        continue;
      }
    }
    out += c; i++;
  }
  return out;
}

const HEADERS: RegExp[] = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]/,
  /^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|\w+\s*=>)/,
  /^\s*["']?([\w.]+)["']?\s*:\s*(?:async\s*)?(?:\(|\w+\s*=>)/,
  /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/,
];
const NOT_NAMES = new Set(["if", "for", "while", "switch", "catch", "return", "function", "constructor"]);

const WRITE = /(?:^|[^\w$])(?:ctx\.db|db|tx|deps\.tx)\.run\(/;
const REFUSE = /(?:^|[^\w$.])(?:raise|refuse|fail)\(|\bthrow\s+(?:fail\(|new\s)/;

/** Index of the `{` that opens the body of the function whose header starts at `from`, or -1 (an expression body, or no block). */
function bodyOpen(code: string, from: number): number {
  let paren = 0;
  const limit = Math.min(code.length, from + 800);
  for (let i = from; i < limit; i++) {
    const c = code[i]!;
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (paren === 0 && (c === ";" || (c === "," && code[i + 1] === "\n"))) return -1;
    else if (paren === 0 && c === "{") {
      let k = i - 1;
      while (k >= from && /\s/.test(code[k]!)) k--;
      const p = code[k] ?? "";
      if (p === ")" || p === ">") return i;
    }
  }
  return -1;
}

function closeOf(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export function checkRaiseAfterWrite(file: string, rawSource: string): RawFinding[] {
  const code = scrub(rawSource);
  const rawLines = rawSource.split("\n");
  const codeLines = code.split("\n");
  const lineStarts: number[] = [];
  { let at = 0; for (const l of codeLines) { lineStarts.push(at); at += l.length + 1; } }
  const lineOf = (index: number): number => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid]! <= index) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const out: RawFinding[] = [];
  const seen = new Set<string>();
  for (let h = 0; h < rawLines.length; h++) {
    let name = "";
    for (const re of HEADERS) { const m = re.exec(rawLines[h]!); if (m && !NOT_NAMES.has(m[1]!)) { name = m[1]!; break; } }
    if (!name) continue;
    const open = bodyOpen(code, lineStarts[h]!);
    if (open < 0 || lineOf(open) - h > 12) continue;
    const close = closeOf(code, open);
    if (close < 0) continue;
    const first = lineOf(open);
    const last = lineOf(close);
    let depth = 0;
    let pending: { line: number; depth: number } | null = null;
    let lastCode = "";
    for (let l = first; l <= last; l++) {
      let text = codeLines[l]!;
      if (l === first) text = text.slice(open - lineStarts[first]!);
      const trimmed = text.trim();
      const startsClose = trimmed.startsWith("}");
      const lineDepth = depth;
      if (/\bcatch\b/.test(trimmed) && pending && pending.depth > lineDepth - (startsClose ? 1 : 0)) pending = null;
      if (pending && REFUSE.test(text) && !(WRITE.test(text) && l === pending.line)) {
        const key = `${pending.line}:${l}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ file, fn: name, writeLine: pending.line + 1, raiseLine: l + 1, message: `${name}() writes at line ${pending.line + 1} and then refuses at line ${l + 1}; a refused call keeps that write with no event` });
        }
        break;
      }
      if (!pending && WRITE.test(text) && !/CREATE\s|PRAGMA/i.test(rawLines.slice(l, l + 3).join(" "))) pending = { line: l, depth: lineDepth };
      for (const ch of text) { if (ch === "{") depth++; else if (ch === "}") depth--; }
      if (pending && depth < pending.depth) {
        if (/^(?:return\b|throw\b|raise\(|refuse\(|fail\()/.test(startsClose ? lastCode : trimmed)) pending = null;
        else pending = { line: pending.line, depth: depth };
      }
      if (trimmed !== "" && !startsClose) lastCode = trimmed;
    }
  }
  return out;
}

function directRun(): boolean {
  const arg = process.argv[1];
  return !!arg && import.meta.url === pathToFileURL(path.resolve(arg)).href;
}

if (directRun()) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const knownPath = path.join(repo, "scripts/lint/raise-after-write-known.json");
  const known = fs.existsSync(knownPath) ? (JSON.parse(fs.readFileSync(knownPath, "utf8")) as Record<string, string>) : {};
  const files = spawnSync("git", ["ls-files", "modules"], { cwd: repo, encoding: "utf8" }).stdout.split("\n")
    .filter((f) => /^modules\/[^/]+\/.*\.ts$/.test(f) && !/\.test\.ts$|\/tests?\/|\/fixtures\/|\/migrations\//.test(f));
  const all: RawFinding[] = [];
  for (const f of files) all.push(...checkRaiseAfterWrite(f, fs.readFileSync(path.join(repo, f), "utf8")).filter((x) => !(`${x.file}#${x.fn}` in known)));
  for (const h of all) console.log(`raise-after-write ${h.file}:${h.raiseLine}: ${h.message}`);
  const enforce = process.argv.includes("--enforce");
  console.log(`raise-after-write: ${all.length} refusal(s) after a write in ${files.length} files${enforce ? "" : " (report mode, exit 0)"}`);
  if (enforce && all.length) process.exit(1);
}
