// Round 8 of the installer (12 Nov 2026): a Mac mini's update corrupted its databases. On a Mac the server runs in a Linux virtual machine and writes its SQLite databases (WAL mode)
// through a shared folder; the updater's backup opened them with the Mac's own sqlite3, a second kernel that cannot see the server's locks or its shared-memory index. These tests prove the
// one rule (a database under the data folder's space/ is opened by host tools only when the Docker engine shares this computer's kernel), that the new release carries out its own update,
// that a failed update says what is wrong and how to get the data back, and that doctor on a Mac speaks Mac. The scripts are sourced with VYRE_SOURCE_ONLY=1 and their functions called
// directly, with a fake docker that runs the real node with the container's /data mapped to the Space folder, and recording sqlite3 and node in front of the host's PATH.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "vyre-server");
const INSTALL = path.join(HERE, "install.sh");
const MAC = path.join(HERE, "..", "macos", "install.sh");
const read = (f: string): string => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-r8-"));
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NODE = process.execPath;
const HOST_KERNEL = spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout.trim();
const HOST_BOOT = ((): string => { try { return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); } catch { return ""; } })();
/** An engine on this computer's own kernel, as docker answers for it: the same kernel version and the same boot id. */
const SAME = { kernel: `${HOST_KERNEL}|Ubuntu 24.04.5 LTS`, boot: HOST_BOOT };

type Out = { status: number | null; stdout: string; stderr: string };
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir(), VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A fake docker for a computer whose engine is `kernel` (a Mac's VM, a Linux VM, or this kernel). `exec` and `run` run the real node with the container's paths mapped to the host's. */
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "docker $*" >>"$FAKE_DIR/docker.log"
case "$1" in
  info) [ -z "\${FAKE_KERNEL:-}" ] || printf '%s\\n' "$FAKE_KERNEL"; [ -n "\${FAKE_KERNEL:-}" ] || exit 1; exit 0 ;;
  ps) [ ! -f "$FAKE_DIR/running" ] || echo cid1; exit 0 ;;
  inspect) case "$*" in *Mounts*) echo "volume vyre-server_vyre-data /var/lib/docker/volumes/vyre-server_vyre-data/_data" ;; *State*) echo "true false" ;; *) echo cid1 ;; esac; exit 0 ;;
  volume) case "$2" in inspect) printf '%s\\n' "$FAKE_SPACE" ;; ls) echo vyre-server_vyre-data ;; esac; exit 0 ;;
  pull) case "$*" in *"\${FAKE_PULL_FAIL:-no-such-image}"*) echo "no matching manifest for linux/arm64" >&2; exit 1 ;; esac; exit 0 ;;
  image) exit 0 ;;
  compose)
    case "$*" in
      *" ps --format"*) [ -f "$FAKE_DIR/down" ] || printf 'vyred running healthy\\ncaddy running\\nsites-runner running\\n'; exit 0 ;;
      *" logs "*) cat "$FAKE_DIR/server.log" 2>/dev/null; exit 0 ;;
      *" stop"*) rm -f "$FAKE_DIR/running"; exit 0 ;;
      *" up "*) [ -f "$FAKE_DIR/up-fails" ] && exit 1; : >"$FAKE_DIR/running"; exit 0 ;;
    esac
    exit 0 ;;
  exec)
    shift; [ "$1" != -i ] || shift; shift
    if [ "$1" = cat ]; then [ -n "\${FAKE_BOOT:-}" ] || exit 1; printf '%s\\n' "$FAKE_BOOT"; exit 0; fi
    [ "$1" = node ] || exit 126; shift
    MAP_DATA=$FAKE_SPACE ;;
  run)
    shift; MAP_DATA=""; MAP_IN=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -v) m=$2; src=\${m%%:*}; rest=\${m#*:}; dst=\${rest%%:*}; [ "$dst" != /data ] || MAP_DATA=$src; [ "$dst" != /in ] || MAP_IN=$src; shift 2 ;;
        --entrypoint) EP=$2; shift 2; break ;;
        *) shift ;;
      esac
    done
    shift
    if [ "$EP" = cat ]; then [ -n "\${FAKE_BOOT:-}" ] || exit 1; printf '%s\\n' "$FAKE_BOOT"; exit 0; fi ;;
  *) exit 0 ;;
esac
n=$#
for a do
  case "$a" in /data/*) a="$MAP_DATA/\${a#/data/}" ;; /in/*) a="$MAP_IN/\${a#/in/}" ;; esac
  set -- "$@" "$a"
done
shift "$n"
if [ -n "\${FAKE_TRUNCATE:-}" ]; then "$REAL_NODE" "$@" | head -c "$FAKE_TRUNCATE"; exit 0; fi
exec "$REAL_NODE" "$@"
`;

/** A stand-in for the sqlite3 tool (the box has none; a Mac does): -readonly, -cmd and one statement, rows printed with |. */
const FAKE_SQLITE_JS = `const {DatabaseSync}=require("node:sqlite");const a=process.argv.slice(2);let ro=false;const rest=[];for(let i=0;i<a.length;i++){if(a[i]==="-readonly")ro=true;else if(a[i]==="-cmd")i++;else rest.push(a[i]);}
const [file,sql]=rest;try{const d=new DatabaseSync(file,ro?{readOnly:true}:{});d.exec("PRAGMA busy_timeout=3000");const st=d.prepare(sql);const rows=/^\\s*(select|pragma)/i.test(sql)?st.all():(st.run(),[]);for(const r of rows)console.log(Object.values(r).join("|"));d.close()}catch(e){console.error("Error: "+e.message);process.exit(1)}`;

/** Host tools that record every call and then do the real work: sqlite3 (emulated with node), node, and a chown that fails as it does for a person who is not root. */
function world(dir: string, o: { kernel?: string; boot?: string; running?: boolean; image?: boolean } = {}): Record<string, string> {
  const bin = path.join(dir, "fakebin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "docker"), FAKE_DOCKER, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "fake-sqlite3.js"), FAKE_SQLITE_JS);
  fs.writeFileSync(path.join(bin, "sqlite3"), `#!/bin/sh\nprintf '%s\\n' "sqlite3 $*" >>"${dir}/host.log"\nexec "${NODE}" --no-warnings "${dir}/fake-sqlite3.js" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\nprintf '%s\\n' "node $*" >>"${dir}/host.log"\nexec "${NODE}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "chown"), `#!/bin/sh\necho "chown $*" >>"${dir}/host.log"\nexit 1\n`, { mode: 0o755 });
  if (o.running) fs.writeFileSync(path.join(dir, "running"), ""); else fs.rmSync(path.join(dir, "running"), { force: true });
  const img = o.image === false ? "" : `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${"b".repeat(64)}\n`;
  if (!fs.existsSync(path.join(dir, "compose.env")) || o.image === false) fs.writeFileSync(path.join(dir, "compose.env"), img);
  return { PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_DIR: dir, FAKE_SPACE: path.join(dir, "data", "space"), FAKE_KERNEL: o.kernel ?? "6.8.0-colima|Ubuntu 24.04 (Colima's VM)", FAKE_BOOT: o.boot ?? "", REAL_NODE: NODE, VYRE_DIR: dir };
}
const MAC_ENV = { VYRE_TEST_OS: "Darwin" };

function db(file: string, sql: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync(NODE, ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec(process.argv[2]);d.close()`, file, sql], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}
function mkSpace(dir: string, marker: string): void {
  const space = path.join(dir, "data", "space");
  fs.mkdirSync(path.join(dir, "data", "caddy"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "caddy", "cert.pem"), marker);
  for (const n of ["events.db", "modules.db", "space.db"]) db(path.join(space, n), `PRAGMA journal_mode=WAL;CREATE TABLE t(v TEXT);INSERT INTO t VALUES('${marker}')`);
  db(path.join(space, "modules.db"), "CREATE TABLE network_config (id INTEGER PRIMARY KEY, mode TEXT NOT NULL); INSERT INTO network_config VALUES (1, 'relay');");
}
const valueIn = (file: string): string => spawnSync(NODE, ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare("SELECT v FROM t").get().v)`, file], { encoding: "utf8" }).stdout.trim();
/** Lines of host.log where a host sqlite3 or node was given a file under the live Space folder. */
const hostTouches = (dir: string): string[] => read(path.join(dir, "host.log")).split("\n").filter((l) => /^(sqlite3|node) /.test(l) && new RegExp(`${esc(path.join(dir, "data", "space"))}(/|\\s|$)`).test(l));

// ---- item 1: one rule for every reader of a live database

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
    // a VM with the same kernel version string (Colima, Lima or Multipass on the same Ubuntu kernel): another boot id, so the VM reads it
    fs.rmSync(path.join(dir, "host.log")); fs.rmSync(path.join(dir, "docker.log"));
    const vm = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, world(dir, { running: true, kernel: SAME.kernel, boot: "0f0e0d0c-another-kernel" }));
    assert.equal(vm.status, 0, vm.stderr);
    assert.deepEqual(hostTouches(dir), [], "another kernel: the VM reads it");
    assert.match(read(path.join(dir, "docker.log")), /^docker exec cid1 node/m);
    // vyred is down: the boot id is read in a one-shot container of the server image
    assert.equal(ask(world(dir, { running: false, ...SAME })), "same");
    assert.match(read(path.join(dir, "docker.log")), /^docker run --rm --network none --entrypoint cat ghcr\.io\/vyre-ai\/vyred@sha256:b+ \/proc\/sys\/kernel\/random\/boot_id$/m);
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

/** A release layout the updater can switch between. */
function releases(dir: string, script?: { old: string; new: string }): void {
  for (const v of ["1.0.0", "1.1.0"]) {
    const rel = path.join(dir, "releases", v);
    fs.mkdirSync(path.join(rel, "bin"), { recursive: true });
    fs.writeFileSync(path.join(rel, "VERSION"), v);
    fs.writeFileSync(path.join(rel, ".complete"), "");
    fs.writeFileSync(path.join(rel, "compose.server.yml"), "services: {}\n");
    fs.writeFileSync(path.join(rel, "images.lock"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${(v === "1.0.0" ? "1" : "2").repeat(64)}\nVYRE_AGENT_IMAGE=ghcr.io/vyre-ai/agent-computer@sha256:${"9".repeat(64)}\n`);
    if (script) fs.writeFileSync(path.join(rel, "bin", "vyre-server"), v === "1.0.0" ? script.old : script.new, { mode: 0o755 });
  }
  fs.rmSync(path.join(dir, "current"), { force: true });
  fs.symlinkSync("releases/1.0.0", path.join(dir, "current"));
  fs.writeFileSync(path.join(dir, "vyre.env"), "");
  fs.writeFileSync(path.join(dir, "compose.override.yml"), "");
}

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

// ---- item 2: the new release carries out its own update

/** An old updater with a bug the new one fixed: the optional agent computer image is pulled as if it were required (rc.24 on Apple silicon). */
const buggyOld = (text: string): string => {
  const out = text.replace(/^    if \[ "\$k" = VYRE_AGENT_IMAGE \]; then docker pull -q .*\n/m, "");
  assert.notEqual(out, text, "the fixture found the optional pull to remove");
  return out;
};
function updateWorld(dir: string, env: Record<string, string>): Record<string, string> {
  mkSpace(dir, "U");
  const mounts = path.join(dir, "mounts");
  fs.writeFileSync(mounts, `/dev/mapper/vyre-data / ext4 rw 0 0\n`);
  fs.writeFileSync(path.join(dir, "lsblk"), "#!/bin/sh\nprintf 'crypt\\ndisk\\n'\n", { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "healthy"), "ok");
  fs.writeFileSync(path.join(dir, "data-dir"), path.join(dir, "data"));
  return { ...env, VYRE_TEST_PROC_MOUNTS: mounts, VYRE_TEST_LSBLK: path.join(dir, "lsblk"), VYRE_TEST_HEALTH_URL: `file://${dir}/healthy`, VYRE_TEST_DOCKER_ROOT: "", VYRE_UP_WAIT: "3", VYRE_BIN_DIR: path.join(dir, "nobin"), VYRE_TEST_USERNS_PROC: path.join(dir, "no-userns"), TMPDIR: dir, FAKE_PULL_FAIL: "agent-computer" };
}
const runUpdate = (dir: string, env: Record<string, string>): Out => {
  const r = spawnSync("sh", [path.join(dir, "releases/1.0.0/bin/vyre-server"), "update", "--yes", "--version", "1.1.0"], { encoding: "utf8", env: { PATH: env.PATH!, HOME: os.tmpdir(), VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
/** The first half needs a signed release: here fetch_release is replaced in the old script's text by one that reports the unpacked 1.1.0 (the signature code itself has its own tests). */
const withFetchStub = (text: string): string => text.replace(/^fetch_release\(\) \{\n/m, () => "fetch_release() {\n  REL_VERSION=1.1.0; REL_TARBALL=/nonexistent; return 0\n");

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

// ---- real Docker: the read through the running server's own container, while it writes

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

// ---- item 3: a failed update never leaves a mystery

test("when neither version comes back, the update names the damaged database and prints the restore command for the backup it took, and what that loses; it restores nothing itself", () => {
  const dir = tmp();
  try {
    const text = read(SERVER);
    const env = updateWorld(dir, world(dir, { running: true, ...SAME }));
    const neverHealthy = text.replace(/^check_quiet\(\) \{/m, () => "check_quiet() { return 1; }\ncheck_quiet_unused() {");
    releases(dir, { old: withFetchStub(text), new: neverHealthy });
    fs.writeFileSync(path.join(dir, "server.log"), "vyred-1  | vyred: modules.db is damaged (database disk image is malformed), so the Space cannot start. It is not repaired here. Put back the last good backup on the server: vyre-server restore <backup file> --yes\n");
    const r = runUpdate(dir, env);
    assert.equal(r.status, 5, r.stderr + r.stdout);
    const backup = r.stdout.match(/Backed up to (\S+) while the server kept running/)![1]!;
    assert.match(r.stderr, /the update to 1\.1\.0 failed \(the new version did not pass its health check\) and the server did not come back healthy on 1\.0\.0 either\./);
    assert.match(r.stderr, /The server says: vyred: modules\.db is damaged/);
    assert.match(r.stderr, new RegExp(`The database ${esc(path.join(dir, "data", "space", "modules.db"))} is damaged`));
    assert.match(r.stderr, new RegExp(`To put back the data from just before this update, run:\\n    vyre-server restore ${esc(backup)} --yes\\n`));
    assert.match(r.stderr, /It loses what the Space wrote after that backup, which was taken moments before the server stopped for the switch\./);
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "U", "nothing was restored automatically");
    assert.ok(fs.existsSync(backup), "the backup is there to restore");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "dc $*" >>"${dir}/dc.log"; }; wait_healthy(){ return 0; }; sleep(){ :; }; trap cleanup EXIT; cmd_restore "${file}" --yes`, env);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /The current data would not back up \(a database in it is damaged or unreadable\)\. It is kept whole beside the restored data instead, under a dated name\./);
    const aside = fs.readdirSync(path.join(dir, "data")).filter((n) => /^space\.damaged-\d{8}T\d{6}Z$/.test(n));
    assert.equal(aside.length, 1, `kept aside: ${fs.readdirSync(path.join(dir, "data")).join(" ")}`);
    assert.match(r.stdout, new RegExp(`The damaged data it replaced is kept in ${esc(path.join(dir, "data", aside[0]!))}`));
    assert.equal(valueIn(path.join(dir, "data/space/events.db")), "GOOD", "the backup is in place");
    assert.equal(spawnSync("grep", ["-c", "AFTER", path.join(dir, "data", aside[0]!, "events.db")], { encoding: "utf8" }).stdout.trim() !== "0", true, "the damaged folder is whole");
    assert.deepEqual(read(path.join(dir, "dc.log")).trim().split("\n"), ["dc stop", "dc up -d --remove-orphans"], "stopped once, and started only on the restored data, never on the damaged data in between");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- item 5: doctor on a Mac speaks Mac

function macDoctor(dir: string, o: { filevault: "Yes" | "No"; state?: string; compose?: string }): Out {
  const du = path.join(dir, "diskutil");
  fs.writeFileSync(du, `#!/bin/sh\nprintf '   FileVault:                 ${o.filevault}\\n'\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  if (o.state !== undefined) fs.writeFileSync(path.join(dir, "state/encryption"), o.state); else fs.rmSync(path.join(dir, "state/encryption"), { force: true });
  fs.writeFileSync(path.join(dir, "compose.env"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${"b".repeat(64)}\n${o.compose ?? ""}`);
  fs.writeFileSync(path.join(dir, "healthy"), "ok");
  return sh(SERVER, `DATA_DIR="${dir}/data"; cmd_doctor`, { ...world(dir, { running: true, kernel: "6.8.0-50-generic|Ubuntu 24.04 (colima)" }), ...MAC_ENV, VYRE_TEST_DISKUTIL: du, VYRE_TEST_HEALTH_URL: `file://${dir}/healthy`, VYRE_TEST_DOCKER_ROOT: "", VYRE_TEST_USERNS_PROC: path.join(dir, "no-userns") });
}

test("doctor on a Mac: a plain-disk install (recorded in compose.env or in state) is a warning with its date, not DOWN, and the advice names FileVault, never LUKS or systemd", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "D");
    releases(dir);
    // the choice recorded only where the Console reads it (compose.env), as an install made before state/encryption existed has it
    const a = macDoctor(dir, { filevault: "No", compose: "VYRE_DISK_ENCRYPTION=plain\nVYRE_DISK_ENCRYPTION_SINCE=2026-11-02\n" });
    assert.match(a.stdout, /^warn host\.disk_encrypted +The data is NOT encrypted at rest\. You chose to install on a plain disk on 2026-11-02/m, a.stdout);
    assert.equal(a.status, 0, `doctor can be green: ${a.stdout}`);
    const b = macDoctor(dir, { filevault: "No", state: `kind=plain\nsince=2026-11-03\ndata_dir=${dir}/data\n` });
    assert.match(b.stdout, /^warn host\.disk_encrypted .*plain disk on 2026-11-03/m);
    // no choice made: DOWN, and the way out is the Mac's
    const c = macDoctor(dir, { filevault: "No" });
    assert.equal(c.status, 1);
    assert.match(c.stdout, /^DOWN host\.disk_encrypted +The data directory .* is not on an encrypted volume\. Turn on FileVault \(System Settings > Privacy & Security > FileVault\), or run the Mac installer again with --allow-plain-disk\./m);
    for (const out of [a.stdout, b.stdout, c.stdout]) assert.doesNotMatch(out, /LUKS|systemctl|systemd|\/etc\/|apt|lsblk|\/proc\/mounts|--provider-encrypted/, out);
    const d = macDoctor(dir, { filevault: "Yes" });
    assert.match(d.stdout, /^ok   host\.disk_encrypted/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- item 6: macOS tools

test("on a macOS without readlink -f (before 12.3) the script still finds its install and does not hand off to itself", () => {
  const dir = tmp();
  try {
    releases(dir, { old: read(SERVER), new: read(SERVER) });
    fs.rmSync(path.join(dir, "current")); fs.symlinkSync("releases/1.1.0", path.join(dir, "current"));
    fs.writeFileSync(path.join(dir, "compose.env"), "");
    const bin = path.join(dir, "oldmac");
    fs.mkdirSync(bin);
    const real = spawnSync("sh", ["-c", "command -v readlink"], { encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(bin, "readlink"), `#!/bin/sh\ncase "$1" in -f) echo "readlink: illegal option -- f" >&2; exit 1 ;; esac\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: os.tmpdir() };
    const r = spawnSync("sh", [path.join(dir, "current/bin/vyre-server"), "version"], { encoding: "utf8", env });
    assert.equal(r.stdout.trim(), "1.1.0", `found ${dir} from current/bin without VYRE_DIR: ${r.stderr}`);
    const r2 = spawnSync("sh", [path.join(dir, "releases/1.0.0/bin/vyre-server"), "version"], { encoding: "utf8", env });
    assert.equal(r2.stdout.trim(), "1.1.0", "an old release's copy hands off to current");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an update never replaces the Mac installer's command (it names Docker's folders and context) with the plain Linux wrapper", () => {
  const dir = tmp();
  try {
    const binDir = path.join(dir, "bin");
    fs.mkdirSync(binDir);
    const mac = `#!/bin/sh\n# Vyre Server, installed by install.sh\nVYRE_DIR="${dir}"\nexport VYRE_DIR\nPATH="$PATH:/usr/local/bin:/opt/homebrew/bin"\nexport PATH\nDOCKER_CONTEXT="colima"\nexport DOCKER_CONTEXT\nexec "${dir}/current/bin/vyre-server" "$@"\n`;
    fs.writeFileSync(path.join(binDir, "vyre-server"), mac, { mode: 0o755 });
    const r = sh(SERVER, `DIR="${dir}"; refresh_bin`, { VYRE_BIN_DIR: binDir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(read(path.join(binDir, "vyre-server")), mac, "left as the Mac installer wrote it");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- from the real-Mac run (lead, 12 Nov) and the review

test("two backups in the same second get two names, and many manual backups never push out the newest backups taken before an update or a restore; what goes is named", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "P");
    const env = world(dir, SAME);
    const take = (tag: string): Out => sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; date(){ case "$*" in *%Y%m%dT*) echo 20261112T004605Z ;; *) command date "$@" ;; esac; }; backup_data ${tag} live; echo "$BACKUP_FILE"`, env);
    const names = (): string[] => fs.readdirSync(path.join(dir, "backups")).filter((n) => n.endsWith(".tar.gz")).sort();
    const a = take("manual"), b = take("manual");
    assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    assert.deepEqual(names(), ["vyre-manual-20261112T004605Z-2.tar.gz", "vyre-manual-20261112T004605Z.tar.gz"], "the second did not replace the first");
    for (const n of names()) fs.rmSync(path.join(dir, "backups", n));
    // one before an update, one before a restore, then twelve manual ones
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data pre-1.1.0 live`, env).status, 0);
    assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data pre-restore live`, env).status, 0);
    let last: Out = a;
    for (let i = 0; i < 12; i++) last = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data manual live`, env);
    const left = names();
    assert.equal(left.filter((n) => n.startsWith("vyre-manual-")).length, 3, left.join(" "));
    assert.equal(left.filter((n) => n.startsWith("vyre-pre-1.1.0-")).length, 1, "the backup from before the update stays");
    assert.equal(left.filter((n) => n.startsWith("vyre-pre-restore-")).length, 1, "the backup from before the restore stays");
    assert.match(last.stdout, /^  Removed an older backup: vyre-manual-\S+\.tar\.gz$/m, "what goes is named");
    // the kinds keep their own few: a third backup before an update pushes out only the oldest of that kind
    for (const v of ["1.2.0", "1.3.0"]) assert.equal(sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data pre-${v} live`, env).status, 0);
    const pre = names().filter((n) => /^vyre-pre-\d/.test(n));
    assert.equal(pre.length, 2, pre.join(" "));
    assert.ok(!pre.some((n) => n.startsWith("vyre-pre-1.1.0-")), "the oldest pre-update backup went first");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the copy-off hint on a Mac names the file and says to take it off this Mac, never root@", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "H");
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; cmd_backup`, { ...world(dir, { running: true }), ...MAC_ENV, VYRE_TEST_FS_DEVICE: `${dir}=/dev/disk3s1` });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Copy this file off this Mac \(an external disk, or another computer\):\n    \S+\/backups\/vyre-manual-\S+\.tar\.gz$/m);
    assert.doesNotMatch(r.stdout, /root@/);
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
