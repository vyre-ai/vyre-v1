import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The regen bot against a throwaway repository: a bare "origin", a clone the bot runs in, fake generator tools, and a fake npm and gh on PATH.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cwd: string, cmd: string, env: Record<string, string> = {}) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

/** origin.git with main and build/x, one working clone for the bot and a second clone that plays the worker. */
function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regen-bot-"));
  const origin = path.join(dir, "origin.git"), bot = path.join(dir, "bot"), worker = path.join(dir, "worker"), bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "gh $@" >> "${dir}/gh.log"\nexit 0\n`, { mode: 0o755 });
  sh(dir, `git init -q --bare origin.git && git clone -q origin.git seed 2>/dev/null`);
  const seed = path.join(dir, "seed");
  sh(seed, "git config user.name t && git config user.email t@t && git checkout -q -b main");
  fs.mkdirSync(path.join(seed, "manifests")); fs.mkdirSync(path.join(seed, "tools/gen/src"), { recursive: true }); fs.mkdirSync(path.join(seed, "scripts")); fs.mkdirSync(path.join(seed, "generated")); fs.mkdirSync(path.join(seed, "docs/frozen/snapshots"), { recursive: true });
  fs.writeFileSync(path.join(seed, "manifests/m.txt"), "one\n");
  // the fake generator: generated/m.txt is the manifest in upper case; a RACE_DIR makes it push a worker commit the first time it runs
  fs.writeFileSync(path.join(seed, "tools/gen/src/cli.ts"), `import fs from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--snapshots")) process.exit(0);
const race = process.env.RACE_DIR, flag = (race ?? "") + "/.raced";
if (race && !fs.existsSync(flag)) { fs.writeFileSync(flag, "1"); const { execSync } = await import("node:child_process"); execSync("echo more >> tests.txt && git add tests.txt && git commit -q -m 'worker race' && git push -q origin HEAD:refs/heads/build/x", { cwd: race }); }
fs.writeFileSync("generated/m.txt", fs.readFileSync("manifests/m.txt", "utf8").toUpperCase());
`);
  fs.writeFileSync(path.join(seed, "tools/gen/check.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(seed, "scripts/ci-select.ts"), `console.log(JSON.stringify({ all: false, files: [] }));\n`);
  fs.copyFileSync(path.join(root, "scripts/regen-bot.sh"), path.join(seed, "scripts/regen-bot.sh"));
  fs.writeFileSync(path.join(seed, "generated/m.txt"), "ONE\n");
  sh(seed, "git add -A && git commit -q -m base && git push -q origin main && git checkout -q -b build/x && git push -q origin build/x");
  sh(dir, "git clone -q origin.git bot && git clone -q origin.git worker");
  for (const c of [bot, worker]) sh(c, "git config user.name t && git config user.email t@t && git checkout -q build/x");
  const run = (extra: Record<string, string> = {}) => sh(bot, "bash scripts/regen-bot.sh", { BRANCH: "build/x", GH_TOKEN: "x", REPO: "o/r", PATH: `${bin}:${process.env.PATH}`, RETRY_SLEEP: "0", ...extra });
  const head = (c: string) => sh(c, "git rev-parse HEAD").stdout.trim();
  return { dir, origin, bot, worker, run, head, sh };
}

test("regen bot: a test-only push on top of a stale generated/ is regenerated, whatever paths changed", () => {
  const r = rig();
  // the worker changed the manifest earlier and now pushes only a test file; generated/ is stale
  sh(r.worker, "echo two > manifests/m.txt && echo t > tests.txt && git add -A && git commit -q -m 'manifest and test' && git push -q origin build/x");
  sh(r.bot, "git pull -q origin build/x");
  sh(r.worker, "echo t2 >> tests.txt && git add -A && git commit -q -m 'test only' && git push -q origin build/x");
  sh(r.bot, "git pull -q origin build/x");
  const out = r.run({ BEFORE: r.head(r.bot) });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /committed generated files/);
  assert.equal(sh(r.origin, "git show build/x:generated/m.txt").stdout, "TWO");
  assert.match(fs.readFileSync(path.join(r.dir, "gh.log"), "utf8"), /workflow run check\.yml --ref build\/x/);
});

test("regen bot: a push that raced it is not lost: the bot regenerates on the new head and pushes again", () => {
  const r = rig();
  sh(r.worker, "echo two > manifests/m.txt && git add -A && git commit -q -m manifest && git push -q origin build/x");
  sh(r.bot, "git pull -q origin build/x");
  const out = r.run({ RACE_DIR: r.worker, BEFORE: "0000000000000000000000000000000000000000" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /push rejected \(the branch moved\); retrying/);
  const log = sh(r.origin, "git log --format=%s build/x").stdout;
  assert.match(log, /worker race/, "the worker's commit survives");
  assert.match(log, /chore\(gen\): regenerate/, "the bot's commit lands on top of it");
  assert.equal(sh(r.origin, "git show build/x:generated/m.txt").stdout, "TWO");
});

test("regen bot: nothing stale and no contract path changed means nothing to push and nothing to rerun", () => {
  const r = rig();
  sh(r.worker, "echo t > tests.txt && git add -A && git commit -q -m test && git push -q origin build/x");
  sh(r.bot, "git pull -q origin build/x");
  const before = sh(r.bot, "git rev-parse HEAD~1").stdout.trim();
  const out = r.run({ BEFORE: before });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /nothing to rerun/);
  assert.ok(!fs.existsSync(path.join(r.dir, "gh.log")), "no dispatch");
});
