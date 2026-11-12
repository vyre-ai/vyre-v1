// Round 8 of the installer: a failed update names the damaged database and the restore command; restore over damaged data. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  SERVER,
  read,
  tmp,
  esc,
  SAME,
  sh,
  world,
  db,
  mkSpace,
  valueIn,
  releases,
  updateWorld,
  runUpdate,
  withFetchStub,
} from "./install.round8-kit.test.ts";

test("when neither version comes back, the update names the damaged database and prints the restore command for the backup it took, and what that loses; it restores nothing itself", () => {
  const dir = tmp();
  try {
    const text = read(SERVER);
    const env = updateWorld(dir, world(dir, { running: true, ...SAME }));
    const neverHealthy = text.replace(
      /^check_quiet\(\) \{/m,
      () => "check_quiet() { return 1; }\ncheck_quiet_unused() {",
    );
    releases(dir, { old: withFetchStub(text), new: neverHealthy });
    fs.writeFileSync(
      path.join(dir, "server.log"),
      "vyred-1  | vyred: modules.db is damaged (database disk image is malformed), so the Space cannot start. It is not repaired here. Put back the last good backup on the server: vyre-server restore <backup file> --yes\n",
    );
    const r = runUpdate(dir, env);
    assert.equal(r.status, 5, r.stderr + r.stdout);
    const backup = r.stdout.match(/Backed up to (\S+) while the server kept running/)![1]!;
    assert.match(
      r.stderr,
      /the update to 1\.1\.0 failed \(the new version did not pass its health check\) and the server did not come back healthy on 1\.0\.0 either\./,
    );
    assert.match(r.stderr, /The server says: vyred: modules\.db is damaged/);
    assert.match(r.stderr, new RegExp(`The database ${esc(path.join(dir, "data", "space", "modules.db"))} is damaged`));
    assert.match(
      r.stderr,
      new RegExp(
        `To put back the data from just before this update, run:\\n    vyre-server restore ${esc(backup)} --yes\\n`,
      ),
    );
    assert.match(
      r.stderr,
      /It loses what the Space wrote after that backup, which was taken moments before the server stopped for the switch\./,
    );
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "U", "nothing was restored automatically");
    assert.ok(fs.existsSync(backup), "the backup is there to restore");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("restore goes through when the current data is damaged: the damaged folder is kept aside under a dated name instead of refusing", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "GOOD");
    const env = world(dir, SAME);
    const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, env);
    assert.equal(mk.status, 0, mk.stderr);
    const file = mk.stdout.trim().split("\n").pop()!;
    // the live modules.db is now damaged: it will not snapshot
    db(path.join(dir, "data/space/events.db"), "INSERT INTO t VALUES ('AFTER')");
    const m = path.join(dir, "data/space/modules.db");
    const b = fs.readFileSync(m);
    for (let i = 4096; i < b.length; i++) b[i] = (i * 37) & 0xff;
    fs.writeFileSync(m, b);
    const r = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; dc(){ echo "dc $*" >>"${dir}/dc.log"; }; wait_healthy(){ return 0; }; sleep(){ :; }; trap cleanup EXIT; cmd_restore "${file}" --yes`,
      env,
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(
      r.stdout,
      /The current data would not back up \(a database in it is damaged or unreadable\)\. It is kept whole beside the restored data instead, under a dated name\./,
    );
    const aside = fs.readdirSync(path.join(dir, "data")).filter((n) => /^space\.damaged-\d{8}T\d{6}Z$/.test(n));
    assert.equal(aside.length, 1, `kept aside: ${fs.readdirSync(path.join(dir, "data")).join(" ")}`);
    assert.match(
      r.stdout,
      new RegExp(`The damaged data it replaced is kept in ${esc(path.join(dir, "data", aside[0]!))}`),
    );
    assert.equal(valueIn(path.join(dir, "data/space/events.db")), "GOOD", "the backup is in place");
    assert.equal(
      spawnSync("grep", ["-c", "AFTER", path.join(dir, "data", aside[0]!, "events.db")], {
        encoding: "utf8",
      }).stdout.trim() !== "0",
      true,
      "the damaged folder is whole",
    );
    assert.deepEqual(
      read(path.join(dir, "dc.log")).trim().split("\n"),
      ["dc stop", "dc up -d --remove-orphans"],
      "stopped once, and started only on the restored data, never on the damaged data in between",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
