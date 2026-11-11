// Every browser walk runs somewhere (f-wire, 12 Nov). A walk drives Chromium against the production export and skips when VYRE_APP_DIST is not set, which is everywhere except the jobs that
// export the app first (shots.yml release-evidence and release-evidence-walks). scripts/hidden-skips.test.ts covers gates written as NAME === "1"; this covers the walks, which gate on the export
// being there. On 12 Nov 18 walk files were named in no workflow, so they had not run anywhere since they were written; three of them had gone red unseen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflows = fs.readdirSync(path.join(root, ".github/workflows")).filter((f) => f.endsWith(".yml")).map((f) => fs.readFileSync(path.join(root, ".github/workflows", f), "utf8")).join("\n");

/**
 * Walks found red on 12 Nov when they were first run (lane f-wire); each needs its owner to decide whether the app or the walk is wrong, then a line in shots.yml. Take a file off when it
 * is named in a workflow; the test fails while a listed file is already named, or is gone.
 */
export const PENDING: Readonly<Record<string, string>> = {
  "apps/app/tests/onboarding.reopen.live.test.ts": "red: the Resume line (resume-open) never shows after going back to the AI step, wide and phone",
  "apps/app/tests/overview.real.live.test.ts": "red: the project header's Status now reads with its menu chevron, so it differs from the Status property",
  "test/crew.thread.journey.live.test.ts": "red: its one journey passes, then the file runs past its 120 s cap",
  "test/cut-proof.heavy.test.ts": "needs a running server from compose.server.yml, its claim link and VYRE_HEAVY_DOCKER; run by hand at the cut",
};

const SCAN = ["apps/app/tests", "test", "host/tests", "scripts/shots", "scripts/click"];

/** Test files that open a browser on the export: they import playwright-core, or a kit that does. Kits (no test of their own) are not walks. */
function walks(): string[] {
  const files = SCAN.flatMap((d) => (fs.existsSync(path.join(root, d)) ? (fs.readdirSync(path.join(root, d), { recursive: true }) as string[]).map((f) => `${d}/${f}`) : []))
    .filter((f) => /\.test\.(ts|tsx|mjs)$/.test(f));
  const src = new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]));
  const browser = (s: string): boolean => /playwright-core/.test(s) && /VYRE_APP_DIST/.test(s);
  const kits = [...src].filter(([, s]) => browser(s) && !/^\s*(?:test|it)(?:\.\w+)?\(/m.test(s)).map(([f]) => path.basename(f).replace(/\.ts$/, ""));
  return [...src].filter(([, s]) => /^\s*(?:test|it)(?:\.\w+)?\(/m.test(s) && (browser(s) || kits.some((k) => s.includes(`/${k}.ts"`) || s.includes(`./${k}.ts"`)))).map(([f]) => f).sort();
}

test("every browser walk is named in a workflow job, or listed as pending with its reason", () => {
  const all = walks();
  assert.ok(all.length > 60, `found the walks (${all.length})`);
  const unnamed = all.filter((f) => !workflows.includes(f) && !(f in PENDING));
  assert.deepEqual(unnamed, [], "a walk no job runs has never run: name it in shots.yml release-evidence-walks");
  for (const f of Object.keys(PENDING)) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is gone: take it off PENDING`);
    assert.ok(!workflows.includes(f), `${f} is named in a workflow now: take it off PENDING`);
  }
});
