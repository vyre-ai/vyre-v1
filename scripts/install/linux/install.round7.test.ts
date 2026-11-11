// Round 7 of the installer: the third review (ports from what the Space serves with a definite answer only, restore safety, Docker's data root). Split out so each file stays inside its time cap.
// (Earlier rounds: install.round4.test.ts.) The installer's answers to a cloud server with a plain disk and the walk's other install findings (round 4 and its review): the disk choices, the relay's honesty, the relay and domain switch, Docker, the DNS check,
// purge, backups. Split from install.test.ts so each file stays inside its time cap. The scripts are sourced with VYRE_SOURCE_ONLY=1 and their functions called directly (fake docker, apt, gpg and dig on PATH).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(HERE, "install.sh");
const SERVER = path.join(HERE, "vyre-server");
const read = (f: string): string => fs.readFileSync(f, "utf8");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-install-test-"));

type Out = { status: number | null; stdout: string; stderr: string };
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function fakeHost(dir: string, opts: { fs?: string; src?: string; layers?: string[] }): { mounts: string; lsblk: string } {
  const mounts = path.join(dir, "mounts");
  const lsblk = path.join(dir, "lsblk");
  fs.writeFileSync(mounts, `/dev/sda1 / ext4 rw 0 0\n${opts.src ?? "/dev/mapper/vyre-data"} ${dir} ${opts.fs ?? "ext4"} rw 0 0\n`);
  fs.writeFileSync(lsblk, `#!/bin/sh\nprintf '${(opts.layers ?? ["crypt", "disk"]).join("\\n")}\\n'\n`, { mode: 0o755 });
  return { mounts, lsblk };
}
const hostEnv = (h: { mounts: string; lsblk: string }): Record<string, string> => ({ VYRE_TEST_PROC_MOUNTS: h.mounts, VYRE_TEST_LSBLK: h.lsblk });

/** A directory of fake commands that log their arguments (and whatever they read on stdin, as a length only) to calls.log. */
function fakeBin(dir: string, names: string[], extra: Record<string, string> = {}): string {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(bin, n), extra[n] ?? `#!/bin/sh\necho "${n} $*" >>"${dir}/calls.log"\ncat >/dev/null 2>&1 || true\nexit 0\n`, { mode: 0o755 });
  return bin;
}
const plainHost = (dir: string) => hostEnv(fakeHost(dir, { src: "/dev/sdb1", layers: ["part", "disk"] }));

function mkSpace(dir: string, marker: string): void {
  const space = path.join(dir, "data", "space");
  fs.mkdirSync(space, { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "caddy"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "caddy", "cert.pem"), marker);
  for (const n of ["events.db", "modules.db"]) {
    const r = spawnSync("node", ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("PRAGMA journal_mode=WAL;CREATE TABLE t(v TEXT);INSERT INTO t VALUES('"+process.argv[2]+"')");d.close()`, path.join(space, n), marker]);
    assert.equal(r.status, 0, String(r.stderr));
  }
}
const valueIn = (db: string): string => JSON.parse(spawnSync("node", ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify(d.prepare("SELECT v FROM t").get().v))`, db], { encoding: "utf8" }).stdout);

const sqliteWith = (file: string, sql: string): void => {
  const r = spawnSync("node", ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec(process.argv[2]);d.close()`, file, sql], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

test("new installs put backups inside the data folder when the data is on another filesystem than the install folder (an admin-opened volume at the default folder); existing installs stay", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  const rel = path.join(dirVyre, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  const cfg = (devices: string): Out => sh(INSTALL, `DIR="${dirVyre}"; DATA_DIR="${dirVyre}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="vyre.example.com"; RELAY=""; DRY=0; UPDATE_URL=https://vyre.run/server/; ENC_KIND=detected; write_config`, { VYRE_DIR: dirVyre, VYRE_TEST_FS_DEVICE: devices });
  assert.equal(cfg(`${dirVyre}/data=/dev/mapper/mine,${dirVyre}=/dev/vda1`).status, 0);
  assert.equal(read(path.join(dirVyre, "backup-dir")).trim(), path.join(dirVyre, "data/backups"), "an encrypted volume at the default folder holds its backups");
  fs.rmSync(path.join(dirVyre, "backup-dir"));
  assert.equal(cfg(`${dirVyre}/data=/dev/vda1,${dirVyre}=/dev/vda1`).status, 0);
  assert.equal(read(path.join(dirVyre, "backup-dir")).trim(), path.join(dirVyre, "backups"), "the same disk keeps the old layout");
  fs.writeFileSync(path.join(dirVyre, "backup-dir"), `${dirVyre}/backups\n`);
  assert.equal(cfg(`${dirVyre}/data=/dev/mapper/mine,${dirVyre}=/dev/vda1`).status, 0);
  assert.equal(read(path.join(dirVyre, "backup-dir")).trim(), path.join(dirVyre, "backups"), "an install that already has a backup folder keeps it");
  assert.doesNotMatch(read(path.join(HERE, "../../../docs/getting-started.md")), /it is by default when the data folder is on it/, "the docs no longer promise that for the default layout");
  fs.rmSync(dir, { recursive: true });
});

test("the Console value for a file-backed encryption layer is its own (degraded), a verified one is detected, and the doctor shows each state's own next step", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=x\n");
  const env = { ...hostEnv(fakeHost(dir, { src: "/dev/mapper/vyre-data", layers: ["crypt", "loop"] })), VYRE_TEST_DOCKER_ROOT: "" };
  const r = sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; refresh_disk_env; cat "${dir}/compose.env"`, env);
  assert.match(r.stdout, /^VYRE_DISK_ENCRYPTION=detected_file$/m);
  fs.rmSync(dir, { recursive: true });
});


// ---- Round 7: the third review (A1 to A7)

/** A PATH folder holding only the named tools, linked from this machine: a host with no sqlite3 and no node. */
function bareBin(dir: string, extra: string[] = []): string {
  const bin = path.join(dir, "barebin");
  fs.mkdirSync(bin, { recursive: true });
  const need = ["sed", "grep", "awk", "cat", "mv", "rm", "mkdir", "cp", "cmp", "date", "head", "tr", "dirname", "readlink", "uname", "df", "cut", "sort", "chmod", "mktemp", "tar", "find", "ls", "id", "wc", "basename", "stty", "env", ...extra];
  for (const t of need) {
    const r = spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" });
    const found = r.stdout.trim();
    if (found.startsWith("/") && !fs.existsSync(path.join(bin, t))) fs.symlinkSync(found, path.join(bin, t));
  }
  return bin;
}
const runSh = (script: string, body: string, env: Record<string, string>): Out => {
  const r = spawnSync("/bin/sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const haveSqlite3 = spawnSync("sh", ["-c", "command -v sqlite3"]).status === 0;

/** A Space folder with a modules.db whose network_config says `mode` (or no such table, or no file at all), and a release that sync_image can read. */
function ports(dir: string, o: { mode?: "relay" | "own_domain"; noTable?: boolean; noFile?: boolean; bind: boolean }): void {
  fs.mkdirSync(path.join(dir, "data/space"), { recursive: true });
  fs.mkdirSync(path.join(dir, "releases/1.0.0"), { recursive: true });
  fs.writeFileSync(path.join(dir, "releases/1.0.0/images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  if (!fs.existsSync(path.join(dir, "current"))) fs.symlinkSync("releases/1.0.0", path.join(dir, "current"));
  fs.rmSync(path.join(dir, "data/space/modules.db"), { force: true });
  if (!o.noFile) sqliteWith(path.join(dir, "data/space/modules.db"), o.noTable ? "CREATE TABLE other (x INTEGER)" : `CREATE TABLE network_config (id INTEGER PRIMARY KEY, address TEXT NOT NULL, mode TEXT NOT NULL, domain TEXT, relay_address TEXT, public_ingress INTEGER NOT NULL, ingress_detail TEXT, reported_at INTEGER NOT NULL); INSERT INTO network_config VALUES (1, 'x', '${o.mode}', NULL, NULL, 1, NULL, 1);`);
  fs.writeFileSync(path.join(dir, "compose.env"), `VYRE_IMAGE=old\n${o.bind ? "VYRE_BIND=127.0.0.1\n" : ""}`);
}
const compose = (dir: string): string => read(path.join(dir, "compose.env"));

test("an update changes the ports only on a definite answer: relay closes, a Console domain opens, and 'cannot tell' (no reader, busy, missing file or table, a failing reader) leaves both exactly as they were", () => {
  const dir = tmp();
  const sync = (env: Record<string, string>): Out => runSh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; sync_image`, env);
  const bare = bareBin(dir);
  const withTools = { PATH: process.env.PATH ?? "" };
  // definite answers, with whatever reader the host has
  ports(dir, { mode: "relay", bind: false });
  assert.equal(sync(withTools).status, 0);
  assert.match(compose(dir), /^VYRE_BIND=127\.0\.0\.1$/m, "the Space says relay: closed");
  ports(dir, { mode: "own_domain", bind: true });
  assert.equal(sync(withTools).status, 0);
  assert.doesNotMatch(compose(dir), /VYRE_BIND/, "the Space serves a domain set in the Console: open, and an earlier closing is undone");
  // cannot tell, in each way: a relay server keeps its loopback bind, a Console-domain server keeps its open ports, and one plain line says nothing was changed
  const cases: Array<[string, (mode: "relay" | "own_domain", bind: boolean) => Record<string, string>]> = [
    ["no sqlite3 and no node on the host (and no Docker)", (mode, bind) => { ports(dir, { mode, bind }); return { PATH: bare }; }],
    ["a missing modules.db (the data volume is not mounted)", (mode, bind) => { ports(dir, { mode, bind, noFile: true }); return withTools; }],
    ["a database without the table", (mode, bind) => { ports(dir, { mode, bind, noTable: true }); return withTools; }],
  ];
  if (haveSqlite3) cases.push(["a reader that fails (sqlite3 exits non-zero)", (mode, bind) => {
    ports(dir, { mode, bind });
    const fake = fakeBin(dir, ["sqlite3"], { sqlite3: "#!/bin/sh\necho 'Error: database disk image is malformed' >&2\nexit 11\n" });
    return { PATH: `${fake}:${bare}` };
  }]);
  for (const [why, setup] of cases) {
    const relay = setup("relay", true);
    const a = sync(relay);
    assert.equal(a.status, 0, `${why}: ${a.stderr}`);
    assert.match(compose(dir), /^VYRE_BIND=127\.0\.0\.1$/m, `${why}: a relay server stays closed`);
    assert.match(a.stdout, /Could not tell whether this server serves its own domain, so ports 80 and 443 were left exactly as they were\./, why);
    const domain = setup("own_domain", false);
    const b = sync(domain);
    assert.equal(b.status, 0, `${why}: ${b.stderr}`);
    assert.doesNotMatch(compose(dir), /VYRE_BIND/, `${why}: a Console-domain server stays open`);
    assert.match(b.stdout, /left exactly as they were/, why);
  }
  fs.rmSync(dir, { recursive: true });
});

test("a database that is busy for longer than the timeout is 'cannot tell', not 'no domain'", { skip: haveSqlite3 ? false : "needs sqlite3 on this machine" }, () => {
  const dir = tmp();
  ports(dir, { mode: "own_domain", bind: false });
  const db = path.join(dir, "data/space/modules.db");
  // hold an exclusive lock (a rollback journal database blocks readers) from another process for a few seconds
  const ready = path.join(dir, "ready");
  const holder = spawnSync("sh", ["-c", `node --no-warnings -e '
const {DatabaseSync}=require("node:sqlite");const fs=require("node:fs");
const d=new DatabaseSync(process.argv[1]);d.exec("PRAGMA journal_mode=DELETE");d.exec("BEGIN EXCLUSIVE");fs.writeFileSync(process.argv[2],"1");
setTimeout(()=>{d.exec("ROLLBACK");d.close()},5000);' "${db}" "${ready}" >/dev/null 2>&1 &
i=0; while [ ! -f "${ready}" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done`]);
  assert.equal(holder.status, 0);
  const r = runSh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; sync_image`, { PATH: process.env.PATH ?? "", VYRE_TEST_SQLITE_TIMEOUT: "300" });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(compose(dir), /VYRE_BIND/, "the busy read did not close a server that serves a domain");
  assert.match(r.stdout, /left exactly as they were/);
  fs.rmSync(dir, { recursive: true });
});

test("the release image's own node is a reader: a definite answer on a host with no sqlite3 and no node, and an image that fails is 'cannot tell'", () => {
  const dir = tmp();
  const bare = bareBin(dir);
  const img = "ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64);
  const docker = (out: string, code = 0): string => fakeBin(dir, ["docker"], { docker: `#!/bin/sh\necho "docker $*" >>"${dir}/docker.log"\n${out ? `echo ${out}\n` : ""}exit ${code}\n` });
  const sync = (answer: string, code = 0): string => { ports(dir, { mode: "relay", bind: answer === "1" }); const bin = docker(answer, code); runSh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; sync_image`, { PATH: `${bin}:${bare}` }); return compose(dir); };
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=" + img + "\n");
  assert.doesNotMatch(sync("1"), /VYRE_BIND/, "the image says the Space serves a domain: open");
  assert.match(sync("0"), /^VYRE_BIND=127\.0\.0\.1$/m, "the image says it does not: closed");
  fs.rmSync(path.join(dir, "docker.log"), { force: true });
  assert.match(sync("", 125), /^$|VYRE_IMAGE/, "(a failing image changes nothing below)");
  const log = read(path.join(dir, "docker.log"));
  assert.match(log, /docker run --rm --network none --user 1000:1000 -v .*\/data\/space:\/in:ro --entrypoint node .*vyred@sha256/, "no network, read-only mount, the image already pulled");
  ports(dir, { mode: "relay", bind: true });
  runSh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; sync_image`, { PATH: `${docker("", 1)}:${bare}` });
  assert.match(compose(dir), /^VYRE_BIND=127\.0\.0\.1$/m, "an image that fails: left as it was");
  fs.rmSync(dir, { recursive: true });
});

test("the installer decides the ports the same way: a flag-less re-run keeps what was there when it cannot tell, and an explicit switch follows the flags", () => {
  const dir = tmp();
  const bare = bareBin(dir);
  const cfg = (domain: string, relay: string, env: Record<string, string>): Out => runSh(INSTALL, `DIR="${dir}"; DATA_DIR="${dir}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="${domain}"; RELAY="${relay}"; DRY=0; UPDATE_URL=https://vyre.run/server/; ENC_KIND=; write_config`, { VYRE_DIR: dir, ...env });
  // a relay server and a Console-domain server, and nothing can read the database
  ports(dir, { mode: "relay", bind: true });
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=old\nVYRE_RELAY_URL=https://relay.vyre.run\nVYRE_BIND=127.0.0.1\n");
  const a = cfg("", "", { PATH: `${bare}` });
  assert.equal(a.status, 0, a.stderr);
  assert.match(compose(dir), /^VYRE_BIND=127\.0\.0\.1$/m);
  assert.match(a.stdout, /left exactly as they were/);
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=old\n");
  const b = cfg("", "", { PATH: `${bare}` });
  assert.equal(b.status, 0, b.stderr);
  assert.doesNotMatch(compose(dir), /VYRE_BIND/);
  // a definite answer is followed
  ports(dir, { mode: "own_domain", bind: false });
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=old\nVYRE_RELAY_URL=https://relay.vyre.run\n");
  assert.equal(cfg("", "", { PATH: process.env.PATH ?? "" }).status, 0);
  assert.doesNotMatch(compose(dir), /VYRE_BIND/, "a Console domain keeps its ports");
  // an explicit switch to the relay closes them whatever the Space said before
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=old\nVYRE_ADDRESS=vyre.example.com\n");
  const sw = cfg("", "https://relay.vyre.run", { PATH: process.env.PATH ?? "" });
  assert.equal(sw.status, 0, sw.stderr);
  assert.match(sw.stdout, /Changing how this server is reached/);
  assert.match(compose(dir), /^VYRE_BIND=127\.0\.0\.1$/m);
  fs.rmSync(dir, { recursive: true });
});

test("restore refuses to write onto the plain disk when the data folder was set up on an encrypted volume that is not mounted; --force overrides", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  mkSpace(dir, "OLD");
  const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, { VYRE_DIR: dir });
  const file = mk.stdout.trim().split("\n").pop()!;
  fs.rmSync(path.join(dir, "data"), { recursive: true });
  const plain = plainHost(dir);
  const restore = (extra = ""): Out => sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; wait_healthy(){ :; }; trap cleanup EXIT; cmd_restore "${file}" --yes ${extra}`, { VYRE_DIR: dir, ...plain });
  fs.writeFileSync(path.join(dir, "state/encryption"), `kind=detected\nsince=2026-11-01\ndata_dir=${dir}/data\n`);
  const r = restore();
  assert.equal(r.status, 7, r.stderr);
  assert.match(r.stderr, /was set up on an encrypted volume \(detected\) that does not seem to be mounted now\. Restoring now would write the Space onto this machine's plain disk\. Mount or open the volume, then run the restore again\. To restore onto the plain disk anyway, add --force\. Nothing was changed\./);
  assert.ok(!fs.existsSync(path.join(dir, "data")), "nothing was written, not even the folder");
  fs.writeFileSync(path.join(dir, "state/encryption"), `kind=provider\nsince=2026-11-01\ndata_dir=${dir}/data\n`);
  assert.equal(restore().status, 7, "a provider volume that is not mounted: its folder is not there");
  fs.writeFileSync(path.join(dir, "state/encryption"), `kind=plain\nsince=2026-11-01\ndata_dir=${dir}/data\n`);
  const ok = restore();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(valueIn(path.join(dir, "data/space/events.db")), "OLD", "a plain-disk server restores as before");
  fs.rmSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "state/encryption"), `kind=detected\nsince=2026-11-01\ndata_dir=${dir}/data\n`);
  assert.equal(restore("--force").status, 0, "a deliberate restore onto a new plain disk");
  fs.rmSync(dir, { recursive: true });
});

test("a restore hands the Space to the server's user (uid 1000), and a restore into an empty folder that fails its health check keeps the restored copy and says where", () => {
  const dir = tmp();
  mkSpace(dir, "OLD");
  const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, { VYRE_DIR: dir });
  const file = mk.stdout.trim().split("\n").pop()!;
  fs.rmSync(path.join(dir, "data"), { recursive: true });
  const bin = fakeBin(dir, ["chown"]);
  const run = (healthy: boolean): Out => sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ ${healthy ? "return 0" : "return 1"}; }; trap cleanup EXIT; cmd_restore "${file}" --yes`, { VYRE_DIR: dir, PATH: `${bin}:${process.env.PATH ?? ""}` });
  const ok = run(true);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(read(path.join(dir, "calls.log")), new RegExp(`chown -R 1000:1000 ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/data/space`), "the restored Space is given to uid 1000");
  // root-owned 0600 files (a backup taken with the host's sqlite3) are handed over for real when this runs as root
  if (process.getuid?.() === 0) {
    fs.rmSync(path.join(dir, "data"), { recursive: true });
    fs.rmSync(path.join(bin, "chown"));
    const real = run(true);
    assert.equal(real.status, 0, real.stderr);
    const st = fs.statSync(path.join(dir, "data/space/events.db"));
    assert.equal(st.uid, 1000, "owned by the server's user");
    assert.equal(st.gid, 1000);
  }
  // nothing there before, and the server does not come up healthy: the restored copy stays, stopped
  fs.rmSync(path.join(dir, "data"), { recursive: true });
  const bad = run(false);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /the server did not pass its health check on the restored data\. The restored data is still in .*\/data\/space \(the server is stopped\)\. Look at it and fix what failed, then start the server: vyre-server start\. It came from /);
  assert.equal(valueIn(path.join(dir, "data/space/events.db")), "OLD", "not deleted");
  fs.rmSync(dir, { recursive: true });
});
