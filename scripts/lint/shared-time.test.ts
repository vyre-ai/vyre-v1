// Shared places read times through ui/Time and lib/zones.ts, never by hand. A time formatted with getUTCHours, toLocaleTimeString, Intl.DateTimeFormat, getTimezoneOffset or a hand-added offset ("x + offsetMin * 60000")
// ignores the Space's time zone, so two members of one Space would read two different clocks. This test counts those spots per file in the shared places and holds the line:
//   - a file not in shared-time.baseline.json must have none (a new formatter fails here);
//   - a file in it may only go down. When you move a spot onto ui/Time, lower its count (or remove the file) in the baseline: `UPDATE_SHARED_TIME=1 node --import tsx --test scripts/lint/shared-time.test.ts`.
// Private places (settings, vault, the Console's server pages) and tests, samples and the zone files themselves are out of scope.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = fileURLToPath(new URL("./shared-time.baseline.json", import.meta.url));
// where people work together: chats, tasks, goals, records and projects, automations, home, the inbox, the shell's shared bars, and the shared UI pieces
const SCOPE = ["apps/app/src/places/chats", "apps/app/src/places/records", "apps/app/src/places/automations", "apps/app/src/places/inbox", "apps/app/src/places/files", "ui/src"];
const EXEMPT = /(\.test\.|\.support\.|\/sample|\/samples\/|\/fixtures\/|\/testing\/|^ui\/src\/Time\/|^ui\/src\/ZonePicker\/|^ui\/src\/tokens\/)/;
const RAW = /\bgetUTCHours\b|\btoLocale(?:Time|Date)String\b|\bIntl\.DateTimeFormat\b|\bgetTimezoneOffset\b|offsetMin\s*\*/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules" && name !== "dist") walk(p, out); } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

export function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dir of SCOPE) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (EXEMPT.test(rel)) continue;
      const n = (stripComments(readFileSync(file, "utf8")).match(RAW) ?? []).length;
      if (n > 0) out[rel] = n;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

test("no new hand-rolled time formatter in a shared place, and the old ones only go down", () => {
  const now = counts();
  if (process.env["UPDATE_SHARED_TIME"] === "1") { writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`); return; }
  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>;
  const worse: string[] = [];
  for (const [file, n] of Object.entries(now)) {
    const allowed = base[file] ?? 0;
    if (n > allowed) worse.push(`${file}: ${n} hand-rolled time format${n === 1 ? "" : "s"}, ${allowed} allowed. Use ui/Time (When, useWhenText, dueText) or lib/zones.ts so the Space's time zone applies.`);
  }
  assert.deepEqual(worse, []);
  const stale = Object.keys(base).filter((f) => (now[f] ?? 0) < base[f]!);
  assert.deepEqual(stale, [], `these files moved onto ui/Time: lower their count in shared-time.baseline.json (UPDATE_SHARED_TIME=1):\n${stale.join("\n")}`);
});

test("the check itself sees a hand-rolled formatter and ignores a comment", () => {
  const sample = `const a = d.getUTCHours();\n// d.getUTCHours() in a comment\nconst b = new Intl.DateTimeFormat("en-US");\nconst c = t + offsetMin * 60_000;\n/* toLocaleTimeString */`;
  assert.equal((stripComments(sample).match(RAW) ?? []).length, 3);
});
