// What a helper's last test run said (owner, 4 Nov 2026): taken from its own tool steps, not guessed. A command step that runs a test suite is "running" until its result arrives, then "passing" when it
// succeeded and "failing" when it did not. Counts ride along only when the step's own words carry them ("12 passed", "3 failing"); otherwise only the state is known and the counts are left out.
import type { Db } from "./projections.ts";

type Row = Record<string, unknown>;
export interface HelperTests { state: "running" | "passing" | "failing"; passed?: number; failed?: number; /** The first test that failed, by name. */ failing?: string }
interface Step { phase?: string; id?: string; name?: string; ok?: boolean; detail?: string }

const RUNNER = /\b(?:node\s+--test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|vitest|jest|pytest|cargo\s+test|go\s+test|mocha|rspec|phpunit|dotnet\s+test|mvn\s+test|gradle\s+test)\b/i;
const SHELL = /^(?:bash|shell|terminal_run|exec|run_command|command_execution|command)$/i;
const test = new Map<string, Set<string>>();   // thread -> step ids that are test runs

export function ensureTests(db: Db): void {
  db.run("CREATE TABLE IF NOT EXISTS engine_helper_tests (thread_id TEXT PRIMARY KEY, state TEXT NOT NULL, passed INTEGER, failed INTEGER, at INTEGER NOT NULL)");
  try { db.run("ALTER TABLE engine_helper_tests ADD COLUMN failing TEXT"); } catch { /* the column is there already */ }
}

const count = (text: string, re: RegExp): number | undefined => { const m = re.exec(text); return m ? Number(m[1]) : undefined; };

/** Read a turn's tool steps for a test run and keep the latest state. */
export function noteSteps(db: Db, threadId: string, steps: readonly unknown[], now: number): void {
  const mine = test.get(threadId) ?? new Set<string>();
  const names = new Map<string, string>();
  for (const raw of steps) {
    const s = raw as Step;
    const id = typeof s.id === "string" ? s.id : "";
    if (id === "") continue;
    if (s.phase === "call" && typeof s.name === "string") names.set(id, s.name);
    const detail = typeof s.detail === "string" ? s.detail : "";
    if (s.phase === "input" && RUNNER.test(detail) && (names.get(id) === undefined || SHELL.test(names.get(id)!) || /bash|terminal|shell/i.test(names.get(id)!))) {
      mine.add(id); test.set(threadId, mine);
      ensureTests(db);
      db.run("INSERT INTO engine_helper_tests (thread_id, state, passed, failed, at) VALUES (?, 'running', NULL, NULL, ?) ON CONFLICT(thread_id) DO UPDATE SET state = 'running', passed = NULL, failed = NULL, failing = NULL, at = excluded.at", threadId, now);
    }
    if (s.phase === "result" && mine.has(id)) {
      ensureTests(db);
      const passed = count(detail, /(\d+)\s+(?:passed|passing)\b/i) ?? count(detail, /ℹ\s+pass\s+(\d+)/i), failed = count(detail, /(\d+)\s+(?:failed|failing|failures?)\b/i) ?? count(detail, /ℹ\s+fail\s+(\d+)/i);
      const name = /^(?:✖|not ok \d+ -|FAIL)\s+(?!failing tests)(.+?)(?:\s+\([\d.]+ms\))?$/im.exec(detail)?.[1]?.trim();
      const bad = s.ok === false || (failed !== undefined && failed > 0);
      db.run("UPDATE engine_helper_tests SET state = ?, passed = ?, failed = ?, failing = ?, at = ? WHERE thread_id = ?", bad ? "failing" : "passing", passed ?? null, failed ?? null, bad ? name ?? null : null, now, threadId);
      mine.delete(id);
    }
  }
}

export function testsOf(db: Db, threadId: string): HelperTests | undefined {
  ensureTests(db);
  const r = db.all("SELECT state, passed, failed, failing FROM engine_helper_tests WHERE thread_id = ?", threadId)[0] as Row | undefined;
  if (!r) return undefined;
  return { state: r["state"] as HelperTests["state"], ...(typeof r["passed"] === "number" ? { passed: r["passed"] } : {}), ...(typeof r["failed"] === "number" ? { failed: r["failed"] } : {}), ...(typeof r["failing"] === "string" ? { failing: r["failing"] } : {}) };
}
