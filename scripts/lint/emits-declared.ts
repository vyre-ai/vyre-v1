// emits-declared: a handler may emit only the events its capability's manifest declares in `emits` (generated/registry.json). An undeclared name is refused at runtime with a 500, and only once the
// module is live, so this reads the handler sources instead.
//   node scripts/lint/emits-declared.ts [--enforce]      report mode (default) prints every finding and exits 0
// How a handler is found: a property whose key is a registered capability name of the module ("files.create": ..., in any non-test source under modules/<m>/). The value is an inline function,
// or the name of a function in the same file. Its emits are the literal names passed to ctx.emit( or emit( in that function and in the same-file functions it calls (three levels deep).
// A name built at run time is not a literal and is not judged. A helper shared by several handlers counts for each of them, so a finding on a shared helper may belong to a sibling; read the line.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matchDelim } from "./finding.ts";

export type EmitFinding = { cap: string; event: string; file: string; line: number; message: string };
type Cap = { name: string; module: string; emits?: string[] };

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

/**
 * Where a function's body block opens, searching from `from` (just after the name, or at the start of an inline value). The parameter list is skipped as a unit, so a `{` in a parameter
 * type or a destructured parameter is not taken for the body; after it, the body is the first `{` that follows `)`, `>` (an arrow or a generic return type) or a type name. -1 when
 * the value is an expression with no block, or is not a function.
 */
function bodyOpen(source: string, from: number): number {
  let i = from;
  const limit = Math.min(source.length, from + 600);
  while (i < limit && source[i] !== "(" && source[i] !== "{" && source[i] !== "=" && source[i] !== ";" && source[i] !== ",") i++;
  if (source[i] === "(") { i = matchDelim(source, i, "(", ")"); }
  else if (source[i] === "=" && source[i + 1] !== ">") { i++; while (i < limit && /\s/.test(source[i]!)) i++; if (source[i] === "(") i = matchDelim(source, i, "(", ")"); }
  for (; i < limit; i++) {
    const c = source[i];
    if (c === ";" || c === ",") return -1;
    if (c === "{") {
      let k = i - 1;
      while (k >= from && /\s/.test(source[k]!)) k--;
      const prev = source[k] ?? "";
      if (prev === ":" || prev === "<" || prev === "|" || prev === "&" || prev === ",") continue;   // an object type in a return annotation
      return i;
    }
  }
  return -1;
}

/** Text of the function body that starts at `from` (an inline arrow or function expression). */
function inlineBody(source: string, from: number): { text: string; start: number } | null {
  const open = bodyOpen(source, from);
  if (open < 0) return null;
  return { text: source.slice(open, matchDelim(source, open, "{", "}")), start: open };
}

type Fn = { file: string; source: string; text: string; start: number };
/** Resolves a function name to its body: the file being read first, then any file of the same module. */
export type Resolver = (id: string, file: string) => Fn | null;

/** The function named `id` in `source`: its body text and where it starts. */
function functionIn(file: string, source: string, id: string): Fn | null {
  const m = new RegExp(`(?:\\bfunction\\s+${id}\\b|\\b(?:const|let)\\s+${id}\\s*(?::[^=]*)?=)`).exec(source);
  if (!m) return null;
  const open = bodyOpen(source, m.index + m[0].length);
  if (open < 0) return null;
  return { file, source, text: source.slice(open, matchDelim(source, open, "{", "}")), start: open };
}

const EMIT = /\b(?:ctx\.)?emit\(\s*(["'`])([\w.-]+)\1/g;
const SKIP = new Set(["if", "for", "while", "switch", "catch", "return", "function", "emit", "await", "async", "require", "import"]);

/** Literal event names emitted in `fn` and in the functions it calls (three levels), with where each is emitted. */
function emitsOf(fn: Fn, resolve: Resolver, depth = 3, seen = new Set<string>()): { event: string; file: string; line: number }[] {
  const out: { event: string; file: string; line: number }[] = [];
  for (const m of fn.text.matchAll(EMIT)) out.push({ event: m[2]!, file: fn.file, line: lineOf(fn.source, fn.start + m.index!) });
  if (depth === 0) return out;
  for (const call of fn.text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const id = call[1]!;
    if (seen.has(id) || SKIP.has(id)) continue;
    seen.add(id);
    const next = resolve(id, fn.file);
    if (next) out.push(...emitsOf(next, resolve, depth - 1, seen));
  }
  return out;
}

export let HANDLERS_READ = 0;   // handlers whose body was found, printed so a lint that reads nothing cannot pass silently

export function checkEmitsDeclared(file: string, source: string, caps: ReadonlyMap<string, Cap>, moduleId: string, resolve?: Resolver): EmitFinding[] {
  const res: Resolver = resolve ?? ((id, f) => (f === file ? functionIn(file, source, id) : null));
  const out: EmitFinding[] = [];
  for (const key of source.matchAll(/(["'`])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\1\s*:\s*/g)) {
    const cap = caps.get(key[2]!);
    if (!cap || cap.module !== moduleId) continue;
    const valueAt = key.index! + key[0].length;
    const rest = source.slice(valueAt, valueAt + 200);
    let body: Fn | null = null;
    const ident = /^([A-Za-z_$][\w$]*)\s*[,}]/.exec(rest);
    if (ident) body = res(ident[1]!, file);
    else if (/^(?:async\b|\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(rest)) { const b = inlineBody(source, valueAt); body = b ? { file, source, text: b.text, start: b.start } : null; }
    if (!body) continue;
    HANDLERS_READ++;
    const declared = new Set(cap.emits ?? []);
    const seen = new Set<string>();
    for (const e of emitsOf(body, res)) {
      if (declared.has(e.event) || seen.has(e.event)) continue;
      seen.add(e.event);
      out.push({ cap: cap.name, event: e.event, file: e.file, line: e.line, message: `${cap.name} emits "${e.event}" but its manifest declares ${declared.size ? `only: ${[...declared].join(", ")}` : "no events"}` });
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
  const reg = JSON.parse(fs.readFileSync(path.join(repo, "generated/registry.json"), "utf8")) as { capabilities: Cap[] };
  const caps = new Map(reg.capabilities.map((c) => [c.name, c]));
  const files = spawnSync("git", ["ls-files", "modules"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter((f) => /^modules\/[^/]+\/.*\.ts$/.test(f) && !/\.test\.ts$|\/tests\/|\/fixtures\//.test(f));
  const sources = new Map(files.map((f) => [f, fs.readFileSync(path.join(repo, f), "utf8")]));
  // A name resolves to a function in the same file, or in the file it is imported from (relative imports only): no module-wide guessing, so two unrelated functions called `list` are never confused.
  const importsOf = new Map<string, Map<string, { file: string; name: string }>>();
  const imports = (from: string): Map<string, { file: string; name: string }> => {
    const hit = importsOf.get(from);
    if (hit) return hit;
    const out = new Map<string, { file: string; name: string }>();
    for (const m of (sources.get(from) ?? "").matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), m[2]!));
      const file = [target, `${target}.ts`, `${target}/index.ts`].find((c) => sources.has(c));
      if (!file) continue;
      for (const part of m[1]!.split(",")) {
        const [orig, local] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
        if (orig) out.set((local ?? orig).trim(), { file, name: orig.trim() });
      }
    }
    importsOf.set(from, out);
    return out;
  };
  const resolve: Resolver = (id, from) => {
    const own = functionIn(from, sources.get(from) ?? "", id);
    if (own) return own;
    const imp = imports(from).get(id);
    return imp ? functionIn(imp.file, sources.get(imp.file)!, imp.name) : null;
  };
  const all: EmitFinding[] = [];
  for (const f of files) all.push(...checkEmitsDeclared(f, sources.get(f)!, caps, f.split("/")[1]!, resolve));
  for (const h of all) console.log(`emits-declared ${h.file}:${h.line}: ${h.message}`);
  const enforce = process.argv.includes("--enforce");
  console.log(`emits-declared: ${all.length} undeclared emit(s) in ${HANDLERS_READ} handlers read of ${caps.size} capabilities${enforce ? "" : " (report mode, exit 0)"}`);
  if (enforce && all.length) process.exit(1);
}
