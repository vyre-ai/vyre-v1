// Round 8 of the installer: the kernel decision (boot id, fail safe, the one-shot answer) and the host check of the streamed copy. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SERVER, read, tmp, HOST_BOOT, SAME, sh, world, MAC_ENV, db, mkSpace, hostTouches, BOOT_FILE } from "./install.round8-kit.test.ts";

test("the kernel is told by its boot id, not its version: a VM with the same kernel version is a VM, and silence or an unreadable boot id is never 'same'", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "K");
    const ask = (env: Record<string, string>): string => sh(SERVER, `DATA_DIR="${dir}/data"; engine_same_kernel && echo same || echo vm`, env).stdout.trim();
    // the same boot id: this kernel; the backup uses the host's own tools, as before
    const same = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, world(dir, { running: true, ...SAME }));
    assert.equal(same.status, 0, same.stderr);
    assert.ok(hostTouches(dir).some((l) => /^(sqlite3 .*|node --no-warnings -e .*)VACUUM INTO/.test(l)), "this kernel: the host's own sqlite3 (or node) takes the snapshot, as before");
    assert.doesNotMatch(read(path.join(dir, "docker.log")), /docker (exec \S+ node|run .*--entrypoint node)/, "no container reads a database");
    assert.match(read(path.join(dir, "docker.log")), /^docker exec cid1 cat \/proc\/sys\/kernel\/random\/boot_id$/m, "the boot id was read in the running vyred");
    // vyred is down: the boot id is read in a one-shot container of the server image (trusted here: nothing in the Space has a -wal or -shm open)
    fs.rmSync(path.join(dir, "docker.log"));
    assert.equal(ask(world(dir, { running: false, ...SAME })), "same");
    assert.match(read(path.join(dir, "docker.log")), /^docker run --rm --network none --entrypoint cat ghcr\.io\/vyre-ai\/vyred@sha256:b+ \/proc\/sys\/kernel\/random\/boot_id$/m);
    // a VM with the same kernel version string (Colima, Lima or Multipass on the same Ubuntu kernel): another boot id, so the VM reads it
    fs.rmSync(path.join(dir, "host.log")); fs.rmSync(path.join(dir, "docker.log"));
    const vm = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, world(dir, { running: true, kernel: SAME.kernel, boot: "0f0e0d0c-another-kernel" }));
    assert.equal(vm.status, 0, vm.stderr);
    assert.deepEqual(hostTouches(dir), [], "another kernel: the VM reads it");
    assert.match(read(path.join(dir, "docker.log")), /^docker exec cid1 node/m);
    // fail safe: the engine silent, the boot id unreadable in the container, the boot id unreadable here, Docker Desktop, a Mac
    assert.equal(ask(world(dir, { running: true, kernel: "", boot: HOST_BOOT })), "vm", "an engine that does not answer");
    assert.equal(ask(world(dir, { running: true, kernel: SAME.kernel, boot: "" })), "vm", "no boot id from the engine");
    assert.equal(ask({ ...world(dir, { running: true, ...SAME }), VYRE_TEST_BOOT_ID_FILE: path.join(dir, "no-such-boot-id") }), "vm", "no boot id here");
    assert.equal(ask(world(dir, { running: true, kernel: "6.10.14-linuxkit|Docker Desktop", boot: HOST_BOOT })), "vm", "Docker Desktop");
    assert.equal(ask({ ...world(dir, { running: true, ...SAME }), ...MAC_ENV }), "vm", "a Mac, whatever docker says");
    // the engine silent: the backup fails plainly and changes nothing (before, it fell back to host tools)
    fs.rmSync(path.join(dir, "host.log"), { force: true });
    const before = fs.readdirSync(path.join(dir, "backups")).sort();
    const silent = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, world(dir, { running: true, kernel: "" }));
    assert.notEqual(silent.status, 0);
    assert.match(silent.stderr, /Start Docker \(and the server\), then run this again/);
    assert.deepEqual(hostTouches(dir), []);
    assert.deepEqual(fs.readdirSync(path.join(dir, "backups")).sort(), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("a snapshot stream cut short (the copy command still exits 0) is a failed backup: nothing is written and no earlier backup is pruned", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "T");
    db(path.join(dir, "data/space/events.db"), `INSERT INTO t SELECT hex(randomblob(800)) FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<400) SELECT x FROM c)`);
    const env = { ...world(dir, { running: true }), ...MAC_ENV };
    for (let i = 0; i < 3; i++) assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, env).status, 0);
    const before = fs.readdirSync(path.join(dir, "backups")).sort();
    assert.equal(before.length, 3);
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; sleep(){ :; }; backup_data manual live`, { ...env, FAKE_TRUNCATE: "8192" });
    assert.notEqual(r.status, 0, "a cut-off copy is not a backup");
    assert.match(r.stderr, /could not take a consistent copy of \S+\.db\n/);
    assert.match(r.stderr, /nothing was changed\.\n$/, "the plain line ends there (it once carried the exit code)");
    assert.deepEqual(fs.readdirSync(path.join(dir, "backups")).sort(), before, "no new backup, and the three earlier ones are all still there");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("when this engine runs no vyred of this install, the one-shot boot id is trusted only while no database in the Space has a -wal or -shm beside it", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "C");
    const ask = (): string => sh(SERVER, `DATA_DIR="${dir}/data"; engine_same_kernel && echo same || echo vm`, world(dir, { running: false, ...SAME })).stdout.trim();
    assert.equal(ask(), "same", "nothing has the files open: this engine's one-shot answer stands");
    fs.writeFileSync(path.join(dir, "data/space/modules.db-wal"), "");
    assert.equal(ask(), "vm", "a -wal beside a database: something may have it open under another Docker context");
    fs.rmSync(path.join(dir, "data/space/modules.db-wal"));
    fs.writeFileSync(path.join(dir, "data/space/events.db-shm"), "");
    assert.equal(ask(), "vm", "a -shm likewise");
    // the running vyred's own answer is not second-guessed
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; engine_same_kernel && echo same || echo vm`, world(dir, { running: true, ...SAME })).stdout.trim(), "same");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("no test hook can make a Mac the same kernel: Darwin is never 'same', in test mode or out of it, whatever the engine and boot id hooks say", () => {
  const dir = tmp();
  try {
    const bin = path.join(dir, "darwin");
    fs.mkdirSync(bin);
    const real = spawnSync("sh", ["-c", "command -v uname"], { encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(bin, "uname"), `#!/bin/sh\ncase "$1" in -s) echo Darwin ;; *) exec ${real} "$@" ;; esac\n`, { mode: 0o755 });
    const hooks = { VYRE_TEST_ENGINE: `Ubuntu|${HOST_BOOT}`, VYRE_TEST_BOOT_ID_FILE: BOOT_FILE, VYRE_TEST_OS: "Linux" };
    const ask = (env: Record<string, string>): string => spawnSync("sh", ["-c", `. "${SERVER}"\nDATA_DIR="${dir}/data"; engine_same_kernel && echo same || echo vm`], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH ?? ""}`, VYRE_SOURCE_ONLY: "1", ...env } }).stdout.trim();
    // a real Mac (uname says Darwin), not in test mode: the hooks are not read at all
    assert.equal(ask(hooks), "vm", "outside test mode a Darwin host is never the same kernel");
    // in test mode a test may say Darwin, and then nothing makes it 'same'
    assert.equal(ask({ ...hooks, VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Darwin" }), "vm");
    // the hooks only ever model a Linux server, in test mode
    assert.equal(ask({ ...hooks, VYRE_TEST_MODE: "1" }), "same");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
