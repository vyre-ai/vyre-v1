// The backup, update, restore and release-switch tests of vyre-server, split from install.test.ts (round 8) so each file stays well under the fast runner's 30 s cap.
// Linux installer (P-L10_09, spec 3.13, ARCH 7.13): the checks that need no Docker. The scripts are sourced with VYRE_SOURCE_ONLY=1 and their
// functions are called directly, so each test names one rule: the signature check, the encrypted-disk refusal, the version order, the units.
// The full install on real Docker is install.heavy.test.sh; the last test here runs it when VYRE_HEAVY_DOCKER=1 and is skipped by name otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(HERE, "install.sh");
const SERVER = path.join(HERE, "vyre-server");
const read = (f: string): string => fs.readFileSync(f, "utf8");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-install-test-"));

// These tests model a Linux server whose Docker runs on its own kernel. vyre-server decides that by the boot id read here and inside Docker; the model gives both sides
// the same one (VYRE_TEST_ENGINE for Docker's answers, VYRE_TEST_BOOT_ID_FILE for this computer's, test mode only), so the tests do not depend on this computer's /proc:
// a macOS runner (the desktop workflow's installer-macos job) has none, and there the missing boot id read as "another kernel".
const SAME_BOOT = "0b0e1d2c-3a4f-4b5c-8d6e-same-kernel-test";
const BOOT_FILE = ((): string => {
  const f = path.join(os.tmpdir(), `vyre-test-boot-id-${process.pid}`);
  fs.writeFileSync(f, `${SAME_BOOT}\n`);
  return f;
})();
const SAME_ENGINE = `Ubuntu|${SAME_BOOT}`;
// The tests never reach the host's Docker (13 Nov 2026: backup_data walks every Docker volume of the computer it runs on, so on a runner or a lane box with many leftover volumes the same tests took 10 s each
// and the file passed the fast runner's 30 s cap only when the computer was tidy). A `docker` that answers nothing and succeeds goes first in PATH; a test that needs Docker's answers defines its own `docker`.
const FAKE_BIN = ((): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-test-bin-"));
  fs.writeFileSync(path.join(d, "docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return d;
})();
/** A test's own PATH entries first (its fake apt, gpg, dig), then the fake docker, then the computer's own PATH (which a test's entry usually ends with: it is taken off and put back after the fake). */
const pathWith = (own?: string): string => {
  const host = process.env.PATH ?? "";
  const mine =
    own === undefined ? "" : (own.endsWith(host) ? own.slice(0, own.length - host.length) : own).replace(/:$/, "");
  return [mine, FAKE_BIN, host].filter(Boolean).join(":");
};
type Out = { status: number | null; stdout: string; stderr: string };
/** Runs a snippet of sh with a script's functions loaded and nothing else executed. */
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], {
    encoding: "utf8",
    env: {
      VYRE_SOURCE_ONLY: "1",
      VYRE_TEST_MODE: "1",
      VYRE_TEST_ENGINE: SAME_ENGINE,
      VYRE_TEST_BOOT_ID_FILE: BOOT_FILE,
      VYRE_TEST_OS: "Linux",
      ...env,
      PATH: pathWith(env["PATH"]),
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A fake /proc/mounts and lsblk: `dir` sits on a device, and lsblk -s lists `layers` for it. */
function fakeHost(
  dir: string,
  opts: { fs?: string; src?: string; layers?: string[] },
): { mounts: string; lsblk: string } {
  const mounts = path.join(dir, "mounts");
  const lsblk = path.join(dir, "lsblk");
  fs.writeFileSync(
    mounts,
    `/dev/sda1 / ext4 rw 0 0\n${opts.src ?? "/dev/mapper/vyre-data"} ${dir} ${opts.fs ?? "ext4"} rw 0 0\n`,
  );
  fs.writeFileSync(lsblk, `#!/bin/sh\nprintf '${(opts.layers ?? ["crypt", "disk"]).join("\\n")}\\n'\n`, {
    mode: 0o755,
  });
  return { mounts, lsblk };
}
const hostEnv = (h: { mounts: string; lsblk: string }): Record<string, string> => ({
  VYRE_TEST_PROC_MOUNTS: h.mounts,
  VYRE_TEST_LSBLK: h.lsblk,
});

function block(file: string, name: string): string {
  const m = read(file).match(new RegExp(`# BEGIN ${name}\\n[\\s\\S]*?# END ${name}\\n`));
  assert.ok(m, `${path.basename(file)} has a ${name} block`);
  return m[0];
}

// ---- backup and update safety (l-backup)

const WRITER = `
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const dir = process.argv[1];
const dbs = ["events.db", "modules.db"].map((n) => { const d = new DatabaseSync(dir + "/" + n); d.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)"); return d; });
let i = 0;
fs.writeFileSync(dir + "/ready", "1");
const tick = () => {
  for (const d of dbs) d.exec("INSERT INTO t (v) VALUES ('" + "x".repeat(200) + i + "')");
  fs.writeFileSync(dir + "/state.json", JSON.stringify({ i }));
  fs.writeFileSync(dir + "/scratch-" + (i % 5) + ".tmp", String(i));
  i++;
  if (!fs.existsSync(dir + "/stop")) setImmediate(tick); else { for (const d of dbs) d.close(); }
};
tick();
`;

function integrity(db: string): { ok: string; rows: number } {
  const r = spawnSync(
    "node",
    [
      "--no-warnings",
      "-e",
      `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify({ok:d.prepare("PRAGMA integrity_check").get().integrity_check,rows:d.prepare("SELECT count(*) c FROM t").get().c}))`,
      db,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout) as { ok: string; rows: number };
  return o;
}

test("a plain backup takes the Space with the server up and the daemon writing, and restores with databases that pass integrity_check", async () => {
  const dir = tmp();
  const space = path.join(dir, "data", "space");
  fs.mkdirSync(space, { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "caddy"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "caddy", "cert.pem"), "cert");
  const { spawn } = await import("node:child_process");
  const writer = spawn("node", ["--no-warnings", "-e", WRITER, space], { stdio: "inherit" });
  try {
    for (let n = 0; n < 100 && !fs.existsSync(path.join(space, "ready")); n++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(path.join(space, "ready")), "the writer started");
    // A plain backup keeps the server running: dc is never called, and the writer goes on through the whole backup (the worst case).
    for (let round = 0; round < 3; round++) {
      const r = sh(
        SERVER,
        `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; cmd_backup; echo "$BACKUP_FILE"`,
        { VYRE_DIR: dir },
      );
      assert.equal(r.status, 0, r.stderr);
      const file = r.stdout.trim().split("\n").pop()!;
      const restore = path.join(dir, "restore" + round);
      fs.mkdirSync(restore);
      assert.equal(spawnSync("tar", ["-xzf", file, "-C", restore]).status, 0);
      for (const n of ["events.db", "modules.db"]) {
        const o = integrity(path.join(restore, "space", n));
        assert.equal(o.ok, "ok");
        assert.ok(o.rows > 0, "the backup holds rows");
      }
      assert.ok(!fs.existsSync(path.join(restore, "space", "events.db-wal")), "no stray wal in the backup");
      assert.equal(fs.readFileSync(path.join(restore, "caddy", "cert.pem"), "utf8"), "cert");
    }
    assert.equal(fs.existsSync(path.join(dir, "dc.log")), false, "a plain backup never stops or starts the server");
    assert.equal(
      fs.readdirSync(path.join(dir, "backups")).filter((f) => f.startsWith(".stage")).length,
      0,
      "the staging folder is gone",
    );
  } finally {
    fs.writeFileSync(path.join(space, "stop"), "1");
    await new Promise((r) => writer.on("exit", r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a database that will not copy puts the server back and leaves no partial backup", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "data", "space"), { recursive: true });
    const d = path.join(dir, "data", "space", "events.db");
    spawnSync("node", [
      "--no-warnings",
      "-e",
      `const {DatabaseSync}=require("node:sqlite");new DatabaseSync(process.argv[1]).exec("CREATE TABLE t(x)")`,
      d,
    ]);
    const r = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; sqlite_snapshot(){ return 1; }; sleep(){ :; }; backup_data x`,
      { VYRE_DIR: dir },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /nothing was changed/);
    const log = read(path.join(dir, "dc.log"));
    assert.match(log, /^stop/m);
    assert.match(log, /^up -d/m, "the server was started again");
    assert.deepEqual(fs.readdirSync(path.join(dir, "backups")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function installFixture(dir: string): void {
  for (const [v, img] of [
    ["1.0.0", "old"],
    ["1.1.0", "new"],
  ] as const) {
    fs.mkdirSync(path.join(dir, "releases", v), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "releases", v, "images.lock"),
      `VYRE_IMAGE=${img}@sha256:${"a".repeat(64)}\nVYRE_AGENT_IMAGE=ghcr.io/vyre-ai/agent-computer@sha256:${(img === "old" ? "1" : "2").repeat(64)}\n`,
    );
    fs.writeFileSync(path.join(dir, "releases", v, ".complete"), "");
    fs.writeFileSync(path.join(dir, "releases", v, "VERSION"), v);
  }
  fs.symlinkSync("releases/1.1.0", path.join(dir, "current"));
  fs.writeFileSync(
    path.join(dir, "compose.env"),
    `VYRE_PORT=8420\nVYRE_IMAGE=new@sha256:${"a".repeat(64)}\nDOCKER_GID=1\n`,
  );
}

test("sync_image sets only VYRE_IMAGE and the agent computer image, from the release current points at (a rollback writes the earlier release's)", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    fs.rmSync(path.join(dir, "current"));
    fs.symlinkSync("releases/1.0.0", path.join(dir, "current"));
    const r = sh(SERVER, "sync_image", { VYRE_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    const env = read(path.join(dir, "compose.env"));
    assert.match(env, /^VYRE_IMAGE=old@sha256:/m);
    assert.match(
      env,
      /^VYRE_AGENT_COMPUTER_IMAGE=ghcr\.io\/vyre-ai\/agent-computer@sha256:1{64}$/m,
      "the agent computer image follows the release, by digest",
    );
    assert.equal(env.match(/^VYRE_AGENT_COMPUTER_IMAGE=/gm)?.length, 1, "one line, never two");
    assert.match(env, /^VYRE_PORT=8420$/m);
    assert.match(env, /^DOCKER_GID=1$/m);
    assert.equal(fs.existsSync(path.join(dir, "compose.env.new")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an update that was cut off is rolled back by the next command that takes the lock", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    fs.mkdirSync(path.join(dir, "state"));
    fs.writeFileSync(path.join(dir, "state", "update.pending"), "releases/1.0.0\n");
    const r = sh(
      SERVER,
      `dc(){ echo "$*" >>"${dir}/dc.log"; }; lock_update_operation; readlink "$DIR/current"; sed -n 's/^VYRE_IMAGE=//p' "$DIR/compose.env"`,
      { VYRE_DIR: dir },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /cut off/);
    assert.match(r.stdout, /releases\/1\.0\.0/);
    assert.match(r.stdout, /old@sha256/);
    assert.equal(fs.existsSync(path.join(dir, "state", "update.pending")), false);
    assert.match(read(path.join(dir, "dc.log")), /^up -d/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an update killed mid-way rolls back and starts the server again", async () => {
  const dir = tmp();
  try {
    installFixture(dir);
    fs.rmSync(path.join(dir, "current"));
    fs.symlinkSync("releases/1.0.0", path.join(dir, "current"));
    fs.writeFileSync(path.join(dir, "compose.env"), `VYRE_IMAGE=old@sha256:${"a".repeat(64)}\n`);
    fs.writeFileSync(path.join(dir, "vyre.env"), "");
    const { spawn } = await import("node:child_process");
    // fetch_release and the pull are stubbed; the health check hangs so the update is still running when the signal arrives.
    const script = `. "${SERVER}"\ntrap cleanup EXIT\nfetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; docker(){ return 0; }; backup_data(){ BACKUP_FILE=f; }; cur_version(){ printf 1.0.0; }; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ touch "${dir}/waiting"; n=0; while [ $n -lt 30 ]; do sleep 1; n=$((n+1)); done; }; cmd_update --yes --version 1.1.0 --feed-base https://x.example/`;
    const child = spawn("sh", ["-c", script], {
      env: {
        PATH: `${FAKE_BIN}:${process.env.PATH ?? ""}`,
        VYRE_SOURCE_ONLY: "1",
        VYRE_TEST_MODE: "1",
        VYRE_TEST_ENGINE: SAME_ENGINE,
        VYRE_TEST_BOOT_ID_FILE: BOOT_FILE,
        VYRE_DIR: dir,
        TMPDIR: dir,
      },
      stdio: "ignore",
    });
    for (let n = 0; n < 100 && !fs.existsSync(path.join(dir, "waiting")); n++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(path.join(dir, "waiting")));
    assert.ok(fs.existsSync(path.join(dir, "state", "update.pending")), "the marker is there while the update runs");
    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));
    assert.equal(fs.readlinkSync(path.join(dir, "current")), "releases/1.0.0");
    assert.equal(fs.existsSync(path.join(dir, "state", "update.pending")), false);
    assert.match(read(path.join(dir, "compose.env")), /^VYRE_IMAGE=old@/m);
    assert.equal(fs.existsSync(path.join(dir, "state", "update.lock")), false, "the lock is released");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a lock left by a process that is gone is reclaimed; a lock with a live owner is not", () => {
  const dir = tmp();
  try {
    const lock = path.join(dir, "state", "update.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "pid"), "999999\n");
    const dead = sh(SERVER, "lock_update_operation; echo got", { VYRE_DIR: dir });
    assert.equal(dead.status, 0, dead.stderr);
    assert.match(dead.stdout, /got/);
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "pid"), `${process.pid}\n`);
    const live = sh(SERVER, "lock_update_operation", { VYRE_DIR: dir });
    assert.equal(live.status, 75);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an update backup also stops a container outside compose that still mounts the data folder, names it, and starts it again", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "data", "space"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "space", "events.db"), "x"); // a Space has its event log: a backup refuses a folder with none
    const fake = `docker(){ echo "docker $*" >>"${dir}/docker.log"; case "$1 $2" in "volume ls") echo vyre-server_vyre-data ;; "volume inspect") printf '%s' "${dir}/data/space" ;; "ps -q") echo abc123 ;; "inspect -f") echo /vyre-site-9-app ;; esac; return 0; }`;
    const r = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; dc(){ echo "dc $*" >>"${dir}/docker.log"; }; ${fake}; backup_data pre; resume_strays`,
      { VYRE_DIR: dir },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Stopping vyre-site-9-app too/);
    const log = read(path.join(dir, "docker.log"));
    assert.match(log, /^dc stop/m);
    assert.match(log, /^docker stop abc123/m);
    assert.match(log, /^docker start abc123/m);
    assert.ok(log.indexOf("docker stop abc123") < log.indexOf("docker start abc123"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkSpace(dir: string, marker: string): void {
  const space = path.join(dir, "data", "space");
  fs.mkdirSync(space, { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "caddy"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "caddy", "cert.pem"), marker);
  for (const n of ["events.db", "modules.db"]) {
    const r = spawnSync("node", [
      "--no-warnings",
      "-e",
      `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("PRAGMA journal_mode=WAL;CREATE TABLE t(v TEXT);INSERT INTO t VALUES('"+process.argv[2]+"')");d.close()`,
      path.join(space, n),
      marker,
    ]);
    assert.equal(r.status, 0, String(r.stderr));
  }
}
const valueIn = (db: string): string =>
  JSON.parse(
    spawnSync(
      "node",
      [
        "--no-warnings",
        "-e",
        `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify(d.prepare("SELECT v FROM t").get().v))`,
        db,
      ],
      { encoding: "utf8" },
    ).stdout,
  );
const treeSig = (d: string): string =>
  spawnSync("sh", ["-c", `cd "${d}" && find . -type f | sort | xargs cat | shasum`], { encoding: "utf8" }).stdout;

test("restore puts a backup back after backing up the current data, and starts and checks the server", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "OLD");
    const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, {
      VYRE_DIR: dir,
    });
    assert.equal(mk.status, 0, mk.stderr);
    const file = mk.stdout.trim().split("\n").pop()!;
    fs.rmSync(path.join(dir, "data"), { recursive: true });
    mkSpace(dir, "NEW");
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "NEW");
    const r = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ echo healthy >>"${dir}/dc.log"; }; trap cleanup EXIT; cmd_restore "${file}" --yes`,
      { VYRE_DIR: dir },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "OLD");
    assert.equal(valueIn(path.join(dir, "data", "space", "modules.db")), "OLD");
    assert.equal(read(path.join(dir, "data", "caddy", "cert.pem")), "OLD");
    const pre = fs.readdirSync(path.join(dir, "backups")).filter((f) => f.startsWith("vyre-pre-restore"));
    assert.equal(pre.length, 1, "the current data was backed up first");
    const log = read(path.join(dir, "dc.log"));
    assert.ok(log.indexOf("stop") < log.indexOf("up -d") && log.indexOf("up -d") < log.indexOf("healthy"));
    // the backup it made holds what was replaced
    const chk = path.join(dir, "chk");
    fs.mkdirSync(chk);
    assert.equal(spawnSync("tar", ["-xzf", path.join(dir, "backups", pre[0]!), "-C", chk]).status, 0);
    assert.equal(valueIn(path.join(chk, "space", "events.db")), "NEW");
    assert.deepEqual(fs.readdirSync(path.join(dir, "data")).sort(), ["caddy", "space"], "no leftovers");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("restore refuses a bad file, an unconfirmed run and a backup of the wrong shape, and changes nothing", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "LIVE");
    const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, {
      VYRE_DIR: dir,
    });
    const good = mk.stdout.trim().split("\n").pop()!;
    const bytes = fs.readFileSync(good);
    const bad: Record<string, string> = {};
    bad.truncated = path.join(dir, "truncated.tar.gz");
    fs.writeFileSync(bad.truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));
    bad.text = path.join(dir, "text.tar.gz");
    fs.writeFileSync(bad.text, "not an archive");
    // a tar with a path outside space/ and caddy/
    const odd = path.join(dir, "odd");
    fs.mkdirSync(path.join(odd, "etc"), { recursive: true });
    fs.writeFileSync(path.join(odd, "etc", "passwd"), "x");
    bad.shape = path.join(dir, "shape.tar.gz");
    spawnSync("tar", ["-czf", bad.shape, "-C", odd, "etc"]);
    // a good-looking backup whose database is damaged
    const dmg = path.join(dir, "dmg");
    fs.mkdirSync(dmg);
    spawnSync("tar", ["-xzf", good, "-C", dmg]);
    const db = path.join(dmg, "space", "events.db");
    const buf = fs.readFileSync(db);
    for (let i = 100; i < buf.length; i++) buf[i] = 0xff;
    fs.writeFileSync(db, buf);
    bad.corrupt = path.join(dir, "corrupt.tar.gz");
    spawnSync("tar", ["-czf", bad.corrupt, "-C", dmg, "space", "caddy"]);
    const before = treeSig(path.join(dir, "data"));
    const backupsBefore = fs.readdirSync(path.join(dir, "backups")).sort();
    for (const [name, file] of Object.entries({ ...bad, missing: path.join(dir, "nope.tar.gz") })) {
      const r = sh(
        SERVER,
        `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ :; }; trap cleanup EXIT; cmd_restore "${file}" --yes`,
        { VYRE_DIR: dir },
      );
      assert.notEqual(r.status, 0, name);
      assert.match(r.stderr, /nothing was changed|no such backup/, name);
      assert.equal(treeSig(path.join(dir, "data")), before, `${name}: data unchanged`);
      assert.deepEqual(fs.readdirSync(path.join(dir, "data")).sort(), ["caddy", "space"], `${name}: no staging left`);
    }
    assert.equal(fs.existsSync(path.join(dir, "dc.log")), false, "the server was never touched");
    assert.deepEqual(fs.readdirSync(path.join(dir, "backups")).sort(), backupsBefore, "no backup was made either");
    // no --yes and no terminal
    const unconfirmed = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; trap cleanup EXIT; cmd_restore "${good}" </dev/null`,
      { VYRE_DIR: dir },
    );
    assert.notEqual(unconfirmed.status, 0);
    assert.match(unconfirmed.stderr, /--yes|terminal/);
    assert.equal(treeSig(path.join(dir, "data")), before);
    assert.equal(fs.existsSync(path.join(dir, "dc.log")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("restore puts the old data back when the server is not healthy on the restored data", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "OLD");
    const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, {
      VYRE_DIR: dir,
    });
    const file = mk.stdout.trim().split("\n").pop()!;
    fs.rmSync(path.join(dir, "data"), { recursive: true });
    mkSpace(dir, "KEEP");
    const r = sh(
      SERVER,
      `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ return 1; }; trap cleanup EXIT; cmd_restore "${file}" --yes`,
      { VYRE_DIR: dir },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /health check.*the data that was there before is back/);
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "KEEP");
    assert.equal(read(path.join(dir, "data", "caddy", "cert.pem")), "KEEP");
    assert.deepEqual(fs.readdirSync(path.join(dir, "data")).sort(), ["caddy", "space"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 13 Nov 2026 (install.backup.test.ts overran the fast runner's 30 s on CI): a backup of the test's own folder must not ask the computer's Docker anything.
test("the backup tests never call the host's Docker", () => {
  const dir = tmp();
  try {
    const host = path.join(dir, "host-bin");
    fs.mkdirSync(host);
    fs.writeFileSync(path.join(host, "docker"), `#!/bin/sh\necho "$*" >>"${dir}/host-docker.log"\nexit 0\n`, {
      mode: 0o755,
    });
    fs.mkdirSync(path.join(dir, "data", "space"), { recursive: true });
    spawnSync("node", [
      "--no-warnings",
      "-e",
      `const {DatabaseSync}=require("node:sqlite");new DatabaseSync(process.argv[1]).exec("CREATE TABLE t(x)")`,
      path.join(dir, "data", "space", "events.db"),
    ]);
    const was = process.env.PATH;
    process.env.PATH = `${host}:${was ?? ""}`; // the computer's own PATH, with a docker that records being asked
    let r: Out;
    try {
      r = sh(SERVER, `DATA_DIR="${dir}/data"; backup_data x`, { VYRE_DIR: dir });
    } finally {
      process.env.PATH = was;
    }
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(dir, "host-docker.log")), false, "the host's docker was not called");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
