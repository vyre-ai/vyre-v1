import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.github/workflows");
type Job = { name: string; timeout: boolean; uses: boolean; needs: string[]; continueOnError: boolean; text: string };
type Wf = { file: string; text: string; jobs: Job[] };

/** Reads the restricted workflow style used here: two-space job keys under jobs:, needs as a flow list or a single name. */
function parse(file: string): Wf {
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === "jobs:");
  const jobs: Job[] = [];
  let cur: { name: string; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const t = cur.body.join("\n");
    const n = /^ {4}needs:\s*(.+)$/m.exec(t)?.[1]?.trim() ?? "";
    jobs.push({
      name: cur.name, text: t,
      timeout: /^ {4}timeout-minutes:\s*\d+/m.test(t),
      uses: /^ {4}uses:/m.test(t),
      needs: n ? n.replace(/[\[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean) : [],
      continueOnError: /^ {4}continue-on-error:\s*true/m.test(t),
    });
  };
  for (const l of start < 0 ? [] : lines.slice(start + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { flush(); cur = { name: m[1]!, body: [] }; } else cur?.body.push(l);
  }
  flush();
  return { file, text, jobs };
}
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
const all = files.map(parse);
const wf = (n: string) => all.find((w) => w.file === `${n}.yml`)!;

test("at most 20 workflow files, and the named stages exist", () => {
  assert.ok(files.length <= 20, `${files.length} workflow files`);
  for (const n of ["check", "golden", "client", "kits", "images", "heavy", "native", "desktop", "security", "main", "release", "deploy", "nightly"]) assert.ok(wf(n), `${n}.yml`);
});

test("every job that runs steps has timeout-minutes", () => {
  for (const w of all) for (const j of w.jobs) if (!j.uses) assert.ok(j.timeout, `${w.file}: job ${j.name} has no timeout-minutes`);
});

test("check, golden and budget are real jobs in check.yml, budget runs if always() at 5 minutes", () => {
  const c = wf("check");
  for (const n of ["check", "golden", "budget"]) assert.ok(c.jobs.find((j) => j.name === n), `check.yml job ${n}`);
  const b = c.jobs.find((j) => j.name === "budget")!;
  assert.match(b.text, /^ {4}if: always\(\)/m);
  assert.match(b.text, /ci-budget\.ts --kind push/);
  assert.match(c.text, /ci-select\.ts/);
  assert.match(c.text, /test-run\.(ts|mjs)/);
});

test("budget jobs run if always() at 5, 10 and 25 minutes", () => {
  for (const [w, job, kind] of [["check", "budget", "push"], ["main", "budget-main", "main"], ["release", "budget-tag", "tag"]] as const) {
    const j = wf(w).jobs.find((x) => x.name === job);
    assert.ok(j, `${w}.yml ${job}`);
    assert.match(j!.text, /^ {4}if: always\(\)/m, `${job} if always`);
    assert.match(j!.text, new RegExp(`ci-budget\\.ts --kind ${kind}\\b`));
  }
});

test("native and desktop continue on error and never gate live or merge-ok", () => {
  for (const n of ["native", "desktop"]) for (const j of wf(n).jobs) assert.ok(j.continueOnError, `${n}.yml job ${j.name}`);
  const gates = all.flatMap((w) => w.jobs.filter((j) => /^(live|merge-ok|deploy|check|golden|budget)$/.test(j.name)).map((j) => ({ w: w.file, j })));
  assert.ok(gates.some((g) => g.j.name === "live") && gates.some((g) => g.j.name === "merge-ok"));
  for (const { w, j } of gates) for (const dep of j.needs) assert.ok(!/^(native|desktop)$/.test(dep), `${w}: ${j.name} needs ${dep}`);
  // deploy hangs off live, so native and desktop are not reachable from it either
  const rel = wf("release");
  const reach = (n: string, seen = new Set<string>()): Set<string> => { for (const d of rel.jobs.find((j) => j.name === n)?.needs ?? []) if (!seen.has(d)) { seen.add(d); reach(d, seen); } return seen; };
  for (const g of ["live", "deploy"]) for (const bad of ["native", "desktop"]) assert.ok(!reach(g).has(bad), `${g} reaches ${bad}`);
});

test("no npm install, docker pull or curl outside prewarm", () => {
  const bad = /\b(npm (ci|install|i)\b|docker pull|curl )/;
  for (const w of all) for (const j of w.jobs) {
    const code = j.text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    if (w.file === "nightly.yml" && j.name === "prewarm") continue;
    // Pinned forms are allowed anywhere: a pull of image@sha256:<digest> (or a helper that does that) and a curl in a job that also checks a literal sha256 with `sha256sum -c`.
    const lines = code.split("\n").filter((l) => bad.test(l));
    const pinned = (l: string) => (/docker pull/.test(l) && /@\$2|@sha256:[0-9a-f]{64}/.test(l)) || (/\bcurl /.test(l) && /sha256sum -c/.test(code) && /[0-9a-f]{64}/.test(code));
    assert.ok(lines.every(pinned), `${w.file}: job ${j.name} installs or downloads`);
  }
  assert.match(wf("nightly").text, /prewarm:/);
});

test("fast shards use the 20 s cap runners: test-run.mjs for cached fast files, test-run.ts for the slow list", () => {
  for (const n of ["check", "main", "release"]) { const t = wf(n).text; assert.match(t, /test-run\.mjs --files/); assert.match(t, /test-run\.ts --slow --files/); assert.match(t, /ci-select\.ts/); }
});
