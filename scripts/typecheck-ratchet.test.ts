import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { countErrors, judge, inCi } from "./typecheck-ratchet.ts";

const SCRIPT = fileURLToPath(new URL("./typecheck-ratchet.ts", import.meta.url));

test("errors are counted per line, module-not-found ones are not", () => {
  const out = ["a.ts(1,1): error TS2322: x", "a.ts(2,1): error TS2307: Cannot find module", "b.tsx(3,4): error TS7016: no declaration", "b.tsx(9,9): error TS2339: y", "  continuation line"].join("\n");
  assert.equal(countErrors(out), 2);
});

test("more errors than the baseline fail; fewer pass and offer the lower count", () => {
  assert.equal(judge(11, 10).ok, false);
  assert.deepEqual([judge(10, 10).ok, judge(10, 10).lower], [true, false]);
  assert.deepEqual([judge(9, 10).ok, judge(9, 10).lower], [true, true]);
});

test("on a CI runner a ratchet that cannot count fails; elsewhere it says it skipped (the gates step read skipped on every push until 5 Nov)", () => {
  assert.deepEqual([inCi({ GITHUB_ACTIONS: "true" }), inCi({ CI: "true" }), inCi({ CI: "1" }), inCi({})], [true, true, false, false]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-"));
  try {
    const ci = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } });
    assert.equal(ci.status, 1, ci.stdout + ci.stderr);
    assert.match(ci.stdout, /typecheck ratchet cannot run: react-native is not installed here/);
    const local = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "", CI: "" } });
    assert.equal(local.status, 0, local.stdout + local.stderr);
    assert.match(local.stdout, /typecheck ratchet skipped/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the server ratchet is chosen by --project and --baseline; the app's stays the default, and only it needs react-native", async () => {
  const { targetOf } = await import("./typecheck-ratchet.ts");
  assert.deepEqual(targetOf([]), { project: "tsconfig.typecheck.json", baseline: "scripts/typecheck-baseline.json", needsReactNative: true });
  assert.deepEqual(targetOf(["--project", "tsconfig.typecheck.server.json", "--baseline", "scripts/typecheck-baseline.server.json"]), { project: "tsconfig.typecheck.server.json", baseline: "scripts/typecheck-baseline.server.json", needsReactNative: false });
});

// ---- fifth look V5: a compiler that did not finish never passes -------------------------------------------------------------------------------------------------

function standIn(body: string, baseline: number): { dir: string; run: (args?: string[]) => ReturnType<typeof spawnSync> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-v5-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts/typecheck-baseline.server.json"), JSON.stringify({ count: baseline }));
  fs.writeFileSync(path.join(dir, "tsc.mjs"), body);
  fs.writeFileSync(path.join(dir, "tsc"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, "tsc.mjs")}" "$@"\n`, { mode: 0o755 });
  const run = (args: string[] = []) => spawnSync(process.execPath, [SCRIPT, "--project", "tsconfig.typecheck.server.json", "--baseline", "scripts/typecheck-baseline.server.json", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, TSC: path.join(dir, "tsc"), GITHUB_ACTIONS: "", CI: "" } });
  return { dir, run };
}
const lines = (n: number): string => Array.from({ length: n }, (_, i) => `a.ts(${i + 1},1): error TS2322: x`).join("\\n");

test("V5: a compiler killed by a signal, one that exits failing with no error lines, and a sudden drop without --update all fail; the same count passes", () => {
  for (const [what, body, baseline, ok] of [
    ["killed", `process.stdout.write("${lines(3)}\\n"); process.kill(process.pid, "SIGKILL");`, 100, false],
    ["exits 2 with nothing", `process.exit(2);`, 100, false],
    ["a sudden drop", `process.stdout.write("${lines(10)}\\n"); process.exit(2);`, 100, false],
    ["the same count", `process.stdout.write("${lines(100)}\\n"); process.exit(2);`, 100, true],
    ["a small fall", `process.stdout.write("${lines(95)}\\n"); process.exit(2);`, 100, true],
  ] as const) {
    const s = standIn(body, baseline);
    try {
      const r = s.run();
      assert.equal(r.status === 0, ok, `${what}: ${r.stdout}${r.stderr}`);
      if (!ok) assert.match(String(r.stdout), /typecheck ratchet failed: /, what);
    } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
  }
  // a real drop is believed when a person asks for it
  const s = standIn(`process.stdout.write("${lines(10)}\\n"); process.exit(2);`, 100);
  try { assert.equal(s.run(["--update"]).status, 0); assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "scripts/typecheck-baseline.server.json"), "utf8")).count, 10); }
  finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("V5: a spawn error fails, and a baseline above the merge base's fails", async () => {
  const { trustworthy } = await import("./typecheck-ratchet.ts");
  assert.match(trustworthy({ error: new Error("spawn ENOENT"), signal: null, status: null }, 0, 100, { update: false, mergeBaseBaseline: null }) ?? "", /did not run/);
  assert.match(trustworthy({ signal: null, status: 2 }, 100, 101, { update: false, mergeBaseBaseline: 100 }) ?? "", /above the one on the merge base/);
  assert.equal(trustworthy({ signal: null, status: 2 }, 100, 100, { update: false, mergeBaseBaseline: 100 }), null);
});

test("W1: the earlier baseline is read from the target branch (GITHUB_BASE_REF, else int/rc25): a count, a file new on this branch, or unreadable, which fails on CI", async () => {
  const { baseRefOf, mergeBaseBaseline } = await import("./typecheck-ratchet.ts");
  assert.equal(baseRefOf({ GITHUB_BASE_REF: "main" }), "origin/main");
  assert.equal(baseRefOf({}), "origin/int/rc25");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-w1-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  try {
    git("init", "-q", "-b", "base");
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    git("add", "-A"); git("commit", "-q", "-m", "base");
    git("update-ref", "refs/remotes/origin/int/rc25", "HEAD");
    git("checkout", "-q", "-b", "work");
    fs.writeFileSync(path.join(dir, "scripts/typecheck-baseline.server.json"), JSON.stringify({ count: 5 }));
    git("add", "-A"); git("commit", "-q", "-m", "work");
    assert.deepEqual(mergeBaseBaseline(dir, "scripts/typecheck-baseline.server.json", "origin/int/rc25"), { state: "new" }, "new on this branch");
    // the target branch has it at 3
    git("checkout", "-q", "base");
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts/typecheck-baseline.server.json"), JSON.stringify({ count: 3 }));
    git("add", "-A"); git("commit", "-q", "-m", "base 3");
    git("update-ref", "refs/remotes/origin/int/rc25", "HEAD");
    git("checkout", "-q", "work"); git("merge", "-q", "--no-edit", "-X", "ours", "base");
    assert.deepEqual(mergeBaseBaseline(dir, "scripts/typecheck-baseline.server.json", "origin/int/rc25"), { state: "ok", count: 3 });
    assert.equal(mergeBaseBaseline(dir, "scripts/typecheck-baseline.server.json", "origin/nope").state, "unreadable", "no such branch: unreadable");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
