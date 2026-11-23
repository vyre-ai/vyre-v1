// Round 8 of the installer: backup names and pruning by kind, and the copy-off hint on a Mac. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SERVER, tmp, SAME, sh, world, MAC_ENV, mkSpace } from "./install.round8-kit.test.ts";
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
      new RegExp(`device: "${path.join(dir, "backups").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m"),
      "the host folder is the bind source",
    );
    assert.match(txt, /- vyre-backups-\d+:\/backups/, "mounted at /backups");
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
test("compose.backups.yml survives a hard folder name, and when the folder or the file cannot be made the server still starts without the mount, saying so", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "Q");
    const env = world(dir, SAME);
    const f = path.join(dir, "compose.backups.yml");
    // a name with a space, comma, colon, hash, brace and both kinds of quote and a backslash: written as one quoted string
    const hard = path.join(dir, 'My Backups, 2: #{x} "q" b\\s');
    const r = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; BACKUP_DIR='${hard.replace(/'/g, "'\\''")}'; ensure_backups_compose`,
      env,
    );
    assert.equal(r.status, 0, r.stderr);
    const want = hard.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    assert.ok(fs.readFileSync(f, "utf8").split("\n").includes(`      device: "${want}"`), fs.readFileSync(f, "utf8"));
    assert.ok(fs.statSync(hard).isDirectory());
    // the folder cannot be made (its parent is a file): no file, no -f, one line saying why, and compose is called without it (a fake docker that refuses a missing -f file)
    fs.writeFileSync(path.join(dir, "notadir"), "x");
    const body = `DATA_DIR="${dir}/data"; BACKUP_DIR="${dir}/notadir/backups"; docker(){ for a in "$@"; do case "$a" in */compose.backups.yml) [ -f "$a" ] || { echo "no such file: $a"; return 14; } ; echo "used $a" ;; esac; done; echo "compose ok"; }; dc config`;
    const noDir = sh(SERVER, body, env);
    assert.equal(noDir.status, 0, noDir.stdout + noDir.stderr);
    assert.doesNotMatch(noDir.stdout, /used /);
    assert.match(noDir.stdout, /compose ok/);
    assert.match(
      noDir.stderr,
      /backups folder .* does not exist and could not be made, so the server starts without it mounted/,
    );
    assert.ok(!fs.existsSync(f), "a stale file from an earlier start is removed");
    // the file cannot be written (a directory sits where it is first written): same, and the old file is not passed
    fs.writeFileSync(f, "stale");
    fs.mkdirSync(`${f}.new`);
    const noFile = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; BACKUP_DIR="${dir}/backups"; docker(){ for a in "$@"; do case "$a" in */compose.backups.yml) echo "used $a" ;; esac; done; echo "compose ok"; }; dc config`,
      env,
    );
    assert.equal(noFile.status, 0, noFile.stdout + noFile.stderr);
    assert.doesNotMatch(noFile.stdout, /used /);
    assert.match(
      noFile.stderr,
      /could not write .*compose\.backups\.yml, so the server starts without the backups folder mounted/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("mode and owner are set only on a backups folder the command made: a folder an admin pointed at is left as it is, with a warning when the server user cannot write it", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "O");
    const env = world(dir, SAME);
    const mode = (p: string): number => fs.statSync(p).mode & 0o777;
    // the default folder is the command's own: made, and 0700
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; ensure_backups_compose`, env).status, 0);
    assert.equal(mode(path.join(dir, "backups")), 0o700);
    // a folder named in backup-dir that does not exist yet is made by the command: 0700
    const fresh = path.join(dir, "elsewhere", "mine");
    const made = sh(SERVER, `DATA_DIR="${dir}/data"; BACKUP_DIR='${fresh}'; ensure_backups_compose`, env);
    assert.equal(made.status, 0, made.stderr);
    assert.equal(mode(fresh), 0o700, "a folder it just made is closed to others");
    assert.doesNotMatch(made.stderr, /left as it is/);
    // a folder that already exists and is not the default: mode untouched, on a compose call and on a backup
    const shared = path.join(dir, "shared");
    fs.mkdirSync(shared);
    fs.chmodSync(shared, 0o775);
    const kept = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; BACKUP_DIR='${shared}'; ensure_backups_compose; ensure_backups_compose`,
      env,
    );
    assert.equal(kept.status, 0, kept.stderr);
    assert.equal(mode(shared), 0o775, "a shared folder keeps its mode");
    const bk = sh(SERVER, `DATA_DIR="${dir}/data"; BACKUP_DIR='${shared}'; dc(){ :; }; backup_data manual live`, env);
    assert.equal(bk.status, 0, bk.stderr + bk.stdout);
    assert.equal(mode(shared), 0o775, "a backup does not close it either");
    assert.ok(fs.existsSync(path.join(dir, "compose.backups.yml")), "it is still mounted");
    // one that the server user cannot write: left as it is, one warning (skipped as root, who can write anything)
    if (process.getuid && process.getuid() !== 0) {
      const ro = path.join(dir, "readonly");
      fs.mkdirSync(ro);
      fs.chmodSync(ro, 0o555);
      const w = sh(
        SERVER,
        `DATA_DIR="${dir}/data"; BACKUP_DIR='${ro}'; ensure_backups_compose; ensure_backups_compose`,
        env,
      );
      assert.equal(w.status, 0, w.stderr);
      assert.equal(mode(ro), 0o555);
      assert.equal(w.stderr.match(/already exists and is left as it is/g)?.length, 1, "said once: " + w.stderr);
      fs.chmodSync(ro, 0o755);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("the backups folder is given to uid 1000 on Linux when run as root, and never on a Mac, where the folder stays the person's own", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "C");
    const asRoot = `id(){ if [ "$1" = -u ]; then echo 0; else command id "$@"; fi; }; `;
    const run = (osName: string): string => {
      fs.rmSync(path.join(dir, "host.log"), { force: true });
      fs.rmSync(path.join(dir, "backups"), { recursive: true, force: true });
      const r = sh(SERVER, `${asRoot}DATA_DIR="${dir}/data"; ensure_backups_compose`, {
        ...world(dir, SAME),
        VYRE_TEST_OS: osName,
      });
      assert.equal(r.status, 0, r.stderr);
      return fs.existsSync(path.join(dir, "host.log")) ? fs.readFileSync(path.join(dir, "host.log"), "utf8") : "";
    };
    assert.match(run("Linux"), /^chown 1000:1000 \S+\/backups$/m, "Linux: the server's user owns the folder it made");
    assert.doesNotMatch(run("Darwin"), /^chown/m, "a Mac: no chown");
    // the backup file itself follows the same rule
    const take = (osName: string): string => {
      fs.rmSync(path.join(dir, "host.log"), { force: true });
      const r = sh(SERVER, `${asRoot}DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, {
        ...world(dir, SAME),
        VYRE_TEST_OS: osName,
      });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      return fs.readFileSync(path.join(dir, "host.log"), "utf8");
    };
    assert.match(
      take("Linux"),
      /^chown 1000:1000 \S+vyre-manual-\S+\.tar\.gz$/m,
      "Linux: the backup is the server user's to read",
    );
    assert.doesNotMatch(take("Darwin"), /^chown/m, "a Mac: the backup file is not chowned either");
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
