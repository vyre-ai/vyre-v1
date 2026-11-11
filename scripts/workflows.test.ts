import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkNpmLicenses } from "./license-check.ts";
import { applyKnown } from "./boundaries.ts";
import { scanText } from "./security/secret-scan.ts";
import { failing as auditFailing, findings as auditFindings } from "./security/audit.ts";
import { MAIN_FULL_SELECT_ARGS } from "./release/reuse.ts";

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

test("shots shards the complete visual suite and publishes release evidence through one canonical artifact", () => {
  const shots = wf("shots");
  const capture = shots.jobs.find((j) => j.name === "shots")!;
  const evidence = shots.jobs.find((j) => j.name === "release-evidence")!;
  const aggregate = shots.jobs.find((j) => j.name === "aggregate-shots")!;
  assert.ok(capture && evidence && aggregate, "capture, release evidence and aggregation jobs exist");
  assert.match(capture.text, /fromJSON\(startsWith\(github\.ref_name, 'build\/P-'\)/);
  assert.match(capture.text, /\[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35\]/);
  assert.match(capture.text, /'1' \|\| '36'/);
  assert.match(capture.text, /--shard-index "\$\{\{ matrix\.shard \}\}" --shard-total "\$SHARD_TOTAL"/);
  assert.match(capture.text, /name: shots-part-\$\{\{ matrix\.shard \}\}/);
  assert.doesNotMatch(capture.text, /pwa-mobile|real-app\.e2e/, "release evidence does not wait behind visual shards");
  assert.deepEqual(evidence.needs, [], "release evidence starts independently");
  assert.match(evidence.text, /pwa-mobile\/evidence\.json/);
  assert.match(evidence.text, /pwa-mobile\/iphone-390x844-standalone-simulated\.png/);
  assert.deepEqual(aggregate.needs, ["shots", "release-evidence"]);
  assert.match(aggregate.text, /pattern: shots-part-\*/);
  assert.match(aggregate.text, /name: shots-evidence/);
  assert.match(aggregate.text, /merge-index\.mjs/);
  assert.match(aggregate.text, /SHARD_TOTAL=36/);
  assert.match(aggregate.text, /name: shots\s*$/m);
  assert.match(aggregate.text, /if-no-files-found: error/);
  assert.equal(shots.jobs.reduce((count, job) => count + (job.text.match(/name: shots\s*$/gm) ?? []).length, 0), 1, "only aggregation publishes the canonical shots artifact");
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
  // guard is there for its clock (the budget job measures from it when the API cannot be read); the budget still stops at the live and deploy boundary, before desktop publication work
  assert.deepEqual(wf("release").jobs.find((j) => j.name === "budget-tag")!.needs, ["guard", "live", "deploy"], "tag budget stops at the live and deploy boundary, before desktop publication work");
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
  assert.match(assembled.text, /^ {4}timeout-minutes: 30$/m, "assembling has room for a slow artifact service (rc.2 hit 15)");
  // the DMG crosses the network once, into publish: assembling and signing carry only its SHA-256 sidecar
  assert.match(assembled.text, /name: desktop-macOS-sha256, path: desktop-sum/);
  assert.doesNotMatch(assembled.text, /name: desktop-macOS,/, "assembling never downloads the DMG");
  assert.match(assembled.text, /exactly one DMG/);
  assert.match(assembled.text, /name: release-files-desktop/);
  const desktop = wf("desktop");
  assert.match(desktop.text, /shasum -a 256/);
  assert.match(desktop.text, /name: desktop-macOS-sha256, path: dmg-sum/);
  const publish = rel.jobs.find((j) => j.name === "publish")!;
  assert.match(publish.text, /desktop-macOS=desktop-artifact/, "publish takes the DMG once");
  assert.match(publish.text, /sha256sum -c "\$dmg_name\.sha256"/, "publish checks the DMG against the build's SHA-256 sidecar before uploading");
  assert.ok(publish.text.indexOf("sha256sum -c") < publish.text.indexOf("cli.ts publish"), "the check comes before the upload");
  for (const n of ["sign", "sign-dryrun"]) assert.doesNotMatch(rel.jobs.find((j) => j.name === n)!.text, /desktop-macOS/, `${n} never downloads the DMG`);
  assert.doesNotMatch(assembled.text, /nsis/i, "Windows installers never enter the release payload");
  for (const n of ["sign", "sign-dryrun"] as const) {
    const job = rel.jobs.find((j) => j.name === n)!;
    assert.ok(job.needs.includes("desktop-release-files"), `${n} waits for the macOS package`);
    assert.match(job.text, /name: release-files-desktop, path: dist/);
  }
});

test("release artifact transfer stages have a bounded thirty-minute window", () => {
  const rel = wf("release");
  for (const name of ["sign", "sign-dryrun", "publish"]) {
    const job = rel.jobs.find((j) => j.name === name);
    assert.ok(job, `release.yml job ${name}`);
    assert.match(job!.text, /^ {4}timeout-minutes: 30$/m, `${name} allows the measured 127 MB artifact transfer plus its bounded work`);
  }
  assert.match(rel.jobs.find((j) => j.name === "sign")!.text, /name: release-files-desktop, path: dist/);
  assert.match(rel.jobs.find((j) => j.name === "sign-dryrun")!.text, /name: release-files-desktop, path: dist/);
  assert.match(rel.jobs.find((j) => j.name === "publish")!.text, /release-signed=dist/);
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
  assert.match(wf("release").jobs.find((j) => j.name === "publish")!.text, /desktop-macOS=desktop-artifact/);
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
    // The Mac sandbox proof exists to run the real Claude Code and Codex CLIs under the Seatbelt profile: it installs the lockfile tree and those two CLIs into a runner temp folder, in this job only.
    const macSandboxProof = (l: string) => w.file === "desktop.yml" && j.name === "sandbox-macos" && (/npm ci --no-audit --no-fund/.test(l) || /npm install --prefix "\$cli" --no-audit --no-fund @anthropic-ai\/claude-code@2\.1\.312 @openai\/codex@0\.166\.0\s*$/.test(l));
    // The Windows proofs (l-winparity): the parity job installs the lockfile tree, and the winfix job installs one pinned ssh2 into a runner temp folder for its SSH server, in those jobs only.
    const winProof = (l: string) => w.file === "desktop.yml" && ((j.name === "parity-windows" && /npm ci --no-audit --no-fund/.test(l)) || (j.name === "winfix-windows" && /npm install --silent --no-audit --no-fund --prefix "\$env:RUNNER_TEMP\\ssh2" ssh2@1\.16\.0$/.test(l.trim())));
    // The relay deploy runs by hand and installs wrangler from its own lockfile with scripts off, so every byte is pinned by the lockfile's integrity hashes.
    const lockedWrangler = (l: string) => w.file === "relay-deploy.yml" && (/npm ci --ignore-scripts --no-audit --no-fund --prefix tools\/wrangler/.test(l) || /curl -s -o \/dev\/null -w '%\{http_code\}'/.test(l)); // its smoke check reads a status code and keeps no bytes
    // The artifact frame proof under WebKit on the macOS runner installs the lockfile tree, in that job only (l-engine21 e9f29ec8f).
    const macFrameProof = (l: string) => w.file === "desktop.yml" && j.name === "frame-macos" && /npm ci --no-audit --no-fund/.test(l);
    assert.ok(lines.every((l) => pinned(l) || lockedDesktopDeps(l) || macSandboxProof(l) || macFrameProof(l) || winProof(l) || lockedWrangler(l)), `${w.file}: job ${j.name} installs or downloads`);
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
  // One job is the exception, by design: release.yml's `publish` runs on a GitHub-hosted runner since 11 Nov (the repo has been public since 25 Oct, so hosted minutes are free, and kits and desktop already run
  // hosted). Its self-hosted runner pulled the release artifacts at 85 KB/s and timed out three releases in a row. Every other job of the three still must not name one.
  for (const n of ["check", "main", "release"]) {
    const t = n === "release" ? wf(n).jobs.filter((j) => j.name !== "publish").map((j) => j.text).join("\n") : wf(n).text;
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

test("the Windows setup program reaches the release as VyreSetup.exe with a SHA-256 sidecar that goes through sign, and install.ps1 asks for exactly those names", () => {
  const desktop = wf("desktop"), rel = wf("release");
  assert.match(desktop.text, /bundle\/nsis\/\*-setup\.exe/, "the build's own output name is globbed, then renamed");
  assert.match(desktop.text, /cp "\$\{exes\[0\]\}" win-exe\/VyreSetup\.exe/);
  assert.match(desktop.text, /sum=\$\(sha256sum win-exe\/VyreSetup\.exe \| cut -c1-64\)/);
  assert.match(desktop.text, /printf '%s  VyreSetup\.exe\\n' \"\$sum\" > win-sum\/VyreSetup\.exe\.sha256/);
  assert.match(desktop.text, /name: desktop-Windows-sha256, path: win-sum/);
  assert.match(desktop.text, /name: desktop-Windows-exe, path: win-exe/);
  // Tauri's name for the installer is <productName>_<version>_<arch>-setup.exe: the glob has to match it
  const conf = JSON.parse(fs.readFileSync(path.resolve(dir, "../../apps/desktop/src-tauri/tauri.conf.json"), "utf8")) as { productName: string; version: string };
  assert.match(`${conf.productName}_${conf.version}_x64-setup.exe`, /^[^/]+-setup\.exe$/);
  // the checksum travels through assembling and sign; the program itself is downloaded once, by publish
  const assembled = rel.jobs.find((j) => j.name === "desktop-release-files")!;
  assert.match(assembled.text, /name: desktop-Windows-sha256, path: desktop-sum-win/);
  assert.doesNotMatch(assembled.text, /desktop-Windows-exe/, "assembling never downloads the setup program");
  for (const n of ["sign", "sign-dryrun"]) assert.doesNotMatch(rel.jobs.find((j) => j.name === n)!.text, /desktop-Windows/, `${n} never downloads the setup program`);
  const publish = rel.jobs.find((j) => j.name === "publish")!;
  assert.match(publish.text, /desktop-Windows-exe=desktop-win/);
  assert.match(publish.text, /sha256sum -c VyreSetup\.exe\.sha256/);
  assert.match(publish.text, /cat \*\.dmg\.sha256 VyreSetup\.exe\.sha256 > SHA256SUMS/);
  assert.ok(publish.text.indexOf("sha256sum -c VyreSetup.exe.sha256") < publish.text.indexOf("cli.ts publish"), "the check comes before the upload");
  const ps1 = fs.readFileSync(path.resolve(dir, "../../scripts/install/windows/install.ps1"), "utf8");
  assert.match(ps1, /"\$ReleaseBase\/VyreSetup\.exe"/);
  assert.match(ps1, /"\$ReleaseBase\/SHA256SUMS"/);
});

test("the Windows leg proves the install end to end, and it blocks release the way the Mac leg does", () => {
  const desktop = wf("desktop");
  const e2e = fs.readFileSync(path.resolve(dir, "../../scripts/install/windows/install.e2e.ps1"), "utf8");
  for (const phase of ["silent-install", "nsis-uninstall", "via-script", "script-uninstall"]) {
    assert.match(desktop.text, new RegExp(`-Phase ${phase}`), `the workflow runs ${phase}`);
    assert.ok(e2e.includes(`"${phase}"`), `the script has ${phase}`);
  }
  assert.match(desktop.text, /run-shell\.sh "\$\(cygpath -u "\$APP"\)" "\$PWD\/out-installed"/, "the installed program gets the packaged smoke");
  assert.match(desktop.text, /VYRE_SHELL_RELAUNCH: "1"/, "and the relaunch");
  assert.match(desktop.text, /cp win-sum\/VyreSetup\.exe\.sha256 win-release\/SHA256SUMS/, "install.ps1 reads a local SHA256SUMS made from the build's own sidecar");
  assert.match(e2e, /VYRE_RELEASE_BASE = "http:\/\/127\.0\.0\.1:8765"/, "never a published release");
  assert.match(e2e, /Find-VyreApp/, "the path check is install.ps1's own");
  // the installer and its proof run on a pull request that touches them, not only at release
  for (const trigger of ["pull_request", "push"]) assert.match(desktop.text.slice(desktop.text.indexOf(`  ${trigger}:`)), /scripts\/install\/windows\/\*\*/, `${trigger} runs the desktop workflow for installer changes`);
  // a red Windows leg fails the `desktop` workflow, and release's desktop-release-files needs it
  assert.deepEqual(wf("release").jobs.find((j) => j.name === "desktop-release-files")!.needs, ["package", "desktop"]);
});

test("the app's own updates: the build writes digests, only the digests go through sign, sign makes the signatures and the feed, publish checks the bundles against them", () => {
  const desktop = wf("desktop"), rel = wf("release");
  assert.match(desktop.text, /updater-digest upd-bundle\/Vyre\.app\.tar\.gz > upd-sum\/Vyre\.app\.tar\.gz\.b2/);
  assert.match(desktop.text, /updater-digest win-exe\/VyreSetup\.exe > win-sum\/VyreSetup\.exe\.b2/);
  assert.match(desktop.text, /name: desktop-macOS-update-sum, path: upd-sum/);
  assert.match(desktop.text, /name: desktop-macOS-update, path: upd-bundle/);
  const assembled = rel.jobs.find((j) => j.name === "desktop-release-files")!;
  assert.match(assembled.text, /name: desktop-macOS-update-sum, path: desktop-sum-upd/);
  assert.match(assembled.text, /cp desktop-sum-upd\/Vyre\.app\.tar\.gz\.b2 dist\//);
  assert.match(assembled.text, /cp desktop-sum-win\/VyreSetup\.exe\.b2 dist\//);
  assert.doesNotMatch(assembled.text, /desktop-macOS-update,/, "the 100 MB bundle never moves through assembling or sign");
  for (const n of ["sign", "sign-dryrun"]) {
    const job = rel.jobs.find((j) => j.name === n)!;
    assert.match(job.text, /cli\.ts updater dist "\$VERSION" "\$CHANNEL" "\$TAG" /, `${n} signs the update digests with the same key`);
    assert.doesNotMatch(job.text, /desktop-macOS-update,/);
  }
  const publish = rel.jobs.find((j) => j.name === "publish")!;
  assert.match(publish.text, /desktop-macOS-update=desktop-upd/);
  assert.match(publish.text, /cli\.ts updater-check dist dist/);
  assert.ok(publish.text.indexOf("updater-check") < publish.text.indexOf("cli.ts publish"), "the check comes before the upload");
});

// The release is meant to publish with nobody touching it (11 Nov 2026: rc.21, rc.22 and rc.23 each had to be published by hand). These keep the shape that makes that safe and keep every gate.
test("release: the suite is the only gate that a finished main.yml run can stand in for, and every other gate always runs on the tag", () => {
  const rel = wf("release");
  const job = (n: string) => rel.jobs.find((j) => j.name === n)!;
  const cond = (n: string) => /^ {4}if:\s*(>-\n)?([\s\S]*?)(?=^ {4}[a-z-]+:)/m.exec(job(n).text)?.[2] ?? "";
  // select and suite run unless reuse named a run; no other job may have an `if` that can drop a gate
  assert.deepEqual(job("select").needs, ["reuse"]);
  assert.match(job("select").text, /^ {4}if: needs\.reuse\.outputs\.run == ''$/m);
  assert.deepEqual(job("suite").needs, ["select"]);
  assert.doesNotMatch(job("suite").text, /^ {4}if:/m, "suite is skipped only through select");
  for (const n of ["guard", "reuse", "package", "client", "kits", "images", "heavy", "security", "desktop", "desktop-release-files", "native"]) assert.doesNotMatch(job(n).text, /^ {4}if:/m, `${n} is never skipped`);
  // live needs each gate to have succeeded here; select and suite may be skipped only with a reused run
  const live = job("live");
  for (const g of ["guard", "reuse", "package", "select", "suite", "client", "kits", "images", "heavy", "security"]) assert.ok(live.needs.includes(g), `live needs ${g}`);
  const c = cond("live");
  for (const g of ["guard", "reuse", "package", "client", "kits", "images", "heavy", "security"]) assert.match(c, new RegExp(`needs\\.${g}\\.result == 'success'`), `live requires ${g} to have succeeded`);
  assert.match(c, /needs\.reuse\.outputs\.run != '' && needs\.select\.result == 'skipped' && needs\.suite\.result == 'skipped'/, "a skipped suite counts only with a reused run");
  assert.match(c, /needs\.select\.result == 'success' && needs\.suite\.result == 'success'/, "otherwise select and suite passed here");
  assert.match(c, /^\s*always\(\)/, "an explicit result test, so a skipped select does not skip live");
  // what hangs off live must test live's own result, since the implied success() also looks at live's skipped ancestors
  assert.match(cond("sign"), /always\(\) && needs\.guard\.result == 'success'.*needs\.desktop-release-files\.result == 'success' && needs\.live\.result == 'success'/);
  assert.match(job("deploy").text, /^ {4}if: always\(\) && needs\.live\.result == 'success'$/m);
  // nothing in the release may be marked to pass when it fails
  assert.doesNotMatch(rel.text, /continue-on-error/);
  for (const j of rel.jobs) assert.ok(!j.continueOnError, j.name);
  // the reuse job asks for exactly the commit that was tagged
  assert.match(job("reuse").text, /cli\.ts reuse "\$\{\{ github\.sha \}\}"/);
  assert.match(job("publish").text, /RELEASE_TESTS: \$\{\{ needs\.reuse\.outputs\.tests \}\}/, "the release notes name where the tests ran");
});

test("release: what counts as a whole-suite run uses the same plan flags as main.yml's full run", () => {
  const main = wf("main").text;
  assert.match(main, /node scripts\/ci-select\.ts "\$base" --matrix --max 8 --no-perf/, "main.yml's select line");
  assert.deepEqual([...MAIN_FULL_SELECT_ARGS], ["", "--matrix", "--max", "8", "--no-perf"], "reuse.ts plans the shards the way main.yml does");
  // main.yml names its test jobs after the plan (shards: name: ${{ matrix.name }}) and its golden jobs are what proves a whole-suite run
  assert.match(wf("main").jobs.find((j) => j.name === "shards")!.text, /name: \$\{\{ matrix\.name \}\}|^ {4}name: \$\{\{ matrix\.name \}\}/m);
  for (const g of ["golden-main-1", "golden-main-2", "golden-main-3", "golden-main"]) assert.match(wf("main").jobs.find((j) => j.name === g)!.text, /needs\.select\.outputs\.full == 'true'/, `${g} runs only for a whole-suite run`);
});

test("release: publish runs hosted, holds no signing key, fetches its artifacts with retries and a limit per try, and the package pushes are retried", () => {
  const rel = wf("release");
  const publish = rel.jobs.find((j) => j.name === "publish")!;
  assert.match(publish.text, /^ {4}runs-on: ubuntu-latest$/m);
  assert.match(publish.text, /^ {4}timeout-minutes: 30$/m, "the cap is not raised");
  assert.match(publish.text, /^ {4}permissions: \{ contents: write, actions: read \}$/m);
  assert.doesNotMatch(publish.text, /VYRE_SIGNING_KEY|secrets\./, "publish never sees a secret");
  assert.doesNotMatch(publish.text, /download-artifact/, "publish fetches through the retrying script");
  const fetcher = fs.readFileSync(path.join(dir, "../../scripts/release/fetch-artifacts.sh"), "utf8");
  assert.match(fetcher, /timeout "\$limit" gh run download/);
  assert.match(fetcher, /could not fetch the artifact/);
  assert.match(publish.text, /^ {6}- name: Attach everything/m);
  const pk = rel.jobs.find((j) => j.name === "package")!;
  assert.match(pk.text, /^ {4}timeout-minutes: 20$/m, "the cap is not raised");
  assert.doesNotMatch(pk.text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"), /^\s*docker push /m, "every push goes through retry.sh");
  assert.match(pk.text, /retry\.sh 2 30 docker buildx bake/);
  assert.equal((pk.text.match(/retry\.sh 3 20 docker push/g) ?? []).length, 3, "the three image pushes");
  // the budget job reads the API in pages and falls back to the guard's own clock
  const b = rel.jobs.find((j) => j.name === "budget-tag")!;
  assert.match(b.text, /--fallback-start "\$\{\{ needs\.guard\.outputs\.started \}\}"/);
});
