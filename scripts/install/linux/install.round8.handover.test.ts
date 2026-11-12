// Round 8 of the installer: the new release carries out its own update (the hand-over, the lock, the child). Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SERVER, read, tmp, SAME, sh, world, releases, buggyOld, updateWorld, runUpdate, withFetchStub } from "./install.round8-kit.test.ts";

test("an update is finished by the new release's own script: an old script that would die on the optional agent image pull still updates, the lock is held throughout, and nothing loops", () => {
  const dir = tmp();
  try {
    const text = read(SERVER);
    const env = updateWorld(dir, world(dir, { running: true, ...SAME }));
    // the new release's script records each run, so a loop or a hand-back would show
    const newScript = text.replace(/^set -eu$/m, () => `set -eu\necho "new ran: $* continue=\${VYRE_UPDATE_CONTINUE:-0} lockpid=$(cat "$VYRE_DIR/state/update.lock/pid" 2>/dev/null)" >>"$VYRE_DIR/new-ran.log"`);
    const oldScript = withFetchStub(buggyOld(text)).replace(/^set -eu$/m, () => `set -eu\necho "old ran: $* pid=$$" >>"$VYRE_DIR/old-ran.log"`);
    releases(dir, { old: oldScript, new: newScript });
    const r = runUpdate(dir, env);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Updated to 1\.1\.0/);
    assert.match(r.stdout, /skipped: the old agent desktop image is not available for this computer/, "the new script's own pull step ran");
    assert.equal(fs.readlinkSync(path.join(dir, "current")), "releases/1.1.0");
    const ran = read(path.join(dir, "new-ran.log")).trim().split("\n");
    assert.equal(ran.length, 1, `the new script ran once: ${ran.join(" / ")}`);
    const oldPid = read(path.join(dir, "old-ran.log")).match(/pid=(\d+)/)![1];
    assert.match(ran[0]!, new RegExp(`^new ran: update --yes --version 1\\.1\\.0 continue=1 lockpid=${oldPid}$`), "the lock taken by the first half is the one held while the second half runs");
    assert.equal(fs.existsSync(path.join(dir, "state/update.lock")), false, "and it is released at the end");
    // control: with a new release that cannot carry out an update (an older script), the old script does it all itself and dies on the pull, as rc.24 did
    fs.rmSync(path.join(dir, "new-ran.log"), { force: true });
    releases(dir, { old: oldScript, new: "#!/bin/sh\necho an old release script\n" });
    fs.rmSync(path.join(dir, "state"), { recursive: true, force: true });
    const c = runUpdate(dir, env);
    assert.notEqual(c.status, 0);
    assert.match(c.stderr, /could not pull ghcr\.io\/vyre-ai\/agent-computer/);
    assert.equal(fs.readlinkSync(path.join(dir, "current")), "releases/1.0.0", "nothing was changed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("a second half that fails leaves the server on the old version and healthy, and a second half that dies is put back by the first", () => {
  const dir = tmp();
  try {
    const text = read(SERVER);
    const env = updateWorld(dir, world(dir, { running: true, ...SAME }));
    // the new version never becomes healthy: its health check fails until it is switched back
    const newScript = text.replace(/^check_quiet\(\) \{/m, () => `check_quiet() { [ "$(cur_version)" != 1.1.0 ] || return 1; check_quiet_real; }\ncheck_quiet_real() {`);
    releases(dir, { old: withFetchStub(text), new: newScript });
    fs.writeFileSync(path.join(dir, "server.log"), "vyred-1  | vyred 1.1.0 starting\nvyred-1  | vyred: the gateway did not start on 0.0.0.0:8420: listen EADDRINUSE\n");
    const r = runUpdate(dir, env);
    assert.equal(r.status, 4, r.stderr + r.stdout);
    assert.equal(fs.readlinkSync(path.join(dir, "current")), "releases/1.0.0", "back on the old version");
    assert.match(r.stderr, /the server is back on 1\.0\.0/);
    assert.match(r.stdout, /^  The new version said: vyred: the gateway did not start on 0\.0\.0\.0:8420: listen EADDRINUSE$/m, "the reason, in one plain line, before going back");
    assert.match(read(path.join(dir, "state/update-1.1.0-failed.log")), /listen EADDRINUSE/, "its last log lines are kept");
    // a second half that dies after stopping the server: the first half starts the old version again
    const dying = text.replace(/^  prev_link=\$\(readlink "\$DIR\/current"\)$/m, () => "  exit 9");
    assert.notEqual(dying, text);
    releases(dir, { old: withFetchStub(text), new: dying });
    fs.rmSync(path.join(dir, "docker.log"), { force: true });
    const d = runUpdate(dir, env);
    assert.equal(d.status, 9, d.stderr + d.stdout);
    assert.match(d.stderr, /the new release's updater stopped before it finished \(exit 9\); the server was started again on 1\.0\.0/);
    const log = read(path.join(dir, "docker.log"));
    assert.ok(log.lastIndexOf(" stop") < log.lastIndexOf(" up -d"), "started again after the stop");
    assert.equal(fs.readlinkSync(path.join(dir, "current")), "releases/1.0.0");
    assert.equal(fs.existsSync(path.join(dir, "state/update.lock")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("the update lock stays held while the second half runs, even when the first half was killed alone", () => {
  const dir = tmp();
  try {
    const lock = path.join(dir, "state", "update.lock");
    fs.mkdirSync(lock, { recursive: true });
    const gone = spawnSync("sh", ["-c", "sh -c 'echo $$' "], { encoding: "utf8" }).stdout.trim();
    const kid = spawn("sleep", ["30"]);
    try {
      fs.writeFileSync(path.join(lock, "pid"), `${gone}\n`);
      fs.writeFileSync(path.join(lock, "child"), `${kid.pid}\n`);
      const held = sh(SERVER, `trap cleanup EXIT; lock_update_operation; echo took`, { VYRE_DIR: dir });
      assert.equal(held.status, 75, held.stdout + held.stderr);
      assert.ok(fs.existsSync(path.join(lock, "child")), "the live second half keeps its lock");
    } finally { kid.kill(); }
    fs.writeFileSync(path.join(lock, "child"), `${gone}\n`);
    const free = sh(SERVER, `trap cleanup EXIT; lock_update_operation; echo took`, { VYRE_DIR: dir });
    assert.equal(free.status, 0, free.stderr);
    assert.match(free.stdout, /took/, "both halves gone: the lock is taken back");
    assert.equal(fs.existsSync(lock), false, "and released at the end, child file and all");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("the second half runs even when the first half was sourced (VYRE_SOURCE_ONLY=1 in its environment), and a child that ends without switching is a failed update", () => {
  const dir = tmp();
  try {
    const text = read(SERVER);
    const env = updateWorld(dir, world(dir, { running: true, ...SAME }));
    releases(dir, { old: text, new: text });
    const r = sh(SERVER, `fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; trap cleanup EXIT; cmd_update --yes --version 1.1.0`, { ...env, VYRE_TEST_OS: "Linux" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Updated to 1\.1\.0/, "the child did the update");
    // a "new release" whose script stops at once with 0 but carries the marker
    releases(dir, { old: text, new: "#!/bin/sh\n# VYRE_UPDATE_CONTINUE (claims to finish, does nothing)\nexit 0\n" });
    fs.rmSync(path.join(dir, "state"), { recursive: true, force: true });
    const f = sh(SERVER, `fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; trap cleanup EXIT; cmd_update --yes --version 1.1.0`, { ...env, VYRE_TEST_OS: "Linux" });
    assert.equal(f.status, 1, f.stderr + f.stdout);
    assert.match(f.stderr, /the new release's updater ended without installing 1\.1\.0/);
    assert.equal(fs.readlinkSync(path.join(dir, "current")), "releases/1.0.0");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
