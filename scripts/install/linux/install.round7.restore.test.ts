// The two restore proofs of round 7, in a file of their own: together with the port and reader proofs (install.round7.test.ts) one file ran 24 to 32 s, at the fast runner's 30 s cap,
// and failed whenever the runner was busy. Nothing in either file changed but where it lives.
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
