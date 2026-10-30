// no-silent-calls: a fire-and-forget capability call with no error handler makes a button that does nothing when the Space refuses it (the owner: "I dont want any dead buttons").
//   node scripts/lint/no-silent-calls.ts [--enforce] [--update-known]
// Flagged, in apps/app and ui (tests excluded): `void <x>.call(...)` or a statement-start `<x>.call(...)` whose chain has no `.catch(...)` and no `.then(ok, fail)` with a second argument. An awaited call, or one
// returned, assigned or passed on, is the caller's to handle and is not read. The refusal must reach the person: catch it and show it (toast or inline error), not swallow it.
// The calls that predate this lint are in scripts/lint/no-silent-calls-known.json as "<file>#<capability>#<n>"; the list may only shrink. A new entry fails with --enforce.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scrub } from "./raise-after-write.ts";
import { lineCol, matchDelim } from "./finding.ts";

export type SilentCall = { file: string; line: number; key: string; message: string };

const RECEIVER = /(?:^|[^\w$.])((?:[A-Za-z_$][\w$]*(?:\?)?\.)*[A-Za-z_$][\w$]*)(\?)?\.call\(/g;
const CALLERS = /^(?:data|rt|api|caller|runtime|space|session|client|gw|gateway|ctx|replica|cap|call|d|h)$/;

function splitArgs(code: string, open: number, close: number): number {
  let depth = 0, n = 1, any = false;
  for (let i = open + 1; i < close - 1; i++) {
    const c = code[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) n++;
    if (!/\s/.test(c)) any = true;
  }
  return any ? n : 0;
}

export function checkNoSilentCalls(file: string, source: string): SilentCall[] {
  const code = scrub(source);
  const out: SilentCall[] = [];
  const seen = new Map<string, number>();
  RECEIVER.lastIndex = 0;
  for (let m = RECEIVER.exec(code); m; m = RECEIVER.exec(code)) {
    const recv = m[1]!;
    const start = m.index + m[0].length - "call(".length - 1 - (m[2] ? 1 : 0) - recv.length;
    const open = m.index + m[0].length - 1;
    const last = recv.split(".").pop()!;
    const firstArg = source.slice(open + 1, open + 40).trimStart();
    const capLike = /^["'`][a-z][\w.]*["'`]/.test(firstArg) || /^["'`]\$\{/.test(firstArg);
    if (!CALLERS.test(last) && !capLike) continue;
    if (/^(?:this|null|undefined)\b/.test(firstArg)) continue;
    const before = code.slice(Math.max(0, start - 12), start);
    const voided = /\bvoid\s*$/.test(before);
    const stmt = /(?:^|[;{}])\s*$/.test(code.slice(Math.max(0, start - 40), start)) && !/\b(?:await|return|yield|throw)\s*$/.test(before);
    if (!voided && !stmt) continue;
    let end = matchDelim(code, open, "(", ")");
    let handled = false, chained = false;
    for (;;) {
      const rest = code.slice(end);
      const c = /^\s*\??\.(\w+)\s*\(/.exec(rest);
      if (!c) break;
      chained = true;
      const o = end + c[0].length - 1;
      const e = matchDelim(code, o, "(", ")");
      if (c[1] === "catch" || (c[1] === "then" && splitArgs(code, o, e) >= 2)) handled = true;
      end = e;
    }
    if (handled) continue;
    if (!voided && !chained) continue;   // a bare statement call without a chain may be an awaited-elsewhere or sync call; only fire-and-forget (`void`) and chained promises are judged
    const cap = /^["'`]([^"'`$]+)/.exec(firstArg)?.[1] ?? /^[\w.$?]+/.exec(firstArg)?.[0] ?? "call";
    const base = `${file}#${cap}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ file, line: lineCol(source, start).line, key: `${base}#${n}`, message: `${recv}.call(${cap}) is fire-and-forget with no .catch or error handler: a refusal does nothing the person can see` });
  }
  return out;
}

const inScope = (f: string): boolean => /^(?:apps\/app\/src|ui\/src)\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$|\/tests?\/|\/fixtures\/|\.stories\./.test(f);

function main(): void {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const knownPath = path.join(repo, "scripts/lint/no-silent-calls-known.json");
  const files = spawnSync("git", ["ls-files", "apps/app/src", "ui/src"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(inScope);
  const all: SilentCall[] = [];
  for (const f of files) all.push(...checkNoSilentCalls(f, fs.readFileSync(path.join(repo, f), "utf8")));
  if (process.argv.includes("--update-known")) {
    fs.writeFileSync(knownPath, `${JSON.stringify({ note: "Fire-and-forget calls with no error handler that predate scripts/lint/no-silent-calls.ts. Burn this list down; a new entry fails the lint.", known: all.map((a) => a.key).sort() }, null, 1)}\n`);
    console.log(`no-silent-calls: wrote ${all.length} known entries`);
    return;
  }
  const known = new Set<string>(fs.existsSync(knownPath) ? (JSON.parse(fs.readFileSync(knownPath, "utf8")) as { known: string[] }).known : []);
  const fresh = all.filter((a) => !known.has(a.key));
  const live = new Set(all.map((a) => a.key));
  const gone = [...known].filter((k) => !live.has(k));
  for (const f of fresh) console.log(`no-silent-calls ${f.file}:${f.line}: ${f.message}`);
  const enforce = process.argv.includes("--enforce");
  console.log(`no-silent-calls: ${fresh.length} new, ${all.length - fresh.length} known (${gone.length} fixed since the list was written; shrink it with --update-known) in ${files.length} files${enforce ? "" : " (report mode, exit 0)"}`);
  if (enforce && fresh.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && !process.argv.includes("--test")) main();
