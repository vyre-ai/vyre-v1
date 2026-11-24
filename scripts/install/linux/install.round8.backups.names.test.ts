// Round 8 of the installer: backup names and pruning by kind. Fixtures: install.round8-kit.test.ts. Split from install.round8.backups.test.ts (24 Nov 2026): this one test runs sixteen backups in a row and took 13 s of the old
// file's 15 s on a quiet box, 30 s on a hosted runner, which is the fast runner's cap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SERVER, tmp, SAME, sh, world, mkSpace } from "./install.round8-kit.test.ts";
import type { Out } from "./install.round8-kit.test.ts";

test("two backups in the same second get two names; a manual backup is never removed; what goes is named; the newest backups taken before an update or a restore stay", () => {
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
    for (const n of names())
      assert.equal(
        fs.statSync(path.join(dir, "backups", n)).mode & 0o777,
        0o600,
        "a backup holds the Space and its keys: owner only",
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
    fs.writeFileSync(path.join(dir, "backups", "vyre-restored-by-hand.tar.gz"), "x");
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, env).status, 0);
    assert.ok(names().includes("vyre-restored-by-hand.tar.gz"), "a name the script does not know is left alone");
    // the kinds keep their own few: a third backup before an update pushes out only the oldest of that kind
    let pruned: Out = a;
    for (const v of ["1.2.0", "1.3.0"])
      pruned = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data pre-${v} live`, env);
    assert.match(pruned.stdout, /^ {2}Removed an older backup: vyre-pre-1\.1\.0-\S+\.tar\.gz$/m, "what goes is named");
    const pre = names().filter((n) => /^vyre-pre-\d/.test(n));
    assert.equal(pre.length, 2, pre.join(" "));
    assert.ok(!pre.some((n) => n.startsWith("vyre-pre-1.1.0-")), "the oldest pre-update backup went first");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
