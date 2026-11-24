// Round 8 of the installer: backup names, and what a kind keeps. Fixtures: install.round8-kit.test.ts. These two tests, and install.round8.backups.manual.test.ts, were one test of twenty backups in a row (24 Nov 2026:
// 13 s of install.round8.backups.test.ts's 15 s on a quiet box, 30 s on a hosted runner, the fast runner's cap); each now runs a few.
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

test("two backups in the same second get two names, and a backup holds the Space and its keys: owner only", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "P");
    const env = world(dir, SAME);
    const same = (tag: string): Out =>
      sh(
        SERVER,
        `DATA_DIR="${dir}/data"; dc(){ :; }; date(){ case "$*" in *%Y%m%dT*) echo 20261112T004605Z ;; *) command date "$@" ;; esac; }; backup_data ${tag} live; echo "$BACKUP_FILE"`,
        env,
      );
    const a = same("manual"),
      b = same("manual");
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    assert.deepEqual(
      names(dir),
      [
        "vyre-manual-20261112T004605Z-2.tar.gz",
        "vyre-manual-20261112T004605Z.tar.gz",
      ],
      "the second did not replace the first",
    );
    for (const n of names(dir))
      assert.equal(
        fs.statSync(path.join(dir, "backups", n)).mode & 0o777,
        0o600,
        "a backup holds the Space and its keys: owner only",
      );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the kinds keep their own few: a third backup before an update pushes out only the oldest of that kind, and says which", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "K");
    const env = world(dir, SAME);
    assert.equal(take(dir, env, "pre-1.1.0").status, 0);
    let pruned: Out = take(dir, env, "pre-1.2.0");
    pruned = take(dir, env, "pre-1.3.0");
    assert.match(
      pruned.stdout,
      /^ {2}Removed an older backup: vyre-pre-1\.1\.0-\S+\.tar\.gz$/m,
      "what goes is named",
    );
    const pre = names(dir).filter((n) => /^vyre-pre-\d/.test(n));
    assert.equal(pre.length, 2, pre.join(" "));
    assert.ok(
      !pre.some((n) => n.startsWith("vyre-pre-1.1.0-")),
      "the oldest pre-update backup went first",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
