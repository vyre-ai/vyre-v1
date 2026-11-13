// Round 8 of the installer: a rolled-back version is not tried again, and its pre-update backup is kept until an update succeeds. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SERVER, read, tmp, SAME, sh, world, db, mkSpace, releases } from "./install.round8-kit.test.ts";
import type { Out } from "./install.round8-kit.test.ts";

test("three nights after a rolled-back update: the version is not tried again (one plain line, and doctor says so), no new pre-update backup is taken, and the backup from before the failure outlives any number of manual ones until an update succeeds", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "BEFORE");
    releases(dir);
    for (const v of ["1.2.0"]) {
      const rel = path.join(dir, "releases", v);
      fs.mkdirSync(rel, { recursive: true });
      fs.writeFileSync(path.join(rel, "VERSION"), v);
      fs.writeFileSync(path.join(rel, ".complete"), "");
      fs.writeFileSync(path.join(rel, "images.lock"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${"3".repeat(64)}\n`);
    }
    const env = { ...world(dir, { running: true, ...SAME }), TMPDIR: dir };
    // 1.1.0 never becomes healthy here; the release running before it does
    const night = (offered: string, extra = ""): Out =>
      sh(
        SERVER,
        `DATA_DIR="${dir}/data"; fetch_release(){ REL_VERSION=${offered}; }; unpack_release(){ :; }; dc(){ :; }; prune_images(){ :; }; server_said(){ :; }; wait_healthy(){ [ "$(cur_version)" != 1.1.0 ]; }; trap cleanup EXIT; cmd_update --yes ${extra}`,
        env,
      );
    const n1 = night("1.1.0");
    assert.equal(n1.status, 4, n1.stderr + n1.stdout);
    const kept = n1.stdout.match(/Backed up to (\S+) while/)![1]!;
    assert.equal(read(path.join(dir, "state/keep-backup")).trim(), kept);
    db(path.join(dir, "data/space/events.db"), "INSERT INTO t VALUES ('WRITTEN-BY-THE-FAILED-VERSION')");
    const pre = (): string[] => fs.readdirSync(path.join(dir, "backups")).filter((n) => n.startsWith("vyre-pre-"));
    for (const n of [2, 3]) {
      const r = night("1.1.0");
      assert.equal(r.status, 0, `night ${n}: ${r.stderr}`);
      assert.match(
        r.stdout,
        /^1\.1\.0 did not start here and was rolled back on \d{1,2} [A-Z][a-z]{2}\. It will not be tried again; the next release will\.$/m,
        `night ${n}`,
      );
      assert.doesNotMatch(r.stdout, /Backed up/, `night ${n}: no new backup`);
      assert.deepEqual(pre(), [path.basename(kept)], `night ${n}: only the backup from before the failure`);
    }
    const doc = sh(SERVER, `DATA_DIR="${dir}/data"; check_all; printf '%s\\n' "$FINDINGS"`, env);
    assert.match(doc.stdout, /host\.update\tdegraded\t1\.1\.0 did not start here and was rolled back on /);
    // any number of manual backups never push it out
    for (let i = 0; i < 6; i++)
      assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, env).status, 0);
    assert.ok(fs.existsSync(kept), "the backup from before the failure is still there");
    // a newer release that works: the hold on that backup ends, and normal pruning applies again
    const ok = night("1.2.0");
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.match(ok.stdout, /Updated to 1\.2\.0/);
    assert.equal(fs.existsSync(path.join(dir, "state/keep-backup")), false);
    assert.doesNotMatch(
      sh(SERVER, `DATA_DIR="${dir}/data"; check_all; printf '%s\\n' "$FINDINGS"`, env).stdout,
      /host\.update\t/,
      "doctor no longer mentions it",
    );
    // naming the version on purpose tries it once more
    fs.rmSync(path.join(dir, "current"));
    fs.symlinkSync("releases/1.0.0", path.join(dir, "current"));
    assert.doesNotMatch(night("1.1.0", "--version 1.1.0").stdout, /will not be tried again/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
