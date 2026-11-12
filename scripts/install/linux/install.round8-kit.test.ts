// Shared fixtures of the round 8 installer tests (install.round8.*.test.ts and install.round8.heavy.test.ts): split from one file that ran past the fast runner's 30 s cap.
// Round 8 of the installer (12 Nov 2026): a Mac mini's update corrupted its databases. On a Mac the server runs in a Linux virtual machine and writes its SQLite databases (WAL mode)
// through a shared folder; the updater's backup opened them with the Mac's own sqlite3, a second kernel that cannot see the server's locks or its shared-memory index. These tests prove the
// one rule (a database under the data folder's space/ is opened by host tools only when the Docker engine shares this computer's kernel), that the new release carries out its own update,
// that a failed update says what is wrong and how to get the data back, and that doctor on a Mac speaks Mac. The scripts are sourced with VYRE_SOURCE_ONLY=1 and their functions called
// directly, with a fake docker that runs the real node with the container's /data mapped to the Space folder, and recording sqlite3 and node in front of the host's PATH.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SERVER = path.join(HERE, "vyre-server");
export const INSTALL = path.join(HERE, "install.sh");
export const MAC = path.join(HERE, "..", "macos", "install.sh");
export const read = (f: string): string => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
export const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-r8-"));
export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const NODE = process.execPath;
export const HOST_KERNEL = spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout.trim();
// One fixed boot id stands for "this computer's kernel" on both sides: the host's (VYRE_TEST_BOOT_ID_FILE, which world() passes) and the engine's (the fake docker's FAKE_BOOT
// for SAME). No test reads /proc, so these run the same on a macOS runner, which has none.
export const HOST_BOOT = "5a5e5a5e-0000-4000-8000-this-kernel-test";
export const BOOT_FILE = ((): string => { const f = path.join(os.tmpdir(), `vyre-r8-boot-id-${process.pid}`); fs.writeFileSync(f, `${HOST_BOOT}\n`); return f; })();
/** An engine on this computer's own kernel, as docker answers for it: the same kernel version and the same boot id. */
export const SAME = { kernel: `${HOST_KERNEL}|Ubuntu 24.04.5 LTS`, boot: HOST_BOOT };

export type Out = { status: number | null; stdout: string; stderr: string };
export function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir(), VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A fake docker for a computer whose engine is `kernel` (a Mac's VM, a Linux VM, or this kernel). `exec` and `run` run the real node with the container's paths mapped to the host's. */
export const FAKE_DOCKER = `#!/bin/sh
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
export const FAKE_SQLITE_JS = `const {DatabaseSync}=require("node:sqlite");const a=process.argv.slice(2);let ro=false;const rest=[];for(let i=0;i<a.length;i++){if(a[i]==="-readonly")ro=true;else if(a[i]==="-cmd")i++;else rest.push(a[i]);}
const [file,sql]=rest;try{const d=new DatabaseSync(file,ro?{readOnly:true}:{});d.exec("PRAGMA busy_timeout=3000");const st=d.prepare(sql);const rows=/^\\s*(select|pragma)/i.test(sql)?st.all():(st.run(),[]);for(const r of rows)console.log(Object.values(r).join("|"));d.close()}catch(e){console.error("Error: "+e.message);process.exit(1)}`;

/** Host tools that record every call and then do the real work: sqlite3 (emulated with node), node, and a chown that fails as it does for a person who is not root. */
export function world(dir: string, o: { kernel?: string; boot?: string; running?: boolean; image?: boolean } = {}): Record<string, string> {
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
  return { PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_DIR: dir, FAKE_SPACE: path.join(dir, "data", "space"), FAKE_KERNEL: o.kernel ?? "6.8.0-colima|Ubuntu 24.04 (Colima's VM)", FAKE_BOOT: o.boot ?? "", REAL_NODE: NODE, VYRE_DIR: dir, VYRE_TEST_BOOT_ID_FILE: BOOT_FILE };
}
export const MAC_ENV = { VYRE_TEST_OS: "Darwin" };

export function db(file: string, sql: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync(NODE, ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec(process.argv[2]);d.close()`, file, sql], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}
export function mkSpace(dir: string, marker: string): void {
  const space = path.join(dir, "data", "space");
  fs.mkdirSync(path.join(dir, "data", "caddy"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "caddy", "cert.pem"), marker);
  for (const n of ["events.db", "modules.db", "space.db"]) db(path.join(space, n), `PRAGMA journal_mode=WAL;CREATE TABLE t(v TEXT);INSERT INTO t VALUES('${marker}')`);
  db(path.join(space, "modules.db"), "CREATE TABLE network_config (id INTEGER PRIMARY KEY, mode TEXT NOT NULL); INSERT INTO network_config VALUES (1, 'relay');");
}
export const valueIn = (file: string): string => spawnSync(NODE, ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare("SELECT v FROM t").get().v)`, file], { encoding: "utf8" }).stdout.trim();
/** Lines of host.log where a host sqlite3 or node was given a file under the live Space folder. */
export const hostTouches = (dir: string): string[] => read(path.join(dir, "host.log")).split("\n").filter((l) => /^(sqlite3|node) /.test(l) && new RegExp(`${esc(path.join(dir, "data", "space"))}(/|\\s|$)`).test(l));

// ---- item 1: one rule for every reader of a live database





/** A release layout the updater can switch between. */
export function releases(dir: string, script?: { old: string; new: string }): void {
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



// ---- item 2: the new release carries out its own update

/** An old updater with a bug the new one fixed: the optional agent computer image is pulled as if it were required (rc.24 on Apple silicon). */
export const buggyOld = (text: string): string => {
  const out = text.replace(/^    if \[ "\$k" = VYRE_AGENT_IMAGE \]; then docker pull -q .*\n/m, "");
  assert.notEqual(out, text, "the fixture found the optional pull to remove");
  return out;
};
export function updateWorld(dir: string, env: Record<string, string>): Record<string, string> {
  mkSpace(dir, "U");
  const mounts = path.join(dir, "mounts");
  fs.writeFileSync(mounts, `/dev/mapper/vyre-data / ext4 rw 0 0\n`);
  fs.writeFileSync(path.join(dir, "lsblk"), "#!/bin/sh\nprintf 'crypt\\ndisk\\n'\n", { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "healthy"), "ok");
  fs.writeFileSync(path.join(dir, "data-dir"), path.join(dir, "data"));
  return { ...env, VYRE_TEST_PROC_MOUNTS: mounts, VYRE_TEST_LSBLK: path.join(dir, "lsblk"), VYRE_TEST_HEALTH_URL: `file://${dir}/healthy`, VYRE_TEST_DOCKER_ROOT: "", VYRE_UP_WAIT: "3", VYRE_BIN_DIR: path.join(dir, "nobin"), VYRE_TEST_USERNS_PROC: path.join(dir, "no-userns"), TMPDIR: dir, FAKE_PULL_FAIL: "agent-computer" };
}
export const runUpdate = (dir: string, env: Record<string, string>): Out => {
  const r = spawnSync("sh", [path.join(dir, "releases/1.0.0/bin/vyre-server"), "update", "--yes", "--version", "1.1.0"], { encoding: "utf8", env: { PATH: env.PATH!, HOME: os.tmpdir(), VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
/** The first half needs a signed release: here fetch_release is replaced in the old script's text by one that reports the unpacked 1.1.0 (the signature code itself has its own tests). */
export const withFetchStub = (text: string): string => text.replace(/^fetch_release\(\) \{\n/m, () => "fetch_release() {\n  REL_VERSION=1.1.0; REL_TARBALL=/nonexistent; return 0\n");



// ---- real Docker: the read through the running server's own container, while it writes



// ---- item 3: a failed update never leaves a mystery



// ---- item 5: doctor on a Mac speaks Mac

export function macDoctor(dir: string, o: { filevault: "Yes" | "No"; state?: string; compose?: string }): Out {
  const du = path.join(dir, "diskutil");
  fs.writeFileSync(du, `#!/bin/sh\nprintf '   FileVault:                 ${o.filevault}\\n'\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  if (o.state !== undefined) fs.writeFileSync(path.join(dir, "state/encryption"), o.state); else fs.rmSync(path.join(dir, "state/encryption"), { force: true });
  fs.writeFileSync(path.join(dir, "compose.env"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${"b".repeat(64)}\n${o.compose ?? ""}`);
  fs.writeFileSync(path.join(dir, "healthy"), "ok");
  return sh(SERVER, `DATA_DIR="${dir}/data"; cmd_doctor`, { ...world(dir, { running: true, kernel: "6.8.0-50-generic|Ubuntu 24.04 (colima)" }), ...MAC_ENV, VYRE_TEST_DISKUTIL: du, VYRE_TEST_HEALTH_URL: `file://${dir}/healthy`, VYRE_TEST_DOCKER_ROOT: "", VYRE_TEST_USERNS_PROC: path.join(dir, "no-userns") });
}


// ---- item 6: macOS tools



// ---- from the real-Mac run (lead, 12 Nov) and the review




// ---- bringing an old Mac forward safely





// ---- review follow-ups (12 Nov, after eaf9db420)

/** A stand-in for vyred holding on a damaged database: every request 503 with the damaged line. */
export async function holdingServer(): Promise<{ url: string; stop: () => void }> {
  const port = 30000 + (process.pid % 20000);
  const child = spawn(NODE, ["-e", `require("node:http").createServer((q,s)=>{s.writeHead(503,{"content-type":"application/json"});s.end(JSON.stringify({ok:false,status:"damaged",error:{code:"space.damaged",message:"modules.db is damaged (database disk image is malformed), so the Space cannot start. It is not repaired here. Put back the last good backup on the server: vyre-server restore <backup file> --yes"}}))}).listen(${port},"127.0.0.1",()=>console.log("up"))`], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((r) => child.stdout.once("data", () => r()));
  return { url: `http://127.0.0.1:${port}/healthz`, stop: () => child.kill() };
}
