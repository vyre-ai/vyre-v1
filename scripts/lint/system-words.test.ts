// A person reads "the turn ended", "two wake-ups", "principal" and "capability" as a stranger's words (K14, 13 Nov 2026: the Stuck card said "two wake-ups: the turn ended without a check-in"). Strings the app
// shows must say it in plain words: "did not report back", "an agent", "a permission". This test counts those words inside string literals in apps/app/src and ui/src per file and holds the line:
//   - a file not in system-words.baseline.json must have none (a new one fails here);
//   - a file in it may only go down. When you reword one, lower its count (or remove the file): `UPDATE_SYSTEM_WORDS=1 node --test scripts/lint/system-words.test.ts`.
// Tests, samples, fixtures and generated files are out of scope. A word in a comment, an identifier or an import path is not a string a person reads and is not counted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = fileURLToPath(new URL("./system-words.baseline.json", import.meta.url));
const SCOPE = ["apps/app/src", "ui/src"];
const EXEMPT = /(\.test\.|\.support\.|\/tests?\/|\/sample|\/samples\/|\/fixtures\/|\/testing\/|\.d\.ts$|\/generated\/)/;
/** Wake-up, principal, capability, and "turn" as a noun (the turn, a turn, its turn, turns, turn limit). "Turn on" and "turn off" are verbs and stay. */
export const SYSTEM_WORDS = /\bwake-?ups?\b|\bwake up\b|\bprincipals?\b|\bcapabilit(?:y|ies)\b|\b(?:a|an|the|its|next|last|that|this|each|every|per|your|their|first|one)\s+turns?\b|\bturns\b|\bturn limit\b|\bthe doer\b/i;
const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules" && name !== "dist") walk(p, out); } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
/** JSX text between tags ("<Text>The turn ended</Text>") is a string a person reads too. */
const JSX_TEXT = />([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g;

export function countIn(source: string): number {
  const code = stripComments(source);
  let n = 0;
  for (const m of code.match(LITERAL) ?? []) if (/\s/.test(m) && !/^["'`]\.{0,2}\//.test(m) && SYSTEM_WORDS.test(m)) n++;
  for (const m of code.matchAll(JSX_TEXT)) if (SYSTEM_WORDS.test(m[1]!)) n++;
  return n;
}

export function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dir of SCOPE) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (EXEMPT.test(rel)) continue;
      const n = countIn(readFileSync(file, "utf8"));
      if (n > 0) out[rel] = n;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

test("no new system word in a string a person reads, and the old ones only go down", () => {
  const now = counts();
  if (process.env["UPDATE_SYSTEM_WORDS"] === "1") { writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`); return; }
  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>;
  const worse: string[] = [];
  for (const [file, n] of Object.entries(now)) {
    const allowed = base[file] ?? 0;
    if (n > allowed) worse.push(`${file}: ${n} string${n === 1 ? "" : "s"} with a system word (turn, wake-up, principal, capability), ${allowed} allowed. Say it in plain words a new person understands.`);
  }
  assert.deepEqual(worse, []);
  const stale = Object.keys(base).filter((f) => (now[f] ?? 0) < base[f]!);
  assert.deepEqual(stale, [], `these files were reworded: lower their count in system-words.baseline.json (UPDATE_SYSTEM_WORDS=1):\n${stale.join("\n")}`);
});

test("the check sees a system word in a string and in text, and ignores a comment, a path and a verb", () => {
  const sample = [
    'const a = "The lead did not check in after two wake-ups";',
    "const b = `the turn ended after ${n} minutes`;",
    "// the turn ended in a comment",
    'import x from "../turn limit/x.ts";',
    'const c = "Turn plan mode on or off";',
    "const d = <Text>The principal is missing</Text>;",
    'const e = "capability";',
  ].join("\n");
  assert.equal(countIn(sample), 3, "the two strings and the text; not the comment, the path, the verb or the one-word code");
});
