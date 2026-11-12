// Round 8 of the installer, real Docker: the read through a running container while it writes (VYRE_HEAVY_DOCKER=1, the heavy workflow's install-heavy job). Fixtures: install.round8-kit.test.ts. (Split from install.round8.test.ts to stay well under the fast runner's 30 s cap per file.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SERVER, read, tmp, NODE, sh, FAKE_SQLITE_JS, db, hostTouches } from "./install.round8-kit.test.ts";

const HEAVY = process.env.VYRE_HEAVY_DOCKER === "1" ? false : "set VYRE_HEAVY_DOCKER=1 on a runner with Docker and the node:24-bookworm-slim image; this check is skipped by name, not passed";
const IN_CONTAINER_WRITER = `const {DatabaseSync}=require("node:sqlite");const fs=require("node:fs");const dbs=["events.db","modules.db","space.db"].map((n)=>{const d=new DatabaseSync("/data/"+n);d.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, v TEXT)");return d});let i=0;fs.writeFileSync("/data/ready","1");setInterval(()=>{for(let k=0;k<20;k++){for(const d of dbs)d.exec("INSERT INTO t(v) VALUES ('"+"x".repeat(300)+(i++)+"')")}},5)`;

test("@heavy on a VM host the backup snapshots through docker exec into a real container that keeps writing, 5 times, and the live databases stay intact", { skip: HEAVY, timeout: 240_000 }, () => {
  const dir = tmp();
  const name = `vyre-f-macserver-r8-${process.pid}`;
  try {
    const space = path.join(dir, "data", "space");
    fs.mkdirSync(space, { recursive: true });
    fs.mkdirSync(path.join(dir, "data", "caddy"), { recursive: true });
    fs.chmodSync(space, 0o777);
    const run = spawnSync("docker", ["run", "-d", "--name", name, "--label", "com.docker.compose.service=vyred", "--label", "ai.vyre.test=f-macserver", "--user", "1000:1000", "--network", "none", "-v", `${space}:/data`, "node:24-bookworm-slim", "node", "--no-warnings", "-e", IN_CONTAINER_WRITER], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    for (let n = 0; n < 100 && !fs.existsSync(path.join(space, "ready")); n++) spawnSync("sleep", ["0.1"]);
    assert.ok(fs.existsSync(path.join(space, "ready")), "the writer in the container started");
    fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=node:24-bookworm-slim\n");
    const bin = path.join(dir, "fakebin");
    fs.mkdirSync(bin);
    // the host's own tools record every call and do the real work (the streamed copy is checked with them on this side)
    fs.writeFileSync(path.join(dir, "fake-sqlite3.js"), FAKE_SQLITE_JS);
    fs.writeFileSync(path.join(bin, "sqlite3"), `#!/bin/sh\nprintf '%s\\n' "sqlite3 $*" >>"${dir}/host.log"\nexec "${NODE}" --no-warnings "${dir}/fake-sqlite3.js" "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\nprintf '%s\\n' "node $*" >>"${dir}/host.log"\nexec "${NODE}" "$@"\n`, { mode: 0o755 });
    const realDocker = spawnSync("sh", ["-c", "command -v docker"], { encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nprintf '%s\\n' "docker $1 $2" >>"${dir}/docker.log"\nexec "${realDocker}" "$@"\n`, { mode: 0o755 });
    const check = (n: string): string => spawnSync("docker", ["exec", name, "node", "--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/data/${n}",{readOnly:true});console.log(d.prepare("PRAGMA integrity_check").get().integrity_check)`], { encoding: "utf8" }).stdout.trim();
    for (let round = 0; round < 5; round++) {
      const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live; echo "$BACKUP_FILE"`, { PATH: `${bin}:${process.env.PATH ?? ""}`, VYRE_DIR: dir, VYRE_TEST_OS: "Darwin" });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(hostTouches(dir), [], "no host tool opened a live database");
      assert.match(read(path.join(dir, "docker.log")), /^docker exec [0-9a-f]{12,}$/m, "through the running container");
      assert.doesNotMatch(read(path.join(dir, "docker.log")), /^docker run/m, "not a second container");
      const out = path.join(dir, `out${round}`);
      fs.mkdirSync(out);
      assert.equal(spawnSync("tar", ["-xzf", r.stdout.trim().split("\n").pop()!, "-C", out]).status, 0);
      for (const n of ["events.db", "modules.db", "space.db"]) {
        const rows = spawnSync(NODE, ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare("PRAGMA integrity_check").get().integrity_check+" "+d.prepare("SELECT count(*) c FROM t").get().c)`, path.join(out, "space", n)], { encoding: "utf8" }).stdout.trim();
        assert.match(rows, /^ok [1-9]\d*$/, `${n} in backup ${round}: ${rows}`);
        assert.equal(check(n), "ok", `the live ${n} after backup ${round}`);
      }
    }
  } finally {
    spawnSync("docker", ["rm", "-f", name]);
    spawnSync("docker", ["run", "--rm", "-v", `${dir}:/w`, "node:24-bookworm-slim", "chmod", "-R", "a+rwX", "/w"]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
