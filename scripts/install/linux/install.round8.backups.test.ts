// Round 8 of the installer: backup names and pruning by kind, and the copy-off hint on a Mac. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SERVER, tmp, SAME, sh, world, MAC_ENV, mkSpace } from "./install.round8-kit.test.ts";
import type { Out } from "./install.round8-kit.test.ts";

test("two backups in the same second get two names; a manual backup is never removed; scheduled ones keep 3 and what goes is named; the newest backups taken before an update or a restore stay", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "P");
    const env = world(dir, SAME);
    const take = (tag: string): Out =>
      sh(
        SERVER,
        `DATA_DIR="${dir}/data"; dc(){ :; }; date(){ case "$*" in *%Y%m%dT*) echo 20261112T004605Z ;; *) command date "$@" ;; esac; }; backup_data ${tag} live; echo "$BACKUP_FILE"`,
        env,
      );
    const names = (): string[] =>
      fs
        .readdirSync(path.join(dir, "backups"))
        .filter((n) => n.endsWith(".tar.gz"))
        .sort();
    const a = take("manual"),
      b = take("manual");
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    assert.deepEqual(
      names(),
      ["vyre-manual-20261112T004605Z-2.tar.gz", "vyre-manual-20261112T004605Z.tar.gz"],
      "the second did not replace the first",
    );
    for (const n of names()) fs.rmSync(path.join(dir, "backups", n));
    // one before an update, one before a restore, then twelve manual ones
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data pre-1.1.0 live`, env).status, 0);
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data pre-restore live`, env).status, 0);
    let last: Out = a;
    for (let i = 0; i < 12; i++) last = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, env);
    const left = names();
    assert.equal(
      left.filter((n) => n.startsWith("vyre-manual-")).length,
      12,
      "no manual backup was removed: " + left.join(" "),
    );
    assert.equal(
      left.filter((n) => n.startsWith("vyre-pre-1.1.0-")).length,
      1,
      "the backup from before the update stays",
    );
    assert.equal(
      left.filter((n) => n.startsWith("vyre-pre-restore-")).length,
      1,
      "the backup from before the restore stays",
    );
    assert.doesNotMatch(
      last.stdout,
      /Removed an older backup: vyre-manual-/,
      "a manual backup is never named as removed",
    );
    assert.match(
      last.stdout,
      /Manual backups are never removed by this command: 12 of them take \d+ MB/,
      "the pile of manual backups is said, not pruned",
    );
    // scheduled backups keep 3, and what goes is named
    let sched: Out = a;
    for (let i = 0; i < 5; i++)
      sched = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data scheduled live`, env);
    assert.equal(names().filter((n) => n.startsWith("vyre-scheduled-")).length, 3, names().join(" "));
    assert.match(sched.stdout, /^  Removed an older backup: vyre-scheduled-\S+\.tar\.gz$/m, "what goes is named");
    fs.writeFileSync(path.join(dir, "backups", "vyre-restored-by-hand.tar.gz"), "x");
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data scheduled live`, env).status, 0);
    assert.ok(names().includes("vyre-restored-by-hand.tar.gz"), "a name the script does not know is left alone");
    // the kinds keep their own few: a third backup before an update pushes out only the oldest of that kind
    for (const v of ["1.2.0", "1.3.0"])
      assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data pre-${v} live`, env).status, 0);
    const pre = names().filter((n) => /^vyre-pre-\d/.test(n));
    assert.equal(pre.length, 2, pre.join(" "));
    assert.ok(!pre.some((n) => n.startsWith("vyre-pre-1.1.0-")), "the oldest pre-update backup went first");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("the backups folder is mounted into the server: compose.backups.yml names it, is rewritten only when it changes, and every compose call includes it", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "M");
    const env = world(dir, SAME);
    const f = path.join(dir, "compose.backups.yml");
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; ensure_backups_compose`, env);
    assert.equal(r.status, 0, r.stderr);
    const txt = fs.readFileSync(f, "utf8");
    assert.match(
      txt,
      new RegExp(`device: ${path.join(dir, "backups").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} }`),
      "the host folder is the bind source",
    );
    assert.match(txt, /- vyre-backups:\/backups/, "mounted at /backups");
    assert.match(txt, /VYRE_BACKUP_DIR: \/backups/, "the server is told where");
    const t0 = fs.statSync(f).mtimeMs;
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; ensure_backups_compose`, env).status, 0);
    assert.equal(fs.statSync(f).mtimeMs, t0, "unchanged, so not rewritten");
    assert.ok(fs.statSync(path.join(dir, "backups")).isDirectory());
    // dc hands compose the file after the override
    const calls = sh(SERVER, `DATA_DIR="${dir}/data"; docker(){ printf '%s\\n' "$*"; }; dc config`, env);
    assert.match(calls.stdout, /-f \S+\/compose\.override\.yml -f \S+\/compose\.backups\.yml config/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("the copy-off hint on a Mac names the file and says to take it off this Mac, never root@", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "H");
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; cmd_backup`, {
      ...world(dir, { running: true }),
      ...MAC_ENV,
      VYRE_TEST_FS_DEVICE: `${dir}=/dev/disk3s1`,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /Copy this file off this Mac \(an external disk, or another computer\):\n    \S+\/backups\/vyre-manual-\S+\.tar\.gz$/m,
    );
    assert.doesNotMatch(r.stdout, /root@/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
