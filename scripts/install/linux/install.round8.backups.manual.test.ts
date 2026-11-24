// Round 8 of the installer: twelve manual backups never evict the newest backups taken before an update or a restore (12 Nov: twelve manual backups once evicted the only good copy from before a failed update),
// and a manual backup is never removed or named as removed. Fixtures: install.round8-kit.test.ts. Split from the longer test in install.round8.backups.names.test.ts (24 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SERVER,
  tmp,
  SAME,
  sh,
  world,
  mkSpace,
} from "./install.round8-kit.test.ts";
import type { Out } from "./install.round8-kit.test.ts";

const take = (dir: string, env: ReturnType<typeof world>, tag: string): Out =>
  sh(
    SERVER,
    `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data ${tag} live`,
    env,
  );
const names = (dir: string): string[] =>
  fs
    .readdirSync(path.join(dir, "backups"))
    .filter((n) => n.endsWith(".tar.gz"))
    .sort();

test("a manual backup is never removed; the newest backups taken before an update or a restore stay; the pile of manual backups is said, not pruned; a name the script does not know is left alone", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "M");
    const env = world(dir, SAME);
    // one before an update, one before a restore, then twelve manual ones; a name the script does not know sits in the folder from the start, so every one of the twelve prunes beside it
    assert.equal(take(dir, env, "pre-1.1.0").status, 0);
    assert.equal(take(dir, env, "pre-restore").status, 0);
    fs.writeFileSync(
      path.join(dir, "backups", "vyre-restored-by-hand.tar.gz"),
      "x",
    );
    // twelve manual backups in one shell: the same twelve backup_data runs, and `last` is what all of them printed, so "never named as removed" is checked on every one
    const last: Out = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; dc(){ :; }; i=0; while [ $i -lt 12 ]; do backup_data manual live || exit $?; i=$((i + 1)); done`,
      env,
    );
    assert.equal(last.status, 0, last.stderr);
    const left = names(dir);
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
    assert.ok(
      left.includes("vyre-restored-by-hand.tar.gz"),
      "a name the script does not know is left alone",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
