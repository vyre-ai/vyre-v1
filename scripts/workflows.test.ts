import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkNpmLicenses } from "./license-check.ts";
import { applyKnown } from "./boundaries.ts";
import { scanText } from "./security/secret-scan.ts";
import { failing as auditFailing, findings as auditFindings } from "./security/audit.ts";

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

test("at most 21 workflow files, and the named stages exist", () => {
  assert.ok(files.length <= 21, `${files.length} workflow files`);
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
  assert.match(c.text, /run-shard/);
});

test("budget jobs run if always() at 5, 10 and 25 minutes", () => {
  for (const [w, job, kind] of [["check", "budget", "push"], ["main", "budget-main", "main"], ["release", "budget-tag", "tag"]] as const) {
    const j = wf(w).jobs.find((x) => x.name === job);
    assert.ok(j, `${w}.yml ${job}`);
    assert.match(j!.text, /^ {4}if: always\(\)/m, `${job} if always`);
    assert.match(j!.text, new RegExp(`ci-budget\\.ts --kind ${kind}\\b`));
  }
});

test("native stays non-blocking for live while the macOS desktop artifact gates only publication", () => {
  for (const j of wf("native").jobs) assert.ok(j.continueOnError, `native.yml job ${j.name}`);
  const gates = all.flatMap((w) => w.jobs.filter((j) => /^(live|merge-ok|deploy|check|golden|budget)$/.test(j.name)).map((j) => ({ w: w.file, j })));
  assert.ok(gates.some((g) => g.j.name === "live") && gates.some((g) => g.j.name === "merge-ok"));
  for (const { w, j } of gates) for (const dep of j.needs) assert.ok(!/^(native|desktop)$/.test(dep), `${w}: ${j.name} needs ${dep}`);
  // deploy hangs off live, so native and desktop are not reachable from it either
  const rel = wf("release");
  const reach = (n: string, seen = new Set<string>()): Set<string> => { for (const d of rel.jobs.find((j) => j.name === n)?.needs ?? []) if (!seen.has(d)) { seen.add(d); reach(d, seen); } return seen; };
  for (const g of ["live", "deploy"]) for (const bad of ["native", "desktop"]) assert.ok(!reach(g).has(bad), `${g} reaches ${bad}`);
  const assembled = rel.jobs.find((j) => j.name === "desktop-release-files");
  assert.ok(assembled, "release assembles the desktop artifact");
  assert.deepEqual(assembled.needs, ["package", "desktop"]);
  assert.match(assembled.text, /name: desktop-macOS, path: desktop-artifact/);
  assert.match(assembled.text, /exactly one DMG/);
  assert.match(assembled.text, /sha256sum/);
  assert.match(assembled.text, /name: release-files-desktop/);
  assert.doesNotMatch(assembled.text, /nsis/i, "Windows installers never enter the release payload");
  for (const n of ["sign", "sign-dryrun"] as const) {
    const job = rel.jobs.find((j) => j.name === n)!;
    assert.ok(job.needs.includes("desktop-release-files"), `${n} waits for the macOS package`);
    assert.match(job.text, /name: release-files-desktop, path: dist/);
  }
});

test("the macOS desktop release path verifies, mounts, installs and exercises the DMG", () => {
  const desktop = wf("desktop");
  assert.doesNotMatch(files.join("\n"), /^mac\.yml$/m, "the removed server-installer workflow cannot stand in for a desktop DMG gate");
  assert.match(desktop.text, /codesign --verify --deep --strict/);
  assert.match(desktop.text, /Signature=adhoc/);
  assert.match(desktop.text, /hdiutil verify/);
  assert.match(desktop.text, /hdiutil attach/);
  assert.match(desktop.text, /ditto /);
  assert.match(desktop.text, /hdiutil detach/);
  assert.match(desktop.text, /spctl --assess --type execute/);
  assert.match(desktop.text, /run-shell\.sh/);
  assert.match(desktop.text, /VYRE_SHELL_RELAUNCH=1/);
  assert.match(wf("release").text, /name: desktop-macOS, path: desktop-artifact/);
  const runner = fs.readFileSync(path.resolve(dir, "../../apps/desktop/src-tauri/ci/run-shell.sh"), "utf8");
  const smoke = fs.readFileSync(path.resolve(dir, "../../apps/desktop/tests/shell.heavy.test.ts"), "utf8");
  assert.match(runner, /VYRE_SHELL_RELAUNCH/);
  assert.match(smoke, /VYRE_SHELL_RELAUNCH/);
  assert.match(smoke, /test\("the installed shell relaunches after a clean exit"/);
  assert.doesNotMatch(smoke, /if \(RELAUNCH\) await exerciseBuiltShell/,
    "the relaunch needs its own Node test timeout instead of sharing the first-launch 60 second budget");
  assert.match(smoke, /function requestNormalQuit/,
    "platform-specific normal app shutdown belongs in one lifecycle helper");
  assert.match(smoke, /tell application id \\"ai\.vyre\.desktop\\" to quit/,
    "macOS smoke must exercise the app's normal quit lifecycle before relaunching");
  assert.match(smoke, /CloseMainWindow\(\)/,
    "Windows smoke must close the spawned process's real top-level window");
  assert.match(smoke, /normal packaged-shell quit is unsupported/,
    "unsupported platforms must fail explicitly rather than silently using a forceful signal");
  assert.match(smoke, /awaitSidecarStop/,
    "the first launch must prove its packaged sidecar stopped before the relaunch begins");
});

test("no npm install, docker pull or curl outside prewarm", () => {
  const bad = /\b(npm (ci|install|i)\b|docker pull|curl )/;
  for (const w of all) for (const j of w.jobs) {
    const code = j.text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    if (w.file === "nightly.yml" && j.name === "prewarm") continue;
    // Pinned forms are allowed anywhere: a pull of image@sha256:<digest> (or a helper that does that) and a curl in a job that also checks a literal sha256 with `sha256sum -c`.
    const lines = code.split("\n").filter((l) => bad.test(l));
    const pinned = (l: string) => (/docker pull/.test(l) && /@\$2|@sha256:[0-9a-f]{64}/.test(l)) || (/\bcurl /.test(l) && /sha256sum -c/.test(code) && /[0-9a-f]{64}/.test(code));
    const lockedDesktopDeps = (l: string) => w.file === "desktop.yml" && j.name === "desktop" && /npm ci --no-audit --no-fund/.test(l);
    assert.ok(lines.every((l) => pinned(l) || lockedDesktopDeps(l)), `${w.file}: job ${j.name} installs or downloads`);
  }
  assert.match(wf("nightly").text, /prewarm:/);
  assert.match(wf("desktop").text, /npm ci --no-audit --no-fund/, "the packaged desktop build installs only the lockfile tree");
});

test("check, main and release run their shards through the one run-shard action: test-run.mjs for fast files, test-run.ts for the slow list, so the three cannot drift", () => {
  const action = fs.readFileSync(path.join(dir, "../actions/run-shard/action.yml"), "utf8");
  assert.match(action, /test-run\.mjs --jobs 2 --files/);
  assert.match(action, /test-run\.ts --slow --jobs 2 --files/);
  for (const n of ["check", "main", "release"]) { const t = wf(n).text; assert.match(t, /uses: \.\/\.github\/actions\/run-shard/); assert.match(t, /ci-select\.ts/); }
  assert.doesNotMatch(wf("release").text, /--max \d/, "release uses the same shard plan as check: no --max");
  // The org is out of GitHub Actions minutes (25 Oct): a hosted job dies with 0 steps, so none of the three workflows may name a GitHub-hosted runner, in a runs-on or in the matrix choice.
  for (const n of ["check", "main", "release"]) {
    const t = wf(n).text;
    assert.doesNotMatch(t, /runs-on:[^\n]*\b(?:ubuntu|windows|macos)-/i, `${n}.yml names a GitHub-hosted runner`);
    assert.doesNotMatch(t, /'hosted'|"hosted"/, `${n}.yml picks a hosted runner from the matrix`);
  }
});

// P-L11_23: security.yml runs the gates for real, and each scan fails on a seeded bad input.
test("security.yml has no placeholder and runs license-check, the secret scan, the audit and the boundaries over the whole tree", () => {
  const w = wf("security");
  assert.doesNotMatch(w.text, /placeholder/i);
  assert.match(w.text, /node scripts\/license-check\.ts/);
  assert.match(w.text, /node scripts\/security\/secret-scan\.ts/);
  assert.match(w.text, /node scripts\/security\/audit\.ts/);
  assert.match(w.text, /^\s+run: node scripts\/boundaries\.ts\s*$/m, "boundaries run on the whole tree");
  for (const l of w.text.split("\n")) if (/scripts\/(license-check|boundaries|security\/)/.test(l) && !/^\s*#/.test(l)) assert.doesNotMatch(l, /\|\|\s*true/, `a gate that cannot fail: ${l.trim()}`);
  for (const j of w.jobs) assert.ok(j.timeout, `security.yml job ${j.name} has timeout-minutes`);
  // a gate that skips is the placeholder again: the cargo step fails when it cannot run, never exits 0 on a missing tool
  assert.match(w.text, /cargo-deny \$CARGO_DENY_VERSION cannot be installed[^\n]*exit 1/);
  assert.match(w.text, /cargo install --locked --version "\$CARGO_DENY_VERSION"/);
  assert.doesNotMatch(w.text, /::warning::[^\n]*(not installed|not checked)/);
  // the cargo rules are passed by absolute path and a missing file fails the step; a relative path is resolved against the manifest directory and falls back to the default config
  assert.match(w.text, /--config "\$CONFIG"/);
  assert.match(w.text, /CONFIG="\$GITHUB_WORKSPACE\/scripts\/security\/deny\.toml"/);
  assert.match(w.text, /\[ -f "\$CONFIG" \] \|\| \{[^\n]*exit 1/);
  assert.doesNotMatch(w.text, /--config scripts\/security/);
});

test("seeded bad input: a blocked license, a secret, a high advisory and an unlisted boundary violation each fail", () => {
  assert.equal(checkNpmLicenses([{ name: "bad", license: "AGPL-3.0-only" }])[0]!.ok, false);
  assert.equal(scanText("a.ts", `const k = "${["AK", "IA", "ABCDEFGHIJKLMNOP"].join("")}";`).length, 1);
  assert.equal(auditFailing(auditFindings({ vulnerabilities: { x: { severity: "high", via: [] } } }), []).length, 1);
  const v = { rule: "B1", file: "modules/a/x.ts", message: "m", spec: "../b" };
  assert.equal(applyKnown([v], []).failing.length, 1);
  assert.equal(applyKnown([v], [{ rule: "B1", file: "modules/a/x.ts", reason: "moves with P-X, until then accepted", until: "2099-01-01" }]).failing.length, 0);
  assert.equal(applyKnown([v], [{ rule: "B1", file: "modules/a/x.ts", reason: "", until: "2099-01-01" }]).failing.length, 1, "a known entry without a reason does not count");
  assert.equal(applyKnown([v], [{ rule: "B1", file: "modules/a/x.ts", reason: "moves with P-X, until then accepted", until: "2020-01-01" }]).failing.length, 1, "an expired known entry does not count");
  assert.equal(applyKnown([], [{ rule: "B1", file: "gone.ts", reason: "was needed once, now fixed", until: "2099-01-01" }]).stale.length, 1, "a stale known entry fails");
});
