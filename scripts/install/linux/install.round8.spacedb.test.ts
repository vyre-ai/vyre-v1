// Round 8 of the installer: the backups read the live databases through the VM on a Mac, the installers ask through it, and nothing else on a Mac opens one. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SERVER, INSTALL, MAC, read, tmp, esc, sh, world, MAC_ENV, db, mkSpace, valueIn, hostTouches, releases } from "./install.round8-kit.test.ts";

test("on a Mac the backup reads the live databases from inside the virtual machine: docker exec into the running vyred, never the Mac's sqlite3 or node", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "LIVE");
    const env = { ...world(dir, { running: true }), ...MAC_ENV };
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live; echo "$BACKUP_FILE"`, env);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(hostTouches(dir), [], "no host tool opened a live database");
    assert.match(read(path.join(dir, "docker.log")), /^docker exec cid1 node --no-warnings -e .* \/data\/events\.db$/m, "the writer's own container read it");
    const file = r.stdout.trim().split("\n").pop()!;
    const out = path.join(dir, "out");
    fs.mkdirSync(out);
    assert.equal(spawnSync("tar", ["-xzf", file, "-C", out]).status, 0);
    for (const n of ["events.db", "modules.db", "space.db"]) assert.equal(valueIn(path.join(out, "space", n)), "LIVE", `${n} is in the backup`);
    const listing = spawnSync("tar", ["-tvzf", file], { encoding: "utf8" }).stdout;
    assert.doesNotMatch(listing, /^[-d]......rw/m, "nothing in the backup is world-writable");
    assert.equal(fs.statSync(file).mode & 0o077, 0, "the backup file is the owner's alone");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("on a Mac with the server stopped the backup reads through the server image (docker run, no network), and with neither container nor image it fails plainly and changes nothing", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "COLD");
    const env = { ...world(dir, { running: false }), ...MAC_ENV };
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live; echo "$BACKUP_FILE"`, env);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(hostTouches(dir), []);
    assert.match(read(path.join(dir, "docker.log")), new RegExp(`^docker run --rm --network none --user 1000:1000 -v ${esc(path.join(dir, "data", "space"))}:/data --entrypoint node ghcr\\.io/vyre-ai/vyred@sha256:b+ --no-warnings -e .* /data/events\\.db$`, "m"));
    assert.doesNotMatch(read(path.join(dir, "docker.log")), /:\/out/, "no folder of the host is opened to the container for writing the copy");
    // no container and no image: the backup fails with one plain line; the earlier backup stays, no partial one is left
    const before = fs.readdirSync(path.join(dir, "backups")).sort();
    fs.rmSync(path.join(dir, "host.log"), { force: true });
    const env2 = { ...world(dir, { running: false, image: false }), ...MAC_ENV };
    const f = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, env2);
    assert.notEqual(f.status, 0);
    assert.match(f.stderr, /the server runs in a virtual machine on this computer, so its databases are read only from inside it, and neither the server's container nor its image is there/);
    assert.match(f.stderr, /nothing was changed/);
    assert.deepEqual(hostTouches(dir), [], "never a host tool as a fallback");
    assert.deepEqual(fs.readdirSync(path.join(dir, "backups")).sort(), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("on a Mac an update, a restore, doctor, start and status never open a live database with a host tool", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "OLD");
    releases(dir);
    const env = { ...world(dir, { running: true }), ...MAC_ENV, TMPDIR: dir };
    // the update: its backup and its sync of the image lines (which asks the Space whether it serves its own domain)
    const up = sh(SERVER, `DATA_DIR="${dir}/data"; fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; dc(){ echo "dc $*" >>"${dir}/dc.log"; }; wait_healthy(){ return 0; }; prune_releases(){ :; }; prune_images(){ :; }; trap cleanup EXIT; cmd_update --yes --version 1.1.0`, env);
    assert.equal(up.status, 0, up.stderr + up.stdout);
    assert.deepEqual(hostTouches(dir), [], "update");
    assert.match(read(path.join(dir, "compose.env")), /^VYRE_BIND=127\.0\.0\.1$/m, "the Space's answer (relay) was read, through the VM");
    // a restore of that backup (the current data is backed up first, with the server stopped)
    const file = up.stdout.match(/Backed up to (\S+)/)![1]!;
    const rs = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ case "$*" in stop*) rm -f "${dir}/running" ;; up*) : >"${dir}/running" ;; esac; }; wait_healthy(){ return 0; }; trap cleanup EXIT; cmd_restore "${file}" --yes`, env);
    assert.equal(rs.status, 0, rs.stderr);
    assert.deepEqual(hostTouches(dir), [], "restore");
    assert.doesNotMatch(read(path.join(dir, "host.log")), /^chown/m, "a Mac shares the folder under the person's own account: no chown (which a person cannot do)");
    // doctor, start, status
    for (const cmd of ["cmd_doctor --quiet || :", "cmd_start || :", "cmd_status || :"]) {
      const r = sh(SERVER, `DATA_DIR="${dir}/data"; ${cmd}`, { ...env, VYRE_TEST_DISKUTIL: "/bin/false" });
      assert.ok(r.status === 0, `${cmd}: ${r.stderr}`);
      assert.deepEqual(hostTouches(dir), [], cmd);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("both installers ask the Space whether it serves its own domain through the VM on a Mac, and the database rule is the same text in all three scripts", () => {
  for (const script of [INSTALL, MAC]) {
    const dir = tmp();
    try {
      mkSpace(dir, "X");
      db(path.join(dir, "data/space/modules.db"), "UPDATE network_config SET mode = 'own_domain'");
      fs.mkdirSync(path.join(dir, "releases/1.0.0"), { recursive: true });
      fs.writeFileSync(path.join(dir, "releases/1.0.0/images.lock"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${"b".repeat(64)}\n`);
      const env = { ...world(dir, { running: true }), ...MAC_ENV };
      fs.writeFileSync(path.join(dir, "compose.env"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${"b".repeat(64)}\nVYRE_BIND=127.0.0.1\n`);
      const r = sh(script, `DIR="${dir}"; DATA_DIR="${dir}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN=""; RELAY=""; DRY=0; UPDATE_URL=https://vyre.run/server/; ENC_KIND=plain; write_config`, env);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(hostTouches(dir), [], script);
      assert.match(read(path.join(dir, "docker.log")), /^docker exec cid1 node --no-warnings -e .* \/data\/modules\.db /m, script);
      assert.doesNotMatch(read(path.join(dir, "compose.env")), /VYRE_BIND/, `${script}: the definite answer (own domain) was followed`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const block = (f: string): string => { const t = read(f); const a = t.indexOf("# BEGIN spacedb"); const b = t.indexOf("# END spacedb"); assert.ok(a >= 0 && b > a, `${f} has the spacedb block`); return t.slice(a, b); };
  assert.equal(block(INSTALL), block(SERVER), "the Linux installer");
  assert.equal(block(MAC), block(SERVER), "the Mac installer");
});
