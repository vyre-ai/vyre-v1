// The release switch, the command, the host setting and image pruning of vyre-server, split from install.test.ts (round 8) so each file stays well under the fast runner's 30 s cap.
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

// An engine on this computer's own kernel (vyre-server decides by the boot id read inside Docker): these tests model a Linux server whose Docker runs on its own kernel.
const SAME_ENGINE = `Ubuntu|${((): string => { try { return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); } catch { return "no-boot-id"; } })()}`;
type Out = { status: number | null; stdout: string; stderr: string };
/** Runs a snippet of sh with a script's functions loaded and nothing else executed. */
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_ENGINE: SAME_ENGINE, VYRE_TEST_OS: "Linux", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A fake /proc/mounts and lsblk: `dir` sits on a device, and lsblk -s lists `layers` for it. */
function fakeHost(dir: string, opts: { fs?: string; src?: string; layers?: string[] }): { mounts: string; lsblk: string } {
  const mounts = path.join(dir, "mounts");
  const lsblk = path.join(dir, "lsblk");
  fs.writeFileSync(mounts, `/dev/sda1 / ext4 rw 0 0\n${opts.src ?? "/dev/mapper/vyre-data"} ${dir} ${opts.fs ?? "ext4"} rw 0 0\n`);
  fs.writeFileSync(lsblk, `#!/bin/sh\nprintf '${(opts.layers ?? ["crypt", "disk"]).join("\\n")}\\n'\n`, { mode: 0o755 });
  return { mounts, lsblk };
}
const hostEnv = (h: { mounts: string; lsblk: string }): Record<string, string> => ({ VYRE_TEST_PROC_MOUNTS: h.mounts, VYRE_TEST_LSBLK: h.lsblk });

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
  const r = spawnSync("node", ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify({ok:d.prepare("PRAGMA integrity_check").get().integrity_check,rows:d.prepare("SELECT count(*) c FROM t").get().c}))`, db], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout) as { ok: string; rows: number };
  return o;
}

function installFixture(dir: string): void {
  for (const [v, img] of [["1.0.0", "old"], ["1.1.0", "new"]] as const) {
    fs.mkdirSync(path.join(dir, "releases", v), { recursive: true });
    fs.writeFileSync(path.join(dir, "releases", v, "images.lock"), `VYRE_IMAGE=${img}@sha256:${"a".repeat(64)}\nVYRE_AGENT_IMAGE=ghcr.io/vyre-ai/agent-computer@sha256:${(img === "old" ? "1" : "2").repeat(64)}\n`);
    fs.writeFileSync(path.join(dir, "releases", v, ".complete"), "");
    fs.writeFileSync(path.join(dir, "releases", v, "VERSION"), v);
  }
  fs.symlinkSync("releases/1.1.0", path.join(dir, "current"));
  fs.writeFileSync(path.join(dir, "compose.env"), `VYRE_PORT=8420\nVYRE_IMAGE=new@sha256:${"a".repeat(64)}\nDOCKER_GID=1\n`);
}

test("compose.server.yml: vyred may make the namespaces bubblewrap needs, and the agent image variable is the one the updater writes", () => {
  const yml = read(path.join(HERE, "../../../images/vyred/compose.server.yml"));
  const vyred = /^  vyred:\n([\s\S]*?)^  sites-runner:/m.exec(yml)?.[1] ?? "";
  for (const opt of ["no-new-privileges:true", "seccomp=unconfined", "apparmor=unconfined", "systempaths=unconfined"]) {
    assert.match(vyred, new RegExp(`security_opt:[\\s\\S]*- ${opt}`), `vyred has ${opt}`);
  }
  const reads = /\$\{(VYRE_AGENT_COMPUTER_IMAGE)(?::-[^}]*)?\}/.exec(vyred)?.[1];
  assert.equal(reads, "VYRE_AGENT_COMPUTER_IMAGE", "compose reads VYRE_AGENT_COMPUTER_IMAGE");
  assert.match(read(path.join(HERE, "vyre-server")), /printf 'VYRE_AGENT_COMPUTER_IMAGE=%s\\n'/, "the updater writes the variable compose reads");
  assert.match(read(path.join(HERE, "install.sh")), /VYRE_AGENT_COMPUTER_IMAGE/, "the installer writes it too");
});

test("hand_off runs the current release's script when this one is not it, once, and never when it is", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    fs.mkdirSync(path.join(dir, "releases/1.1.0/bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "releases/1.1.0/bin/vyre-server"), `#!/bin/sh\necho "current ran: $* handoff=$VYRE_HANDOFF dir=$VYRE_DIR"\n`, { mode: 0o755 });
    // an old copy elsewhere: sourcing nothing, it is this script's real text with main run
    const old = path.join(dir, "old-vyre-server");
    fs.copyFileSync(SERVER, old);
    const r = spawnSync("sh", [old, "doctor", "--quiet"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_DIR: dir } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /current ran: doctor --quiet handoff=1 dir=/, "same arguments, marked as the second hop");
    // the current release's own script does not hand off to itself
    assert.match(read(SERVER), /\[ "\$me" != "\$there" \] \|\| return 0/);
    // a second hop never hands off again, even from a file that is not current
    const r2 = spawnSync("sh", [old, "version"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_DIR: dir, VYRE_HANDOFF: "1" } });
    assert.equal(r2.stdout.trim(), "1.1.0");
    // the release's own script (current) answers itself
    fs.copyFileSync(SERVER, path.join(dir, "releases/1.1.0/bin/vyre-server"));
    const r3 = spawnSync("sh", [path.join(dir, "current/bin/vyre-server"), "version"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_DIR: dir } });
    assert.equal(r3.stdout.trim(), "1.1.0");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("refresh_bin replaces an installed full copy with the wrapper, leaves a wrapper and a foreign file alone", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    const bin = path.join(dir, "bin"); fs.mkdirSync(bin);
    const f = path.join(bin, "vyre-server");
    fs.copyFileSync(SERVER, f);
    const r = sh(SERVER, "refresh_bin", { VYRE_DIR: dir, VYRE_BIN_DIR: bin });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(read(f), `#!/bin/sh\n# Vyre Server, installed by install.sh\nexec "${dir}/current/bin/vyre-server" "$@"\n`);
    assert.equal(fs.statSync(f).mode & 0o111, 0o111);
    const before = fs.statSync(f).mtimeMs;
    sh(SERVER, "refresh_bin", { VYRE_DIR: dir, VYRE_BIN_DIR: bin });
    assert.equal(fs.statSync(f).mtimeMs, before, "a wrapper is not rewritten");
    fs.writeFileSync(f, "#!/bin/sh\necho someone else's\n");
    sh(SERVER, "refresh_bin", { VYRE_DIR: dir, VYRE_BIN_DIR: bin });
    assert.match(read(f), /someone else's/, "a file that is not ours stays");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ensure_userns writes the sysctl file and applies it only where the kernel has the setting; doctor names it when it is 1", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    const sd = path.join(dir, "sysctl.d");
    const shim = path.join(dir, "shim"); fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, "sysctl"), `#!/bin/sh\necho "sysctl $*" >> "${dir}/sysctl.log"\n`, { mode: 0o755 });
    const env = { VYRE_DIR: dir, VYRE_SYSCTL_DIR: sd, PATH: `${shim}:${process.env.PATH ?? ""}` };
    // no such setting on this kernel: nothing is written
    let r = sh(SERVER, "ensure_userns", { ...env, VYRE_TEST_USERNS_PROC: path.join(dir, "absent") });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(sd, "60-vyre-userns.conf")), false);
    // the setting exists
    const proc = path.join(dir, "userns"); fs.writeFileSync(proc, "1\n");
    r = sh(SERVER, "ensure_userns", { ...env, VYRE_TEST_USERNS_PROC: proc });
    assert.equal(r.status, 0, r.stderr);
    assert.match(read(path.join(sd, "60-vyre-userns.conf")), /^kernel\.apparmor_restrict_unprivileged_userns = 0$/m);
    assert.match(read(path.join(dir, "sysctl.log")), /^sysctl -p .*60-vyre-userns\.conf$/m, "applied now");
    // doctor names it while it is 1, and not once it is 0
    const finding = (v: string): string => { fs.writeFileSync(proc, v); return sh(SERVER, 'FINDINGS=""; DOWN=0; check_all >/dev/null 2>&1; printf "%s" "$FINDINGS"', { ...env, VYRE_TEST_USERNS_PROC: proc }).stdout; };
    assert.match(finding("1\n"), /host\.userns[\s\S]*apparmor_restrict_unprivileged_userns is 1/);
    assert.match(finding("0\n"), /host\.userns[\s\S]*allows the user namespaces/);
    // the update and the rollback both call it, and the installer asks the release to
    const text = read(SERVER);
    assert.match(text, /refresh_bin\n  ensure_userns\n  reason=""/, "update");
    assert.match(text, /refresh_bin\n  ensure_userns\n  up_stack \|\| die/, "rollback");
    assert.match(read(path.join(HERE, "install.sh")), /userns_setting\n  pull_images/, "install");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("up_stack recreates Caddy when it is not on the vyred that runs now, and leaves it when it is", () => {
  const dir = tmp();
  try {
    const run = (caddyMode: string): string => {
      const log = path.join(dir, "dc.log"); fs.rmSync(log, { force: true });
      const fake = `dc(){ echo "dc $*" >>"${log}"; case "$1 $2 $3" in "ps -q vyred") echo vy1 ;; "ps -q caddy") echo cd1 ;; esac; return 0; }; docker(){ case "$3" in "{{.Id}}") echo FULLVY ;; "{{.HostConfig.NetworkMode}}") echo "${caddyMode}" ;; esac; }`;
      const r = sh(SERVER, `${fake}; up_stack`, { VYRE_DIR: dir });
      assert.equal(r.status, 0, r.stderr);
      return read(log);
    };
    const stale = run("container:OLDVY");
    assert.match(stale, /^dc up -d --remove-orphans$/m);
    assert.match(stale, /^dc up -d --force-recreate --no-deps caddy$/m, "Caddy on the old vyred is recreated");
    const fresh = run("container:FULLVY");
    assert.doesNotMatch(fresh, /force-recreate/, "Caddy on the running vyred is left alone");
    const text = read(SERVER);
    assert.doesNotMatch(text.slice(text.indexOf("cmd_update()")), /dc up -d --remove-orphans >\/dev\/null 2>&1; then reason/, "the update goes through up_stack");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** A docker that answers from files: images.txt ("<id> <repo>@<digest>"), used (ids a container was made from), labels/<id>, cmd/<id>, busy (ids rmi refuses); every rmi is logged. */
function fakeDocker(dir: string, o: { images: string[]; used?: string[]; labels?: Record<string, string>; cmds?: Record<string, string>; busy?: string[]; down?: boolean }): { bin: string; removed: () => string[] } {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(path.join(dir, "fx/labels"), { recursive: true });
  fs.mkdirSync(path.join(dir, "fx/cmd"), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, "fx/images.txt"), o.images.join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "fx/used"), (o.used ?? []).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "fx/busy"), (o.busy ?? []).join("\n") + "\n");
  for (const [k, v] of Object.entries(o.labels ?? {})) fs.writeFileSync(path.join(dir, "fx/labels", k.replace(":", "_")), v);
  for (const [k, v] of Object.entries(o.cmds ?? {})) fs.writeFileSync(path.join(dir, "fx/cmd", k.replace(":", "_")), v);
  fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh
FX="${dir}/fx"
idof() { awk -v x="$1" '$1 == x || $2 == x { print $1; exit }' "$FX/images.txt"; }
case "$1" in
  info) ${o.down ? "exit 1" : "exit 0"} ;;
  images) cat "$FX/images.txt" ;;
  ps) id=""; for a in "$@"; do case "$a" in ancestor=*) id=\${a#ancestor=} ;; esac; done; grep -qx "$id" "$FX/used" && echo c1; exit 0 ;;   # per argument: macOS bash 3.2 applies \${*##...} to each one
  image) shift; shift; shift; fmt="$1"; id=$(idof "$2") || exit 1; [ -n "$id" ] || exit 1
    case "$fmt" in
      "{{.Id}}") echo "$id" ;;
      *Labels*) cat "$FX/labels/$(echo "$id" | tr : _)" 2>/dev/null || echo "<no value>" ;;
      *Cmd*) cat "$FX/cmd/$(echo "$id" | tr : _)" 2>/dev/null || echo "" ;;
    esac ;;
  rmi) id=$(idof "$2"); grep -qx "$id" "$FX/busy" && exit 1; echo "$2" >>"$FX/rmi.log"; exit 0 ;;
esac
`, { mode: 0o755 });
  return { bin, removed: () => (fs.existsSync(path.join(dir, "fx/rmi.log")) ? read(path.join(dir, "fx/rmi.log")).trim().split("\n") : []) };
}

test("prune_images removes agent computer, workspace and browser images no kept release names, and nothing else", () => {
  const dir = tmp();
  try {
    const D = (n: string): string => `sha256:${n.padEnd(64, "0")}`;
    fs.mkdirSync(path.join(dir, "releases/1.1.0"), { recursive: true });
    fs.mkdirSync(path.join(dir, "releases/1.0.9"), { recursive: true });
    fs.writeFileSync(path.join(dir, "releases/1.1.0/images.lock"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyre@${D("5e")}\nVYRE_AGENT_IMAGE=ghcr.io/vyre-ai/agent-computer@${D("c1")}\nVYRE_WORKSPACE_IMAGE=ghcr.io/vyre-ai/workspace@${D("w1")}\n`);
    fs.writeFileSync(path.join(dir, "releases/1.0.9/images.lock"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyre@${D("5d")}\nVYRE_AGENT_IMAGE=ghcr.io/vyre-ai/agent-computer@${D("c0")}\n`);
    fs.writeFileSync(path.join(dir, "compose.env"), `VYRE_AGENT_COMPUTER_IMAGE=ghcr.io/vyre-ai/agent-computer@${D("c1")}\n`);
    const images = [
      [D("c1"), `ghcr.io/vyre-ai/agent-computer@${D("c1")}`],          // this release: kept
      [D("c0"), `ghcr.io/vyre-ai/agent-computer@${D("c0")}`],          // the release a rollback goes to: kept
      [D("w1"), `ghcr.io/vyre-ai/workspace@${D("w1")}`],               // this release's workspace: kept
      [D("a1"), `ghcr.io/vyre-ai/agent-computer@${D("a1")}`],          // old: removed
      [D("a2"), `ghcr.io/vyre-ai/workspace@${D("a2")}`],               // old workspace: removed
      [D("a3"), `ghcr.io/vyre-ai/space-browser@${D("a3")}`],           // old browser: removed
      [D("u1"), `ghcr.io/vyre-ai/agent-computer@${D("u1")}`],          // a stopped computer was made from it: kept
      [D("h1"), "vyre/agent-computer@<none>"],                          // built by hand: kept
      [D("h2"), `ghcr.io/vyre-ai/agent-computer@${D("h2")}`],          // old, but the same image is also tagged by hand: kept
      [D("h2"), "vyre/agent-computer@<none>"],
      [D("d1"), "<none>@<none>"],                                       // untagged, agentd inside: removed
      [D("d2"), "<none>@<none>"],                                       // untagged, something else: kept
      [D("l1"), `ghcr.io/other/thing@${D("l1")}`],                      // carries the Vyre image label: removed
      [D("s0"), `ghcr.io/vyre-ai/vyre@${D("s0")}`],                     // an old server image: not ours to remove
      [D("b1"), `ghcr.io/vyre-ai/agent-computer@${D("b1")}`],          // old, but docker refuses to remove it: not counted
    ].map(([id, ref]) => `${id} ${ref}`);
    const f = fakeDocker(dir, { images, used: [D("u1")], labels: { [D("l1")]: "space-browser" }, cmds: { [D("d1")]: "node /opt/agentd/main.ts", [D("d2")]: "postgres" }, busy: [D("b1")] });
    const out = sh(SERVER, "prune_images", { VYRE_DIR: dir, PATH: `${f.bin}:${process.env.PATH ?? ""}` });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(f.removed().sort(), [`ghcr.io/vyre-ai/agent-computer@${D("a1")}`, `ghcr.io/vyre-ai/space-browser@${D("a3")}`, `ghcr.io/vyre-ai/workspace@${D("a2")}`, `ghcr.io/other/thing@${D("l1")}`, D("d1")].sort());
    assert.match(out.stdout, /Removed 5 old agent computer, workspace or browser images\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("prune_images does nothing, and says nothing, when Docker is not answering, and a second run has nothing left to remove", () => {
  const dir = tmp();
  try {
    const f = fakeDocker(dir, { images: [`sha256:${"a".repeat(64)} ghcr.io/vyre-ai/agent-computer@sha256:${"a".repeat(64)}`], down: true });
    const out = sh(SERVER, "prune_images", { VYRE_DIR: dir, PATH: `${f.bin}:${process.env.PATH ?? ""}` });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, "");
    assert.deepEqual(f.removed(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an update prunes images only after it is healthy: never before the switch, never on a rollback", () => {
  for (const healthy of [true, false]) {
    const dir = tmp();
    try {
      for (const version of ["1.0.0", "1.1.0"]) { fs.mkdirSync(path.join(dir, "releases", version), { recursive: true }); fs.writeFileSync(path.join(dir, "releases", version, "images.lock"), "VYRE_IMAGE=fixture@sha256:" + "a".repeat(64) + "\n"); }
      fs.symlinkSync("releases/1.0.0", path.join(dir, "current")); fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=fixture@sha256:" + "a".repeat(64) + "\n"); fs.writeFileSync(path.join(dir, "vyre.env"), "");
      const body = 'cur_version(){ printf 1.0.0; }; fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; docker(){ return 0; }; backup_data(){ BACKUP_FILE=fixture; }; set_current(){ :; }; dc(){ return ' + (healthy ? "0" : "1") + '; }; wait_healthy(){ return 0; }; prune_releases(){ echo releases >>"$VYRE_FIXTURE_DIR/order"; }; prune_images(){ echo images >>"$VYRE_FIXTURE_DIR/order"; }; cmd_update --yes --version 1.1.0 --sha256 ' + "a".repeat(64);
      const out = sh(SERVER, body, { VYRE_DIR: dir, VYRE_FIXTURE_DIR: dir, TMPDIR: dir });
      assert.equal(out.status, healthy ? 0 : 4, out.stderr);
      const order = fs.existsSync(path.join(dir, "order")) ? read(path.join(dir, "order")).trim().split("\n") : [];
      assert.deepEqual(order, healthy ? ["releases", "images"] : [], "images are pruned after the old releases are, and only on a healthy update");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("an update backs up while the server runs, and the server is down only for the switch; --stopped-backup keeps the old order", () => {
  for (const mode of ["live", "stopped"]) {
    const dir = tmp();
    try {
      for (const version of ["1.0.0", "1.1.0"]) { fs.mkdirSync(path.join(dir, "releases", version), { recursive: true }); fs.writeFileSync(path.join(dir, "releases", version, "images.lock"), "VYRE_IMAGE=fixture@sha256:" + "a".repeat(64) + "\n"); }
      fs.symlinkSync("releases/1.0.0", path.join(dir, "current")); fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=fixture@sha256:" + "a".repeat(64) + "\n"); fs.writeFileSync(path.join(dir, "vyre.env"), "");
      const log = (w: string): string => `echo "${w}" >>"$VYRE_FIXTURE_DIR/order"`;
      const body = `cur_version(){ printf 1.0.0; }; fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; docker(){ return 0; }; backup_data(){ ${log("backup $*")}; BACKUP_FILE=fixture; [ "\${2:-}" = live ] || ${log("stop (inside the backup)")}; }; `
        + `dc(){ ${log("dc $*")}; return 0; }; stop_strays(){ ${log("stop strays")}; }; set_current(){ ${log("switch $1")}; }; sync_image(){ :; }; up_stack(){ ${log("start")}; }; wait_healthy(){ ${log("healthy")}; return 0; }; prune_releases(){ :; }; prune_images(){ :; }; `
        + `cmd_update --yes --version 1.1.0 --sha256 ${"a".repeat(64)} ${mode === "stopped" ? "--stopped-backup" : ""}`;
      const out = sh(SERVER, body, { VYRE_DIR: dir, VYRE_FIXTURE_DIR: dir, TMPDIR: dir });
      assert.equal(out.status, 0, out.stderr);
      const order = read(path.join(dir, "order")).trim().split("\n");
      if (mode === "live") {
        assert.deepEqual(order, ["backup pre-1.1.0 live", "dc stop", "stop strays", "switch 1.1.0", "start", "healthy"], "the backup finishes with the server up; only then is it stopped, and the switch follows at once");
        assert.match(out.stdout, /while the server kept running/);
      } else {
        assert.deepEqual(order, ["backup pre-1.1.0", "stop (inside the backup)", "switch 1.1.0", "start", "healthy"], "--stopped-backup stops the server first, for one copy that is consistent across the database files");
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("a live-backup update that fails to start rolls back and starts the previous release again", () => {
  const dir = tmp();
  try {
    for (const version of ["1.0.0", "1.1.0"]) { fs.mkdirSync(path.join(dir, "releases", version), { recursive: true }); fs.writeFileSync(path.join(dir, "releases", version, "images.lock"), "VYRE_IMAGE=fixture@sha256:" + "a".repeat(64) + "\n"); }
    fs.symlinkSync("releases/1.0.0", path.join(dir, "current")); fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=fixture@sha256:" + "a".repeat(64) + "\n"); fs.writeFileSync(path.join(dir, "vyre.env"), "");
    const log = (w: string): string => `echo "${w}" >>"$VYRE_FIXTURE_DIR/order"`;
    const body = `cur_version(){ printf 1.0.0; }; fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; docker(){ return 0; }; backup_data(){ ${log("backup $*")}; BACKUP_FILE=fixture; }; `
      + `dc(){ ${log("dc $*")}; return 0; }; stop_strays(){ :; }; set_current(){ ${log("switch $1")}; }; sync_image(){ :; }; up_stack(){ ${log("start")}; [ "$(grep -c '^start$' "$VYRE_FIXTURE_DIR/order")" -gt 1 ]; }; wait_healthy(){ return 0; }; prune_releases(){ :; }; prune_images(){ :; }; `
      + `cmd_update --yes --version 1.1.0 --sha256 ${"a".repeat(64)}`;
    const out = sh(SERVER, body, { VYRE_DIR: dir, VYRE_FIXTURE_DIR: dir, TMPDIR: dir });
    assert.equal(out.status, 4, out.stderr);
    assert.deepEqual(read(path.join(dir, "order")).trim().split("\n"), ["backup pre-1.1.0 live", "dc stop", "switch 1.1.0", "start", "dc logs --no-color --tail 80 vyred", "switch 1.0.0", "start"], "the new version's last log lines are kept, then back on the previous release, started again");
    assert.equal(fs.existsSync(path.join(dir, "state", "update.pending")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
