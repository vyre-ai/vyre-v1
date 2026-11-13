// Round 8 of the installer: backup names and pruning by kind, and the copy-off hint on a Mac. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SERVER, tmp, SAME, sh, world, MAC_ENV, mkSpace } from "./install.round8-kit.test.ts";
import type { Out } from "./install.round8-kit.test.ts";

test("two backups in the same second get two names, and many manual backups never push out the newest backups taken before an update or a restore; what goes is named", () => {
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
    assert.equal(left.filter((n) => n.startsWith("vyre-manual-")).length, 3, left.join(" "));
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
    assert.match(last.stdout, /^  Removed an older backup: vyre-manual-\S+\.tar\.gz$/m, "what goes is named");
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
