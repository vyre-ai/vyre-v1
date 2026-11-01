// Every button a task offers must do what its label says. A bare "resolved" action only closes the task; it grants nothing and saves nothing, so a task whose label promises more (Provide the key, Approve)
// must not offer it. The tasks that still do offer one are reviewed here: each is closed by something real (its own flow notices the fix), or has its own button in Needs you. A new one fails this test until reviewed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  if (f === "tests" || f === "fixtures" || f === "node_modules") return [];
  return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

const REVIEWED: Record<string, string> = {
  "modules/google/handlers/personal.ts": "Sign in again: Needs you shows its own Sign in again button (mailFix)",
  "modules/microsoft/handlers/personal.ts": "Sign in again: Needs you shows its own Sign in again button (mailFix)",
  "modules/engine/handlers/spend.ts": "Raise once: handled by the spend flow when the task resolves",
};

test("only reviewed tasks offer a bare resolved action", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const found = walk(path.join(root, "modules")).filter((f) => /actions: \[\{ key: "resolved"/.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
  assert.deepEqual(found.sort(), Object.keys(REVIEWED).sort());
});
