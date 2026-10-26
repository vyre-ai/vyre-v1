// idem-calls: a handler that calls a capability declaring idempotency "key" through ctx.call must put idempotencyKey in the literal input object.
// Without it the call works in a stub and fails only once the callee's module goes live.
//   node scripts/lint/idem-calls.ts [--all | --base <ref> | --files a b] [--enforce]
// Report mode (default): findings are printed and the exit code is 0. --enforce makes a finding exit 1. A call whose input is a variable, or a literal with a spread, cannot be seen:
// it is a warning and never fails.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matchDelim } from "./finding.ts";
import { skipped } from "./paths.ts";

export type IdemFinding = { kind: "missing" | "unseen"; file: string; line: number; cap: string; message: string };

const lineOf = (source: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
};

/** The capability names whose manifest declares idempotency "key", from generated/registry.json. */
export function keyedCaps(repo: string): Set<string> {
  const reg = JSON.parse(fs.readFileSync(path.join(repo, "generated/registry.json"), "utf8")) as { capabilities: { name: string; idempotency?: string }[] };
  return new Set(reg.capabilities.filter((c) => c.idempotency === "key").map((c) => c.name));
}

/** The top-level text of an object literal (nested braces, brackets and parentheses blanked out), so a key is only found at depth 1. */
function topLevel(obj: string): string {
  let depth = 0;
  let quote = "";
  let out = "";
  for (let i = 0; i < obj.length; i++) {
    const c = obj[i]!;
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") { quote = c; continue; }
    if (c === "{" || c === "[" || c === "(") { depth++; if (depth > 1) continue; }
    else if (c === "}" || c === "]" || c === ")") { depth--; if (depth >= 1) continue; }
    else if (depth > 1) continue;
    out += c;
  }
  return out;
}

export function checkIdemCalls(file: string, source: string, keyed: ReadonlySet<string>): IdemFinding[] {
  const out: IdemFinding[] = [];
  for (const hit of source.matchAll(/\bctx\.call\s*(?:<[^>(]*>)?\s*\(/g)) {
    const open = hit.index + hit[0].length - 1;
    let i = open + 1;
    while (/\s/.test(source[i] ?? "")) i++;
    const q = source[i];
    if (q !== "\"" && q !== "'" && q !== "`") continue;                 // the capability name is not a literal: nothing to look up
    const close = source.indexOf(q, i + 1);
    if (close < 0) continue;
    const cap = source.slice(i + 1, close);
    if (q === "`" && cap.includes("${")) continue;
    if (!keyed.has(cap)) continue;
    let j = close + 1;
    while (/\s/.test(source[j] ?? "")) j++;
    const line = lineOf(source, hit.index);
    if (source[j] !== ",") { out.push({ kind: "missing", file, line, cap, message: `ctx.call("${cap}") declares idempotency key but passes no input, so no idempotencyKey` }); continue; }
    j++;
    while (/\s/.test(source[j] ?? "")) j++;
    if (source[j] !== "{") { out.push({ kind: "unseen", file, line, cap, message: `ctx.call("${cap}") needs idempotencyKey; its input is not a literal object, so the lint cannot see it` }); continue; }
    const body = topLevel(source.slice(j, matchDelim(source, j, "{", "}")));
    if (/(?:^|[{,\s])idempotencyKey\s*[:,}]/.test(body)) continue;
    if (/\.\.\./.test(body)) { out.push({ kind: "unseen", file, line, cap, message: `ctx.call("${cap}") needs idempotencyKey; the input spreads another object, so the lint cannot see it` }); continue; }
    out.push({ kind: "missing", file, line, cap, message: `ctx.call("${cap}") declares idempotency key but its input has no idempotencyKey` });
  }
  return out;
}

function directRun(): boolean {
  const arg = process.argv[1];
  return !!arg && import.meta.url === pathToFileURL(path.resolve(arg)).href;
}

function main(): void {
  const args = process.argv.slice(2);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const enforce = args.includes("--enforce");
  let names: string[];
  if (args.includes("--files")) names = args.slice(args.indexOf("--files") + 1).filter((a) => !a.startsWith("--"));
  else if (args.includes("--base")) names = spawnSync("git", ["diff", "--name-only", "--no-renames", `${args[args.indexOf("--base") + 1]}...HEAD`], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  else names = spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const keyed = keyedCaps(repo);
  const all: IdemFinding[] = [];
  for (const f of names) {
    if (!/\.(?:ts|tsx|mjs|js)$/.test(f) || skipped(f) || !/^(?:modules|host|agent|lib|sync|kernel|kits|connectors)\//.test(f)) continue;
    const abs = path.join(repo, f);
    if (!fs.existsSync(abs)) continue;
    all.push(...checkIdemCalls(f, fs.readFileSync(abs, "utf8"), keyed));
  }
  for (const h of all) console.log(`${h.kind === "missing" ? "idem-calls" : "idem-calls WARN"} ${h.file}:${h.line}: ${h.message}`);
  const missing = all.filter((h) => h.kind === "missing");
  console.log(`idem-calls: ${missing.length} missing, ${all.length - missing.length} unseen (warning), ${keyed.size} capabilities declare idempotency key${enforce ? "" : " (report mode, exit 0)"}`);
  if (enforce && missing.length) process.exit(1);
}

if (directRun()) main();
