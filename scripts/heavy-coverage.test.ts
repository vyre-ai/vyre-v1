// Every heavy test of the computers, sandbox and terminal areas runs somewhere (13 Nov 2026). A *.heavy.test.ts skips itself unless VYRE_HEAVY_DOCKER=1, so a heavy test no job names has never run in CI.
// Rc.26 shipped a takeover that could not click (button 0, place 0,0, no wheel) because sbrowser.heavy and the real-browser walk were named in no workflow. scripts/walk-coverage.test.ts does the same for
// browser walks; scripts/hidden-skips.test.ts covers live files that gate on a flag. This one is for the heavy files: each is named (by its path) in a workflow, or listed in NOT_IN_CI with its reason.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflows = fs.readdirSync(path.join(root, ".github/workflows")).filter((f) => f.endsWith(".yml")).map((f) => fs.readFileSync(path.join(root, ".github/workflows", f), "utf8")).join("\n");

/** The areas this guard holds to the rule. The whole repository's count is printed below as a finding. */
export const AREAS = ["modules/computers", "sandbox", "modules/terminal"];

/** Heavy tests in those areas that no workflow names, each with why and where it runs instead. Take a file off when a workflow names it; the test fails while a listed file is named, or is gone. */
export const NOT_IN_CI: Readonly<Record<string, string>> = {
  "modules/computers/tests/chrome-copy.heavy.test.ts": "copies an old desktop's Chrome folder into the Space browser (the old desktop is retired by f-desktop); needs both the agent-computer and Space browser images; run by hand when the move changes",
};

function heavyFiles(dir: string): string[] {
  const at = path.join(root, dir);
  if (!fs.existsSync(at)) return [];
  return (fs.readdirSync(at, { recursive: true }) as string[]).filter((f) => /\.heavy\.test\.ts$/.test(f) && !f.split(path.sep).includes("node_modules")).map((f) => `${dir}/${f.split(path.sep).join("/")}`);
}
function allHeavy(): string[] {
  const skip = new Set(["node_modules", ".git", "dist", ".expo", "target", "walks-evidence", "shots-evidence"]);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const rel = dir === "" ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel); else if (/\.heavy\.test\.ts$/.test(e.name)) out.push(rel);
    }
  };
  walk("");
  return out.sort();
}

test("every heavy test under modules/computers, sandbox and modules/terminal is named in a workflow or listed with its reason", () => {
  const mine = AREAS.flatMap(heavyFiles).sort();
  assert.ok(mine.length >= 12, `found the heavy tests (${mine.length})`);
  const unnamed = mine.filter((f) => !workflows.includes(f) && !(f in NOT_IN_CI));
  assert.deepEqual(unnamed, [], "a heavy test no job runs has never run: name it in a job of .github/workflows/check.yml (l2-heavy, l2-browser, heavy-live) or list it in NOT_IN_CI with its reason");
  for (const f of Object.keys(NOT_IN_CI)) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is gone: take it off NOT_IN_CI`);
    assert.ok(!workflows.includes(f), `${f} is named in a workflow now: take it off NOT_IN_CI`);
  }
});

test("how many heavy tests of the whole repository no workflow names (a finding, printed)", () => {
  const all = allHeavy();
  const unnamed = all.filter((f) => !workflows.includes(f));
  console.log(`HEAVY-COVERAGE: ${unnamed.length} of ${all.length} heavy tests are named in no workflow:\n${unnamed.join("\n")}`);
  assert.ok(all.length > 0);
});
