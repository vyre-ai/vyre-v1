// Mac installer (P-L10_10, spec 3.13, ARCH 7.13, R18): the checks that need no Mac. The scripts are sourced with VYRE_SOURCE_ONLY=1 (or run whole in test mode with a
// recording docker, launchctl and fdesetup) so each test names one rule: FileVault required, the pinned downloads, the signature, the VM size, the launchd jobs, the whole
// install and uninstall on a Docker Desktop Mac. Colima itself, a container, Caddy reaching it and a reboot are S14: install.heavy.test.sh, which needs a real Mac.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(HERE, "install.sh");
const SERVER = path.join(HERE, "vyre-server");
const read = (f: string): string => fs.readFileSync(f, "utf8");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mac-test-"));
const NODE = process.execPath;

type Out = { status: number | null; stdout: string; stderr: string };
/** Runs a snippet of sh with a script's functions loaded and nothing else executed. */
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir(), VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_VERIFY_NODE: NODE, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A fake `fdesetup` and `diskutil`. */
function fakeMac(dir: string, o: { fileVault?: "On" | "Off" | "none"; volume?: "Yes" | "No" | "none" }): Record<string, string> {
  const fde = path.join(dir, "fdesetup");
  const du = path.join(dir, "diskutil");
  const fv = o.fileVault ?? "On";
  fs.writeFileSync(fde, fv === "none" ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\necho "FileVault is ${fv}."\n`, { mode: 0o755 });
  const vol = o.volume ?? "Yes";
  fs.writeFileSync(du, vol === "none" ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\nprintf '   Volume Name:  Data\\n   FileVault:    ${vol}\\n   Encrypted:    ${vol}\\n'\n`, { mode: 0o755 });
  return { VYRE_TEST_FDESETUP: fde, VYRE_TEST_DISKUTIL: du };
}

function block(file: string, name: string): string {
  const m = read(file).match(new RegExp(`# BEGIN ${name}\\n[\\s\\S]*?# END ${name}\\n`));
  assert.ok(m, `${path.basename(file)} has a ${name} block`);
  return m[0];
}

test("install.sh, vyre-server and the heavy test are valid POSIX sh, and the launchd jobs are well-formed property lists", () => {
  for (const f of [INSTALL, SERVER, path.join(HERE, "install.heavy.test.sh")]) {
    const r = spawnSync("sh", ["-n", f], { encoding: "utf8" });
    assert.equal(r.status, 0, `${path.basename(f)}: ${r.stderr}`);
  }
  for (const n of fs.readdirSync(path.join(HERE, "units"))) {
    const t = read(path.join(HERE, "units", n));
    assert.match(t, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!-- @MARK@ -->\n<!DOCTYPE plist/);
    assert.match(t, new RegExp(`<key>Label</key><string>${n.replace(/\.plist$/, "").replace(/\./g, "\\.")}</string>`), `${n} names itself`);
    assert.equal((t.match(/<dict>/g) ?? []).length, (t.match(/<\/dict>/g) ?? []).length, `${n}: dict tags balance`);
    assert.equal((t.match(/<array>/g) ?? []).length, (t.match(/<\/array>/g) ?? []).length, `${n}: array tags balance`);
    const left = (t.match(/@[A-Z_]+@/g) ?? []).filter((x) => !["@MARK@", "@VYRE_DIR@", "@BIN@", "@USER@", "@HOME@"].includes(x));
    assert.deepEqual(left, [], `${n}: only the known placeholders`);
  }
});

test("the disk check, the version order and the release block are the same text in the installer and in vyre-server", () => {
  for (const name of ["diskcheck", "semver", "release"]) assert.equal(block(INSTALL, name), block(SERVER, name), `${name} block differs`);
});

test("the installer carries a release public key and no private key; it is made to be piped from curl", () => {
  const i = read(INSTALL);
  assert.match(i, /-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=]{44,}\n-----END PUBLIC KEY-----/);
  assert.doesNotMatch(i, /PRIVATE KEY/);
  assert.doesNotMatch(read(SERVER), /PRIVATE KEY/);
  const lines = i.trimEnd().split("\n");
  assert.match(lines[lines.length - 1]!, /^if \[ "\$\{VYRE_SOURCE_ONLY:-0\}" != 1 \]; then main "\$@"; fi$/);
  const r = sh(INSTALL, "echo loaded; command -v main >/dev/null && echo has-main");
  assert.match(r.stdout, /loaded\nhas-main/);
});

test("the release key is the same one the Linux installer checks against", () => {
  const key = (f: string): string => read(f).match(/-----BEGIN PUBLIC KEY-----\n(.*)\n-----END PUBLIC KEY-----/)![1]!;
  assert.equal(key(INSTALL), key(path.join(HERE, "..", "linux", "install.sh")));
});

// ---- FileVault ----

test("disk_encrypted: FileVault on passes, FileVault off does not, no answer is reported as such; a volume under /Volumes is asked about itself", () => {
  const dir = tmp();
  const at = (p: string, o: Parameters<typeof fakeMac>[1]): number | null => sh(INSTALL, `disk_encrypted "${p}"`, fakeMac(dir, o)).status;
  assert.equal(at("/Users/me/.vyre-server/data", { fileVault: "On" }), 0);
  assert.equal(at("/Users/me/.vyre-server/data", { fileVault: "Off" }), 1);
  assert.equal(at("/Users/me/.vyre-server/data", { fileVault: "none" }), 2);
  assert.equal(at("/Volumes/Data/vyre", { fileVault: "Off", volume: "Yes" }), 0, "an encrypted external volume counts, whatever the startup volume does");
  assert.equal(at("/Volumes/Data/vyre", { fileVault: "On", volume: "No" }), 1, "a plain external volume does not count, even with FileVault on for the startup volume");
  assert.equal(at("/Volumes/Data/vyre", { volume: "none" }), 2);
  fs.rmSync(dir, { recursive: true });
});

test("check_encrypted refuses a Mac without FileVault with exit 3 and the steps, and passes one with it", () => {
  const dir = tmp();
  const bad = sh(INSTALL, `check_encrypted "${dir}/data"`, fakeMac(dir, { fileVault: "Off" }));
  assert.equal(bad.status, 3);
  assert.match(bad.stderr, /not on an encrypted volume/);
  assert.match(bad.stderr, /FileVault/);
  assert.match(bad.stderr, /--data-dir/);
  const unknown = sh(INSTALL, `check_encrypted "${dir}/data"`, fakeMac(dir, { fileVault: "none" }));
  assert.equal(unknown.status, 3, "a volume it cannot verify is refused too");
  assert.match(unknown.stderr, /that this installer can verify/);
  const ok = sh(INSTALL, `check_encrypted "${dir}/data"`, fakeMac(dir, { fileVault: "On" }));
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /FileVault/);
  fs.rmSync(dir, { recursive: true });
});

test("vyre-server doctor reports the same disk rule", () => {
  const dir = tmp();
  const off = sh(SERVER, `DATA_DIR="${dir}/data"; check_all; printf '%s\\n' "$FINDINGS"; echo "down=$DOWN"`, fakeMac(dir, { fileVault: "Off" }));
  assert.match(off.stdout, /host\.disk_encrypted\tdown\t/);
  assert.match(off.stdout, /FileVault/);
  assert.match(off.stdout, /down=1/);
  const on = sh(SERVER, `DATA_DIR="${dir}/data"; check_all; printf '%s\\n' "$FINDINGS"`, fakeMac(dir, { fileVault: "On" }));
  assert.match(on.stdout, /host\.disk_encrypted\thealthy\t/);
  fs.rmSync(dir, { recursive: true });
});

// ---- the Mac, the VM size, the arguments ----

test("check_macos wants macOS 13 or newer; cpu names the two Apple architectures and refuses others", () => {
  const v = (x: string): Out => sh(INSTALL, "check_macos", { VYRE_MACOS_VERSION: x });
  assert.equal(v("14.5").status, 0);
  assert.equal(v("13.0").status, 0);
  assert.notEqual(v("12.7").status, 0);
  assert.match(v("12.7").stderr, /macOS 13 or newer/);
  const c = (m: string): Out => sh(INSTALL, "cpu", { VYRE_UNAME_M: m });
  assert.equal(c("arm64").stdout, "arm64");
  assert.equal(c("x86_64").stdout, "x86_64");
  assert.notEqual(c("ppc").status, 0);
});

test("colima_size: 5 GiB for the Space, never under 4 GiB or over half the Mac's memory, 4 CPUs from 8 cores, and under 4 GB of memory it refuses", () => {
  const size = (gib: number, cores: number): Out => sh(INSTALL, `colima_size; echo "mem=$COLIMA_MEM_GIB cpus=$COLIMA_CPU_COUNT"`, { VYRE_RAM_BYTES: String(gib * 1073741824), VYRE_NCPU: String(cores) });
  assert.match(size(16, 8).stdout, /mem=5 cpus=4/);
  assert.match(size(16, 4).stdout, /mem=5 cpus=2/);
  assert.match(size(8, 10).stdout, /mem=4 cpus=4/, "half of 8 is 4");
  assert.match(size(4, 2).stdout, /mem=4 cpus=2/, "the floor is 4");
  const small = size(3, 2);
  assert.notEqual(small.status, 0);
  assert.match(small.stderr, /at least 4 GB/);
});

test("parse_args: two ways to reach the server are refused, a bad channel and a bad domain are refused, --relay takes an optional URL, the data folder defaults under the install", () => {
  const args = (a: string): Out => sh(INSTALL, `parse_args ${a}; echo "relay=$RELAY domain=$DOMAIN channel=$CHANNEL data=$DATA_DIR"`, { VYRE_DIR: "/Users/me/.vyre-server" });
  assert.match(args("--domain a.example.com --relay").stderr, /choose one/);
  assert.match(args("--channel weekly").stderr, /stable, beta or nightly/);
  assert.match(args("--domain 'bad host!'").stderr, /host name/);
  assert.match(args("--relay").stdout, /relay=https:\/\/relay\.vyre\.run /);
  assert.match(args("--relay https://r.example.com --yes").stdout, /relay=https:\/\/r\.example\.com /);
  assert.match(args("--data-dir /Volumes/Data/vyre").stdout, /data=\/Volumes\/Data\/vyre$/m);
  assert.match(args("--yes").stdout, /data=\/Users\/me\/\.vyre-server\/data$/m);
  assert.match(args("--bogus").stderr, /unknown option/);
});

test("ver_cmp orders versions the way semver does", () => {
  const cmp = (a: string, b: string): string => sh(INSTALL, `ver_cmp "${a}" "${b}"`).stdout.trim();
  assert.equal(cmp("1.2.3", "1.2.3"), "0");
  assert.equal(cmp("1.10.0", "1.9.9"), "1");
  assert.equal(cmp("1.0.0-beta.2", "1.0.0"), "-1");
  assert.equal(sh(INSTALL, `ver_cmp "latest" "1.0.0"`).status, 2);
});

// ---- the signed release ----

/** A manifest and an Ed25519 signature over "vyre-release-sums\n" + the manifest, made with openssl. */
function signed(dir: string, manifest: string, keyName = "release"): { manifest: string; sig: string; pub: string } {
  const key = path.join(dir, `${keyName}.key`);
  const pub = path.join(dir, `${keyName}.pub`);
  if (!fs.existsSync(key)) {
    assert.equal(spawnSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", key]).status, 0, "openssl 3 makes an Ed25519 key");
    assert.equal(spawnSync("openssl", ["pkey", "-in", key, "-pubout", "-out", pub]).status, 0);
  }
  const m = path.join(dir, `${keyName}.json`);
  fs.writeFileSync(m, manifest);
  const msg = path.join(dir, `${keyName}.msg`);
  fs.writeFileSync(msg, Buffer.concat([Buffer.from("vyre-release-sums\n"), Buffer.from(manifest)]));
  const raw = path.join(dir, `${keyName}.sigraw`);
  assert.equal(spawnSync("openssl", ["pkeyutl", "-sign", "-inkey", key, "-rawin", "-in", msg, "-out", raw]).status, 0);
  const sig = path.join(dir, `${keyName}.sig`);
  fs.writeFileSync(sig, fs.readFileSync(raw).toString("base64") + "\n");
  return { manifest: m, sig, pub };
}

for (const [label, script] of [["install.sh", INSTALL], ["vyre-server", SERVER]] as const) {
  test(`${label}: verify_manifest (with Node, not LibreSSL) accepts the release key's signature and rejects a changed manifest, another key and a short signature`, () => {
    const dir = tmp();
    const body = '{"v":1,"channel":"stable","server_mac":{"version":"1.0.0","sha256":"' + "a".repeat(64) + '"}}\n';
    const s = signed(dir, body);
    const verify = (m: string, sig: string, pub: string): number | null => sh(script, `TMP="${dir}"; verify_manifest "${m}" "${sig}"`, { VYRE_RELEASE_KEY_PEM: pub }).status;
    assert.equal(verify(s.manifest, s.sig, s.pub), 0, "good signature");
    const tampered = path.join(dir, "tampered.json");
    fs.writeFileSync(tampered, body.replace("1.0.0", "9.9.9"));
    assert.notEqual(verify(tampered, s.sig, s.pub), 0, "a changed manifest");
    const other = signed(dir, body, "other");
    assert.notEqual(verify(other.manifest, other.sig, s.pub), 0, "signed by another key");
    const short = path.join(dir, "short.sig");
    fs.writeFileSync(short, Buffer.from("too short").toString("base64"));
    assert.notEqual(verify(s.manifest, short, s.pub), 0, "a signature of the wrong length");
    assert.notEqual(verify(s.manifest, path.join(dir, "absent.sig"), s.pub), 0, "no signature file");
    fs.rmSync(dir, { recursive: true });
  });
}

test("a key or a Node from the environment is honoured only in test mode", () => {
  const dir = tmp();
  const s = signed(dir, '{"v":1}\n');
  const r = spawnSync("sh", ["-c", `. "${INSTALL}"\nDIR="${dir}/none"; TMP="${dir}"; verify_manifest "${s.manifest}" "${s.sig}"`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1", VYRE_RELEASE_KEY_PEM: s.pub, VYRE_VERIFY_NODE: NODE } });
  assert.notEqual(r.status, 0, "outside test mode the pinned Node under $DIR/tools is used, and the key in the script");
  fs.rmSync(dir, { recursive: true });
});

test("unpack_release refuses a path that leaves its folder, a link, and a release that lacks a file (the three launchd plists included)", () => {
  const dir = tmp();
  const mk = (name: string, build: (d: string) => void): string => {
    const d = path.join(dir, name);
    fs.mkdirSync(path.join(d, "rel/bin"), { recursive: true });
    fs.mkdirSync(path.join(d, "rel/units"), { recursive: true });
    for (const f of ["VERSION", "compose.server.yml", "Caddyfile", "images.lock", "bin/vyre-server", "units/run.vyre.server.plist", "units/run.vyre.colima.plist", "units/run.vyre.server-update.plist"]) fs.writeFileSync(path.join(d, "rel", f), f === "VERSION" ? "1.0.0" : "x");
    build(d);
    const tgz = path.join(d, "r.tgz");
    assert.equal(spawnSync("tar", ["-czf", tgz, "-C", d, "rel"]).status, 0);
    return tgz;
  };
  const unpack = (tgz: string, work: string): Out => sh(INSTALL, `DIR="${work}"; REL_VERSION=1.0.0; REL_TARBALL="${tgz}"; DRY=0; unpack_release`, {});
  const w1 = path.join(dir, "w1");
  const g = unpack(mk("good", () => {}), w1);
  assert.equal(g.status, 0, g.stderr);
  assert.ok(fs.existsSync(path.join(w1, "releases/1.0.0/.complete")));
  assert.equal(fs.statSync(path.join(w1, "releases/1.0.0/bin/vyre-server")).mode & 0o111, 0o111);
  const l = unpack(mk("link", (d) => fs.symlinkSync("/etc/passwd", path.join(d, "rel/evil"))), path.join(dir, "w2"));
  assert.match(l.stderr, /holds a link/);
  assert.ok(!fs.existsSync(path.join(dir, "w2/releases/1.0.0")), "nothing was left behind");
  assert.match(unpack(mk("missing", (d) => fs.rmSync(path.join(d, "rel/units/run.vyre.colima.plist"))), path.join(dir, "w3")).stderr, /has no units\/run\.vyre\.colima\.plist/);
  assert.match(unpack(mk("wrong", (d) => fs.writeFileSync(path.join(d, "rel/VERSION"), "2.0.0")), path.join(dir, "w4")).stderr, /VERSION file does not match/);
  fs.rmSync(dir, { recursive: true });
});

// ---- the pinned downloads ----

function fakeTools(dir: string): { files: Record<string, string>; env: Record<string, string> } {
  const sha = (f: string): string => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const w = path.join(dir, "dl");
  fs.mkdirSync(path.join(w, "lima/bin"), { recursive: true });
  fs.mkdirSync(path.join(w, "docker/docker"), { recursive: true });
  fs.writeFileSync(path.join(w, "colima"), "#!/bin/sh\necho colima\n");
  fs.writeFileSync(path.join(w, "compose"), "#!/bin/sh\necho compose\n");
  fs.writeFileSync(path.join(w, "lima/bin/limactl"), "#!/bin/sh\necho lima\n", { mode: 0o755 });
  fs.writeFileSync(path.join(w, "docker/docker/docker"), "#!/bin/sh\necho docker\n", { mode: 0o755 });
  assert.equal(spawnSync("tar", ["-czf", path.join(w, "lima.tgz"), "-C", path.join(w, "lima"), "."]).status, 0);
  assert.equal(spawnSync("tar", ["-czf", path.join(w, "docker.tgz"), "-C", path.join(w, "docker"), "."]).status, 0);
  const url = (n: string): string => `file://${path.join(w, n)}`;
  return {
    files: { colima: path.join(w, "colima") },
    env: {
      VYRE_COLIMA_URL: url("colima"), VYRE_COLIMA_SHA256: sha(path.join(w, "colima")),
      VYRE_LIMA_URL: url("lima.tgz"), VYRE_LIMA_SHA256: sha(path.join(w, "lima.tgz")),
      VYRE_DOCKER_URL: url("docker.tgz"), VYRE_DOCKER_SHA256: sha(path.join(w, "docker.tgz")),
      VYRE_COMPOSE_URL: url("compose"), VYRE_COMPOSE_SHA256: sha(path.join(w, "compose")),
    },
  };
}

test("install_colima installs Colima, Lima, docker and Compose into $DIR/tools only after every download matches its pinned checksum", () => {
  const dir = tmp();
  const t = fakeTools(dir);
  const work = path.join(dir, "srv");
  const tmpd = path.join(dir, "tmp");
  fs.mkdirSync(tmpd);
  const run = (env: Record<string, string>): Out => sh(INSTALL, `DIR="${work}"; TMP="${tmpd}"; DRY=0; install_colima`, { VYRE_UNAME_M: "arm64", ...t.env, ...env });
  const bad = run({ VYRE_LIMA_SHA256: "0".repeat(64) });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Lima download does not match its pinned checksum/);
  assert.ok(!fs.existsSync(path.join(work, "tools")), "a bad download installs nothing, not even the files that were fine");
  const none = run({ VYRE_COLIMA_SHA256: "" });
  assert.match(none.stderr, /no pinned Colima/);
  const ok = run({});
  assert.equal(ok.status, 0, ok.stderr);
  for (const f of ["tools/bin/colima", "tools/bin/docker", "tools/bin/docker-compose", "tools/lima/bin/limactl"]) assert.equal(fs.statSync(path.join(work, f)).mode & 0o111, 0o111, `${f} is executable`);
  const dry = sh(INSTALL, `DIR="${dir}/dry"; TMP="${tmpd}"; DRY=1; install_colima`, { VYRE_UNAME_M: "arm64", ...t.env });
  assert.match(dry.stdout, /would download Colima/);
  assert.ok(!fs.existsSync(path.join(dir, "dry")), "--dry-run downloads nothing");
  fs.rmSync(dir, { recursive: true });
});

test("the pinned sums in the installer are 64 hex digits for both CPUs", () => {
  const i = read(INSTALL);
  for (const k of ["COLIMA", "LIMA", "DOCKER", "COMPOSE"]) for (const a of ["ARM64", "AMD64"]) assert.match(i, new RegExp(`^${k}_SHA256_${a}=[0-9a-f]{64}$`, "m"));
  for (const a of ["ARM64", "X64"]) assert.match(i, new RegExp(`^NODE_SHA256_${a}=[0-9a-f]{64}$`, "m"));
});

// ---- configuration and launchd ----

test("space_id: a new install names a Space, a re-run keeps it, and an id handed in is honoured", () => {
  const dir = tmp();
  const fresh = sh(INSTALL, `DIR="${dir}"; space_id`, {});
  assert.match(fresh.stdout, /^spc_[0-9a-f]{24}$/);
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_SPACE=spc_kept\nVYRE_PORT=8420\n");
  assert.equal(sh(INSTALL, `DIR="${dir}"; space_id`, { VYRE_SPACE: "spc_other" }).stdout, "spc_kept");
  fs.rmSync(path.join(dir, "compose.env"));
  assert.equal(sh(INSTALL, `DIR="${dir}"; space_id`, { VYRE_SPACE: "spc_handed" }).stdout, "spc_handed");
  fs.rmSync(dir, { recursive: true });
});

test("write_config keeps the setup code out of arguments and output, at mode 0600, names the Space and the runtime, and a re-run keeps what the person set", () => {
  const dir = tmp();
  const d = path.join(dir, "srv");
  const rel = path.join(d, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  const body = `DIR="${d}"; DATA_DIR="${d}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="vyre.example.com"; RELAY=""; RUNTIME=colima; DRY=0; UPDATE_URL=https://vyre.run/server/; write_config`;
  const first = sh(INSTALL, body, { VYRE_CODE: "code-77" });
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout + first.stderr, /code-77/);
  const envFile = path.join(d, "vyre.env");
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  assert.equal(read(envFile), "VYRE_SETUP_CODE=code-77\n");
  const compose = read(path.join(d, "compose.env"));
  assert.match(compose, /^VYRE_IMAGE=ghcr\.io\/vyre-ai\/vyred@sha256:b{64}$/m);
  assert.match(compose, /^VYRE_SPACE=spc_[0-9a-f]{24}$/m);
  assert.match(compose, /^VYRE_ADDRESS=vyre\.example\.com$/m);
  assert.equal(read(path.join(d, "runtime")).trim(), "colima");
  assert.match(read(path.join(d, "compose.override.yml")), /device: .*\/data\/space/);
  assert.equal(fs.statSync(path.join(d, "data")).mode & 0o777, 0o700);
  const space = compose.match(/^VYRE_SPACE=(.*)$/m)![1];
  fs.appendFileSync(envFile, "MINE=1\n");
  const again = sh(INSTALL, body.replace('DOMAIN="vyre.example.com"', 'DOMAIN=""'), { VYRE_CODE: "other-code" });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(read(envFile), "VYRE_SETUP_CODE=code-77\nMINE=1\n", "vyre.env is never overwritten");
  const c2 = read(path.join(d, "compose.env"));
  assert.match(c2, /^VYRE_ADDRESS=vyre\.example\.com$/m, "the address chosen first is kept");
  assert.match(c2, new RegExp(`^VYRE_SPACE=${space}$`, "m"), "the Space id is kept");
  fs.rmSync(dir, { recursive: true });
});

test("the launchd jobs: Colima and the daily update restart or repeat, the server job runs once at boot and is retried while it fails, all as the account that owns the install", () => {
  const u = (n: string): string => read(path.join(HERE, "units", n));
  const col = u("run.vyre.colima.plist"), srv = u("run.vyre.server.plist"), upd = u("run.vyre.server-update.plist");
  for (const t of [col, srv, upd]) {
    assert.match(t, /<key>UserName<\/key><string>@USER@<\/string>/, "runs as the account, not root");
    assert.match(t, /<key>HOME<\/key><string>@HOME@<\/string>/);
    assert.match(t, /<key>PATH<\/key><string>@VYRE_DIR@\/tools\/bin:@VYRE_DIR@\/tools\/lima\/bin:/, "the pinned tools come first");
    assert.match(t, /<string>@BIN@<\/string>/);
  }
  assert.match(col, /<string>colima-run<\/string>/);
  assert.match(col, /<key>RunAtLoad<\/key><true\/>[\s\S]*<key>KeepAlive<\/key><true\/>/, "Colima starts at boot and is kept running");
  assert.match(srv, /<string>start<\/string>/);
  assert.match(srv, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(srv, /<key>SuccessfulExit<\/key><false\/>/, "tried again only while it fails");
  assert.match(upd, /<string>update<\/string>\s*<string>--yes<\/string>/);
  assert.match(upd, /<key>Hour<\/key><integer>4<\/integer>/);
  assert.doesNotMatch(upd, /RunAtLoad|KeepAlive/, "the update does not run at boot");
});

test("write_units fills the plists, hands them to root and marks them; load_job replaces a job that is already loaded; Docker Desktop gets no Colima job", () => {
  const dir = tmp();
  const d = path.join(dir, "srv");
  const rel = path.join(d, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.cpSync(path.join(HERE, "units"), path.join(rel, "units"), { recursive: true });
  const plists = path.join(dir, "LaunchDaemons");
  const lc = path.join(dir, "launchctl");
  fs.writeFileSync(lc, `#!/bin/sh\necho "$*" >> "${dir}/launchctl.log"\n`, { mode: 0o755 });
  const env = { VYRE_LAUNCHD_DIR: plists, VYRE_LAUNCHCTL: lc, VYRE_SUDO: "", VYRE_BIN_DIR: path.join(dir, "bin"), USER: "irfad", HOME: "/Users/irfad" };
  const common = `DIR="${d}"; REL_VERSION=1.0.0; DRY=0; TMP="${dir}"; ME=irfad; PLIST_DIR="${plists}"; LAUNCHCTL="${lc}"; SUDO=""; BIN_DIR="${path.join(dir, "bin")}"; HOME=/Users/irfad`;
  const r = sh(INSTALL, `${common}; RUNTIME=desktop; write_units; load_job run.vyre.server; load_job run.vyre.server-update`, env);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(plists).sort(), ["run.vyre.server-update.plist", "run.vyre.server.plist"], "no Colima job on Docker Desktop");
  const t = read(path.join(plists, "run.vyre.server.plist"));
  assert.doesNotMatch(t, /@[A-Z_]+@/);
  assert.match(t, /<!-- Vyre Server, installed by install\.sh -->/);
  assert.match(t, new RegExp(`<string>${path.join(dir, "bin", "vyre-server").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</string>`));
  assert.match(t, /<key>UserName<\/key><string>irfad<\/string>/);
  assert.match(t, new RegExp(`<key>VYRE_DIR</key><string>${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</string>`));
  const log = read(path.join(dir, "launchctl.log"));
  assert.match(log, /bootout system\/run\.vyre\.server\n/);
  assert.match(log, /bootstrap system .*run\.vyre\.server\.plist\n/);
  assert.match(log, /enable system\/run\.vyre\.server-update\n/);
  const c = sh(INSTALL, `${common}; RUNTIME=colima; write_units`, env);
  assert.equal(c.status, 0, c.stderr);
  assert.ok(fs.existsSync(path.join(plists, "run.vyre.colima.plist")), "Colima gets its job");
  const dry = sh(INSTALL, `${common}; RUNTIME=colima; DRY=1; load_job run.vyre.colima; write_units`, env);
  assert.match(dry.stdout, /would run as administrator: launchctl bootstrap system/);
  assert.match(dry.stdout, /would write the launchd jobs \(run\.vyre\.colima run\.vyre\.server run\.vyre\.server-update \)/);
  fs.rmSync(dir, { recursive: true });
});

test("--dry-run on the whole installer stops at FileVault: a Mac without it exits 3 before anything is written", () => {
  const dir = tmp();
  const target = path.join(dir, "srv");
  const r = spawnSync("sh", [INSTALL, "--yes", "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: dir, VYRE_TEST_MODE: "1", VYRE_TEST_ROOT_OK: "1", VYRE_MACOS_VERSION: "14.5", VYRE_DIR: target, ...fakeMac(dir, { fileVault: "Off" }) } });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /FileVault/);
  assert.ok(!fs.existsSync(target));
  fs.rmSync(dir, { recursive: true });
});

test("the installer refuses to run as root, and removes only what it wrote (marked plists and command)", () => {
  const dir = tmp();
  const r = spawnSync("sh", [INSTALL, "--yes"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: dir, VYRE_TEST_MODE: "1", VYRE_UNAME_M: "arm64" } });
  if (process.getuid?.() === 0) { assert.notEqual(r.status, 0); assert.match(r.stderr, /not as root/); }
  const i = read(INSTALL);
  assert.match(i, /grep -q "\$MARK" "\$p"/);
  assert.match(i, /grep -q "\$MARK" "\$BIN_DIR\/vyre-server"/);
  fs.rmSync(dir, { recursive: true });
});

// ---- the whole install and uninstall, on a Mac with Docker Desktop (every outside tool recorded) ----

/** A release the way the channel serves it: a signed manifest naming server_mac and a tarball with the real vyre-server and the real plists. */
function buildChannel(dir: string): { env: Record<string, string>; chan: string } {
  const chan = path.join(dir, "chan");
  const stage = path.join(dir, "stage/vyre-server-mac-1.0.0");
  fs.mkdirSync(path.join(stage, "bin"), { recursive: true });
  fs.mkdirSync(chan, { recursive: true });
  fs.writeFileSync(path.join(stage, "VERSION"), "1.0.0");
  fs.writeFileSync(path.join(stage, "compose.server.yml"), "name: vyre-server\n");
  fs.writeFileSync(path.join(stage, "Caddyfile"), "{\n}\n");
  const digest = (n: string): string => `ghcr.io/vyre-ai/${n}@sha256:${"c".repeat(64)}`;
  fs.writeFileSync(path.join(stage, "images.lock"), `VYRE_IMAGE=${digest("vyred")}\nVYRE_AGENT_IMAGE=${digest("agent")}\nVYRE_SANDBOX_IMAGE=${digest("sandbox")}\n`);
  fs.copyFileSync(SERVER, path.join(stage, "bin/vyre-server"));
  fs.cpSync(path.join(HERE, "units"), path.join(stage, "units"), { recursive: true });
  const tgz = path.join(chan, "vyre-server-mac-1.0.0.tgz");
  assert.equal(spawnSync("tar", ["-czf", tgz, "-C", path.dirname(stage), "vyre-server-mac-1.0.0"]).status, 0);
  const sum = createHash("sha256").update(fs.readFileSync(tgz)).digest("hex");
  const manifest = JSON.stringify({ v: 1, channel: "stable", server: { version: "9.9.9", tarball: "linux.tgz", sha256: "f".repeat(64) }, server_mac: { version: "1.0.0", tarball: "vyre-server-mac-1.0.0.tgz", sha256: sum } }) + "\n";
  const s = signed(dir, manifest);
  fs.copyFileSync(s.manifest, path.join(chan, "stable.json"));
  fs.copyFileSync(s.sig, path.join(chan, "stable.json.sig"));
  return { chan, env: { VYRE_UPDATE_URL: `file://${chan}/`, VYRE_RELEASE_KEY_PEM: s.pub } };
}

test("a whole install on a Mac with Docker Desktop: signature checked, Space named, plists loaded, images pulled, server started, doctor green; then uninstall keeps the data and removes only its own files", () => {
  const dir = tmp();
  const home = path.join(dir, "home");
  const d = path.join(home, ".vyre-server");
  fs.mkdirSync(home);
  const { env: chanEnv } = buildChannel(dir);
  const shim = path.join(dir, "shim");
  fs.mkdirSync(shim);
  const log = path.join(dir, "docker.log");
  fs.writeFileSync(path.join(shim, "docker"), `#!/bin/sh
sub=""
for a in "$@"; do case "$a" in version|ps|up|stop|logs|inspect|pull|info) sub=$a; break ;; esac; done
case "$sub" in
  info) exit 0 ;;
  version) echo 2.32.4 ;;
  ps) printf 'vyred running healthy\\ncaddy running \\n' ;;
  pull) echo "$*" >> "${log}" ;;
  inspect) exit 0 ;;
  *) echo "$*" >> "${log}" ;;
esac
`, { mode: 0o755 });
  const lc = path.join(shim, "launchctl");
  fs.writeFileSync(lc, `#!/bin/sh\necho "$*" >> "${dir}/launchctl.log"\n`, { mode: 0o755 });
  const app = path.join(dir, "Docker.app");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(dir, "healthz"), '{"ok":true}\n');
  const plists = path.join(dir, "LaunchDaemons");
  const bin = path.join(dir, "usr-local-bin");
  const env = {
    PATH: `${shim}:${process.env.PATH ?? ""}`, HOME: home, USER: "irfad", VYRE_TEST_MODE: "1", VYRE_TEST_ROOT_OK: "1", VYRE_VERIFY_NODE: NODE, VYRE_SUDO: "",
    VYRE_DIR: d, VYRE_BIN_DIR: bin, VYRE_LAUNCHD_DIR: plists, VYRE_LAUNCHCTL: lc, VYRE_DOCKER_APP: app, VYRE_MACOS_VERSION: "14.5", VYRE_UNAME_M: "arm64",
    VYRE_MIN_FREE_MB: "100", VYRE_UP_WAIT: "30", VYRE_RUNTIME_WAIT: "10", VYRE_TEST_HEALTH_URL: `file://${dir}/healthz`, VYRE_CODE: "setup-code-123",
    ...fakeMac(dir, { fileVault: "On" }), ...chanEnv,
  };
  const run = (...args: string[]): Out => {
    const r = spawnSync("sh", [INSTALL, "--yes", "--relay", ...args], { encoding: "utf8", env });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const i = run();
  assert.equal(i.status, 0, `${i.stdout}\n${i.stderr}`);
  assert.match(i.stdout, /the release signature verifies/);
  assert.match(i.stdout, /Container runtime: Docker Desktop/);
  assert.match(i.stdout, /vyre-server doctor is green/);
  assert.doesNotMatch(i.stdout + i.stderr, /setup-code-123/);
  assert.equal(read(path.join(d, "current/VERSION")), "1.0.0");
  const compose = read(path.join(d, "compose.env"));
  assert.match(compose, /^VYRE_SPACE=spc_[0-9a-f]{24}$/m);
  assert.match(compose, /^VYRE_RELAY_URL=https:\/\/relay\.vyre\.run$/m);
  assert.equal(read(path.join(d, "runtime")).trim(), "desktop");
  assert.equal(fs.statSync(path.join(d, "vyre.env")).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(plists).sort(), ["run.vyre.server-update.plist", "run.vyre.server.plist"]);
  const wrapper = read(path.join(bin, "vyre-server"));
  assert.match(wrapper, /Vyre Server, installed by install\.sh/);
  assert.match(wrapper, new RegExp(`VYRE_DIR="${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  const dlog = read(log);
  assert.equal((dlog.match(/^pull -q /gm) ?? []).length, 3, "the server, agent and sandbox images are pulled by digest");
  assert.match(dlog, /up -d --remove-orphans --wait/);
  const llog = read(path.join(dir, "launchctl.log"));
  assert.match(llog, /bootstrap system .*run\.vyre\.server\.plist/);
  assert.match(llog, /bootstrap system .*run\.vyre\.server-update\.plist/);
  assert.doesNotMatch(llog, /colima/);

  const space = compose.match(/^VYRE_SPACE=(.*)$/m)![1];
  const again = run();
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
  assert.match(read(path.join(d, "compose.env")), new RegExp(`^VYRE_SPACE=${space}$`, "m"), "a second install keeps the Space");

  fs.writeFileSync(path.join(plists, "other.plist"), "not ours\n");
  fs.writeFileSync(path.join(plists, "run.vyre.colima.plist"), "someone else's file with this name\n");
  fs.writeFileSync(path.join(d, "data/space/keep.txt"), "the Space\n");
  const un = spawnSync("sh", [INSTALL, "--yes", "--uninstall"], { encoding: "utf8", env });
  assert.equal(un.status, 0, `${un.stdout}\n${un.stderr}`);
  assert.deepEqual(fs.readdirSync(plists).sort(), ["other.plist", "run.vyre.colima.plist"], "only the marked plists are removed");
  assert.match(un.stdout, /was not written by this installer; left alone/);
  assert.ok(!fs.existsSync(path.join(bin, "vyre-server")));
  assert.equal(read(path.join(d, "data/space/keep.txt")), "the Space\n", "the data stays");
  const purge = spawnSync("sh", [INSTALL, "--yes", "--uninstall", "--purge"], { encoding: "utf8", env });
  assert.equal(purge.status, 0, `${purge.stdout}\n${purge.stderr}`);
  assert.ok(!fs.existsSync(d), "--purge removes the install and its data");
  fs.rmSync(dir, { recursive: true });
});

test("the same install on a Mac without FileVault stops at exit 3 and writes nothing", () => {
  const dir = tmp();
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  const { env: chanEnv } = buildChannel(dir);
  const r = spawnSync("sh", [INSTALL, "--yes"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home, VYRE_TEST_MODE: "1", VYRE_TEST_ROOT_OK: "1", VYRE_VERIFY_NODE: NODE, VYRE_MACOS_VERSION: "14.5", VYRE_UNAME_M: "arm64", VYRE_DIR: path.join(home, ".vyre-server"), VYRE_LAUNCHD_DIR: path.join(dir, "ld"), VYRE_SUDO: "", ...fakeMac(dir, { fileVault: "Off" }), ...chanEnv } });
  assert.equal(r.status, 3, r.stderr);
  assert.ok(!fs.existsSync(path.join(home, ".vyre-server")));
  assert.ok(!fs.existsSync(path.join(dir, "ld")));
  fs.rmSync(dir, { recursive: true });
});

test("@heavy S14 on a real Mac (install.heavy.test.sh): skipped by name anywhere else", { skip: process.platform === "darwin" && process.env["VYRE_HEAVY_MAC"] === "1" ? false : "needs a real Mac with VYRE_HEAVY_MAC=1; skipped by name, not passed" }, () => {
  const r = spawnSync("sh", [path.join(HERE, "install.heavy.test.sh")], { encoding: "utf8", env: process.env, timeout: 3_300_000, maxBuffer: 32 * 1024 * 1024 });
  process.stdout.write(r.stdout);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /# pass \d+ fail 0/);
});
