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

type Out = { status: number | null; stdout: string; stderr: string };
/** Runs a snippet of sh with a script's functions loaded and nothing else executed. */
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", ...env } });
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

test("install.sh and vyre-server are valid POSIX sh", () => {
  for (const f of [INSTALL, SERVER, path.join(HERE, "install.heavy.test.sh")]) {
    const r = spawnSync("sh", ["-n", f], { encoding: "utf8" });
    assert.equal(r.status, 0, `${path.basename(f)}: ${r.stderr}`);
  }
});

test("the disk check, the version order and the release key are the same text in the installer and in vyre-server", () => {
  for (const name of ["diskcheck", "semver", "release"]) assert.equal(block(INSTALL, name), block(SERVER, name), `${name} block differs`);
});

test("the installer carries a release public key and no private key", () => {
  const i = read(INSTALL);
  assert.match(i, /-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=]{44,}\n-----END PUBLIC KEY-----/);
  assert.doesNotMatch(i, /PRIVATE KEY/);
  assert.doesNotMatch(read(SERVER), /PRIVATE KEY/);
});

test("the installer is made to be piped from curl: everything is inside functions and main is the last line", () => {
  const lines = read(INSTALL).trimEnd().split("\n");
  assert.match(lines[lines.length - 1], /^if \[ "\$\{VYRE_SOURCE_ONLY:-0\}" != 1 \]; then main "\$@"; fi$/);
  const r = sh(INSTALL, "echo loaded; command -v main >/dev/null && echo has-main");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /loaded\nhas-main/);
});

test("disk_encrypted: LUKS and ecryptfs pass, a plain disk, tmpfs and overlay do not, and no answer is reported as such", () => {
  const dir = tmp();
  const run = (opts: Parameters<typeof fakeHost>[1]): number | null => {
    const h = fakeHost(dir, opts);
    return sh(INSTALL, `disk_encrypted "${dir}/data/space"`, hostEnv(h)).status;
  };
  assert.equal(run({ layers: ["crypt", "disk"] }), 0, "dm-crypt layer");
  assert.equal(run({ fs: "ecryptfs", src: "/home/.ecryptfs/u/.Private" }), 0, "ecryptfs");
  assert.equal(run({ src: "/dev/sdb1", layers: ["part", "disk"] }), 1, "plain partition");
  assert.equal(run({ fs: "tmpfs", src: "tmpfs" }), 1, "tmpfs");
  assert.equal(run({ fs: "overlay", src: "overlay" }), 1, "overlay (a container's own disk)");
  assert.equal(run({ src: "/dev/sdb1", layers: [] }), 2, "lsblk gives no answer");
  assert.equal(sh(INSTALL, `disk_encrypted "${dir}"`, { VYRE_TEST_PROC_MOUNTS: path.join(dir, "missing") }).status, 2, "no mounts file");
  fs.rmSync(dir, { recursive: true });
});

test("disk_encrypted uses the longest matching mount, not the root", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "mounts"), `/dev/mapper/root / ext4 rw 0 0\n/dev/sdb1 ${dir}/plain ext4 rw 0 0\n`);
  fs.writeFileSync(path.join(dir, "lsblk"), `#!/bin/sh\ncase "$5" in /dev/mapper/root) printf 'crypt\\ndisk\\n' ;; *) printf 'part\\ndisk\\n' ;; esac\n`, { mode: 0o755 });
  const env = { VYRE_TEST_PROC_MOUNTS: path.join(dir, "mounts"), VYRE_TEST_LSBLK: path.join(dir, "lsblk") };
  assert.equal(sh(INSTALL, `disk_encrypted "${dir}/other"`, env).status, 0, "under the encrypted root");
  assert.equal(sh(INSTALL, `disk_encrypted "${dir}/plain/space"`, env).status, 1, "under the plain mount");
  fs.rmSync(dir, { recursive: true });
});

test("check_encrypted refuses a plain disk with exit 3 and the three ways forward, and passes an encrypted one", () => {
  const dir = tmp();
  const plain = fakeHost(dir, { src: "/dev/sdb1", layers: ["part", "disk"] });
  const bad = sh(INSTALL, `check_encrypted "${dir}/data"`, hostEnv(plain));
  assert.equal(bad.status, 3);
  assert.match(bad.stderr, /not on an encrypted volume/);
  assert.match(bad.stderr, /--provider-encrypted/, "way 1: the provider's encrypted volume");
  assert.match(bad.stderr, /--encrypt-data/, "way 2: the installer makes one");
  assert.match(bad.stderr, /--allow-plain-disk/, "way 3: an explicit, recorded choice");
  assert.match(bad.stderr, /does not protect against someone who can log in/, "and what way 2 does not give");
  const unknown = sh(INSTALL, `check_encrypted "${dir}/data"`, { VYRE_TEST_PROC_MOUNTS: path.join(dir, "missing") });
  assert.equal(unknown.status, 3, "a volume it cannot verify is refused too");
  assert.match(unknown.stderr, /that this installer can verify/);
  const good = fakeHost(dir, {});
  const ok = sh(INSTALL, `check_encrypted "${dir}/data"`, hostEnv(good));
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /on an encrypted volume/);
  fs.rmSync(dir, { recursive: true });
});

test("vyre-server doctor reports the same disk rule", () => {
  const dir = tmp();
  const plain = fakeHost(dir, { src: "/dev/sdb1", layers: ["part", "disk"] });
  const r = sh(SERVER, `DATA_DIR="${dir}/data"; check_all; printf '%s\\n' "$FINDINGS"; echo "down=$DOWN"`, hostEnv(plain));
  assert.match(r.stdout, /host\.disk_encrypted\tdown\t/);
  assert.match(r.stdout, /down=1/);
  const enc = fakeHost(dir, {});
  const g = sh(SERVER, `DATA_DIR="${dir}/data"; check_all; printf '%s\\n' "$FINDINGS"`, hostEnv(enc));
  assert.match(g.stdout, /host\.disk_encrypted\thealthy\t/);
  fs.rmSync(dir, { recursive: true });
});

test("on a Mac the same rule reads diskutil: FileVault or an encrypted volume passes, a plain volume does not, and no answer is reported as such", () => {
  const dir = tmp();
  const du = path.join(dir, "diskutil");
  const run = (out: string): number | null => {
    fs.writeFileSync(du, `#!/bin/sh\ncat <<'EOT'\n${out}\nEOT\n`, { mode: 0o755 });
    return sh(INSTALL, `disk_encrypted "${dir}"`, { VYRE_TEST_OS: "Darwin", VYRE_TEST_DISKUTIL: du }).status;
  };
  assert.equal(run("   Volume Name:  Macintosh HD - Data\n   FileVault:                 Yes"), 0, "FileVault on");
  assert.equal(run("   Volume Name:  Backup\n   FileVault:                 No\n   Encrypted:                 Yes"), 0, "an external encrypted volume");
  assert.equal(run("   Volume Name:  Scratch\n   FileVault:                 No"), 1, "FileVault off");
  assert.equal(run("   Volume Name:  Scratch"), 2, "diskutil says nothing about it");
  const doctor = sh(SERVER, `DATA_DIR="${dir}"; check_all; printf '%s\\n' "$FINDINGS"`, { VYRE_TEST_OS: "Darwin", VYRE_TEST_DISKUTIL: du });
  assert.match(doctor.stdout, /host\.disk_encrypted\tdown\t/, "doctor reports the same rule on a Mac");
  fs.rmSync(dir, { recursive: true });
});

test("sha256_of gives the same digest as the file's real SHA-256", () => {
  const dir = tmp();
  const f = path.join(dir, "x");
  fs.writeFileSync(f, "vyre");
  const want = createHash("sha256").update("vyre").digest("hex");
  for (const script of [INSTALL, SERVER]) assert.equal(sh(script, `sha256_of "${f}"`).stdout.trim(), want);
  fs.rmSync(dir, { recursive: true });
});

test("ver_cmp orders versions the way semver does and rejects text that is not a version", () => {
  const cmp = (a: string, b: string): string => sh(INSTALL, `ver_cmp "${a}" "${b}"`).stdout.trim();
  assert.equal(cmp("1.2.3", "1.2.3"), "0");
  assert.equal(cmp("1.2.4", "1.2.3"), "1");
  assert.equal(cmp("1.10.0", "1.9.9"), "1");
  assert.equal(cmp("1.0.0-beta.2", "1.0.0"), "-1");
  assert.equal(cmp("1.0.0-beta.10", "1.0.0-beta.9"), "1");
  assert.equal(cmp("1.0.0-alpha", "1.0.0-beta"), "-1");
  assert.equal(sh(INSTALL, `ver_cmp "latest" "1.0.0"`).status, 2);
  assert.equal(sh(INSTALL, `ver_cmp "1.0" "1.0.0"`).status, 2);
});

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
  test(`${label}: verify_manifest accepts the release key's signature and rejects a changed manifest, another key and a short signature`, () => {
    const dir = tmp();
    const body = '{"v":1,"channel":"stable","server":{"version":"1.0.0","sha256":"' + "a".repeat(64) + '"}}\n';
    const s = signed(dir, body);
    const verify = (m: string, sig: string, pub: string): number | null =>
      sh(script, `TMP="${dir}"; verify_manifest "${m}" "${sig}"`, { VYRE_RELEASE_KEY_PEM: pub }).status;
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

test("VYRE_RELEASE_KEY_PEM is honoured only in test mode: a real run always checks against the key in the script", () => {
  const dir = tmp();
  const body = '{"v":1}\n';
  const s = signed(dir, body);
  const r = spawnSync("sh", ["-c", `. "${INSTALL}"\nTMP="${dir}"; verify_manifest "${s.manifest}" "${s.sig}"`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1", VYRE_RELEASE_KEY_PEM: s.pub } });
  assert.notEqual(r.status, 0, "a key from the environment does not count outside test mode");
  fs.rmSync(dir, { recursive: true });
});

test("unpack_release refuses a path that leaves its folder, a link, and a release that lacks a file", () => {
  const dir = tmp();
  const mk = (name: string, build: (d: string) => void): string => {
    const d = path.join(dir, name);
    fs.mkdirSync(path.join(d, "rel/bin"), { recursive: true });
    fs.mkdirSync(path.join(d, "rel/units"), { recursive: true });
    for (const f of ["VERSION", "compose.server.yml", "Caddyfile", "images.lock", "bin/vyre-server", "units/vyre-server.service", "units/vyre-server-update.service", "units/vyre-server-update.timer"]) fs.writeFileSync(path.join(d, "rel", f), f === "VERSION" ? "1.0.0" : "x");
    build(d);
    const tgz = path.join(d, "r.tgz");
    assert.equal(spawnSync("tar", ["-czf", tgz, "-C", d, "rel"]).status, 0);
    return tgz;
  };
  const unpack = (tgz: string, work: string): Out =>
    sh(INSTALL, `DIR="${work}"; REL_VERSION=1.0.0; REL_TARBALL="${tgz}"; DRY=0; unpack_release`, {});
  const good = mk("good", () => {});
  const w1 = path.join(dir, "w1");
  const g = unpack(good, w1);
  assert.equal(g.status, 0, g.stderr);
  assert.ok(fs.existsSync(path.join(w1, "releases/1.0.0/.complete")));
  assert.equal(fs.statSync(path.join(w1, "releases/1.0.0/bin/vyre-server")).mode & 0o111, 0o111, "the command is executable");
  const link = mk("link", (d) => fs.symlinkSync("/etc/passwd", path.join(d, "rel/evil")));
  const l = unpack(link, path.join(dir, "w2"));
  assert.notEqual(l.status, 0);
  assert.match(l.stderr, /holds a link/);
  assert.ok(!fs.existsSync(path.join(dir, "w2/releases/1.0.0")), "nothing was left behind");
  const missing = mk("missing", (d) => fs.rmSync(path.join(d, "rel/Caddyfile")));
  const m = unpack(missing, path.join(dir, "w3"));
  assert.notEqual(m.status, 0);
  assert.match(m.stderr, /has no Caddyfile/);
  const wrong = mk("wrong", (d) => fs.writeFileSync(path.join(d, "rel/VERSION"), "2.0.0"));
  const v = unpack(wrong, path.join(dir, "w4"));
  assert.notEqual(v.status, 0);
  assert.match(v.stderr, /VERSION file does not match/);
  fs.rmSync(dir, { recursive: true });
});

test("write_config keeps the setup code out of arguments and output, at mode 0600, and a re-run keeps what the person set", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  const rel = path.join(dirVyre, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\nVYRE_AGENT_IMAGE=ghcr.io/vyre-ai/agent-computer@sha256:" + "e".repeat(64) + "\n");
  const body = `DIR="${dirVyre}"; DATA_DIR="${dirVyre}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="vyre.example.com"; RELAY=""; DRY=0; UPDATE_URL=https://vyre.run/server/; write_config`;
  const first = sh(INSTALL, body, { VYRE_CODE: "code-77", VYRE_DIR: dirVyre });
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout + first.stderr, /code-77/);
  const envFile = path.join(dirVyre, "vyre.env");
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  assert.equal(read(envFile), "VYRE_SETUP_CODE=code-77\n");
  const compose = read(path.join(dirVyre, "compose.env"));
  assert.match(compose, /^VYRE_IMAGE=ghcr\.io\/vyre-ai\/vyred@sha256:b{64}$/m);
  assert.match(compose, /^VYRE_ADDRESS=vyre\.example\.com$/m);
  assert.match(compose, /^VYRE_AGENT_COMPUTER_IMAGE=ghcr\.io\/vyre-ai\/agent-computer@sha256:e{64}$/m, "vyred is told the release's agent computer image, by digest");
  assert.match(read(path.join(dirVyre, "compose.override.yml")), /device: .*\/data\/space/);
  assert.equal(fs.statSync(path.join(dirVyre, "data")).mode & 0o777, 0o700);
  fs.appendFileSync(envFile, "MINE=1\n");
  const again = sh(INSTALL, body.replace('DOMAIN="vyre.example.com"', 'DOMAIN=""'), { VYRE_CODE: "other-code", VYRE_DIR: dirVyre });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(read(envFile), "VYRE_SETUP_CODE=code-77\nMINE=1\n", "vyre.env is never overwritten");
  assert.match(read(path.join(dirVyre, "compose.env")), /^VYRE_ADDRESS=vyre\.example\.com$/m, "the address chosen first is kept");
  fs.rmSync(dir, { recursive: true });
});

test("parse_args: two ways to reach the server are refused, a bad channel and a bad domain are refused, --relay takes an optional URL", () => {
  const args = (a: string): Out => sh(INSTALL, `parse_args ${a}; echo "relay=$RELAY domain=$DOMAIN channel=$CHANNEL data=$DATA_DIR"`, { VYRE_DIR: "/srv/vyre" });
  assert.notEqual(args("--domain a.example.com --relay").status, 0);
  assert.match(args("--domain a.example.com --relay").stderr, /choose one/);
  assert.match(args("--channel weekly").stderr, /stable, beta or nightly/);
  assert.match(args("--domain 'bad host!'").stderr, /host name/);
  assert.match(args("--relay").stdout, /relay=https:\/\/relay\.vyre\.run /);
  assert.match(args("--relay https://r.example.com --yes").stdout, /relay=https:\/\/r\.example\.com /);
  assert.match(args("--data-dir /mnt/enc/vyre").stdout, /data=\/mnt\/enc\/vyre$/m);
  assert.match(args("--bogus").stderr, /unknown option/);
});

test("the systemd units: marked, filled from placeholders only, update runs the signed updater once a day with a persistent timer", () => {
  const u = (n: string): string => read(path.join(HERE, "units", n));
  const svc = u("vyre-server.service"), upd = u("vyre-server-update.service"), tim = u("vyre-server-update.timer");
  for (const t of [svc, upd, tim]) {
    assert.match(t, /^# @MARK@$/m);
    const left = (t.match(/@[A-Z_]+@/g) ?? []).filter((x) => !["@MARK@", "@VYRE_DIR@", "@BIN@"].includes(x));
    assert.deepEqual(left, [], "only the three known placeholders");
  }
  assert.match(svc, /After=docker\.service/);
  assert.match(svc, /Requires=docker\.service/);
  assert.match(svc, /RequiresMountsFor=@VYRE_DIR@/);
  assert.match(svc, /ExecStart=@BIN@ start/);
  assert.match(svc, /ExecStop=@BIN@ stop/);
  assert.match(svc, /RemainAfterExit=yes/);
  assert.match(upd, /ExecStart=@BIN@ update --yes/);
  assert.match(upd, /Type=oneshot/);
  assert.match(tim, /OnCalendar=\*-\*-\* 04:00:00/);
  assert.match(tim, /RandomizedDelaySec=/);
  assert.match(tim, /Persistent=true/);
  assert.match(tim, /WantedBy=timers\.target/);
});

test("write_units fills the units and installs them with the mark", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  const rel = path.join(dirVyre, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.cpSync(path.join(HERE, "units"), path.join(rel, "units"), { recursive: true });
  const units = path.join(dir, "systemd");
  const shim = path.join(dir, "shim");
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, "systemctl"), `#!/bin/sh\necho "$*" >> "${dir}/systemctl.log"\n`, { mode: 0o755 });
  const r = sh(INSTALL, `DIR="${dirVyre}"; REL_VERSION=1.0.0; DRY=0; write_units`, { VYRE_SYSTEMD_DIR: units, VYRE_BIN_DIR: path.join(dir, "bin"), VYRE_DIR: dirVyre, PATH: `${shim}:${process.env.PATH}` });
  assert.equal(r.status, 0, r.stderr);
  for (const n of ["vyre-server.service", "vyre-server-update.service", "vyre-server-update.timer"]) {
    const t = read(path.join(units, n));
    assert.doesNotMatch(t, /@[A-Z_]+@/);
    assert.match(t, /^# Vyre Server, installed by install\.sh$/m);
  }
  assert.match(read(path.join(units, "vyre-server.service")), new RegExp(`RequiresMountsFor=${dirVyre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  const log = read(path.join(dir, "systemctl.log"));
  assert.match(log, /daemon-reload/);
  assert.match(log, /enable vyre-server\.service/);
  assert.match(log, /enable --now vyre-server-update\.timer/);
  fs.rmSync(dir, { recursive: true });
});

test("pull_images pulls the server, the agent computer and the sandbox image by digest and refuses a tag", () => {
  const dir = tmp();
  const rel = path.join(dir, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  const d = (n: string): string => `ghcr.io/vyre-ai/${n}@sha256:${n.length.toString(16).repeat(64).slice(0, 64)}`;
  fs.writeFileSync(path.join(rel, "images.lock"), `VYRE_IMAGE=${d("vyred")}\nVYRE_AGENT_IMAGE=${d("agent")}\nVYRE_SANDBOX_IMAGE=${d("sandbox")}\n`);
  const shim = path.join(dir, "shim");
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, "docker"), `#!/bin/sh\necho "$*" >> "${dir}/docker.log"\n`, { mode: 0o755 });
  const env = { PATH: `${shim}:${process.env.PATH}` };
  const ok = sh(INSTALL, `DIR="${dir}"; REL_VERSION=1.0.0; DRY=0; pull_images`, env);
  assert.equal(ok.status, 0, ok.stderr);
  const log = read(path.join(dir, "docker.log")).trim().split("\n");
  assert.equal(log.length, 3);
  assert.ok(log.every((l) => l.startsWith("pull -q ghcr.io/vyre-ai/")));
  assert.ok(log.some((l) => l.includes("/agent@sha256:")), "the agent computer image is pulled");
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred:latest\n");
  const bad = sh(INSTALL, `DIR="${dir}"; REL_VERSION=1.0.0; DRY=0; pull_images`, env);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /without a digest/);
  fs.writeFileSync(path.join(rel, "images.lock"), `VYRE_IMAGE=${d("vyred")}\n`);
  fs.rmSync(path.join(dir, "docker.log"));
  const dry = sh(INSTALL, `DIR="${dir}"; REL_VERSION=1.0.0; DRY=1; pull_images`, env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would run: docker pull ghcr\.io\/vyre-ai\/vyred@sha256:/);
  assert.ok(!fs.existsSync(path.join(dir, "docker.log")), "--dry-run pulls nothing");
  fs.rmSync(dir, { recursive: true });
});

test("--dry-run on the whole installer stops at the first check: a plain disk exits 3 before anything is written", () => {
  const dir = tmp();
  const plain = fakeHost(dir, { src: "/dev/sdb1", layers: ["part", "disk"] });
  const target = path.join(dir, "srv");
  const r = spawnSync("sh", [INSTALL, "--yes", "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Linux", VYRE_TEST_NONROOT: "1", VYRE_DIR: target, ...hostEnv(plain) } });
  // Tools it needs (curl, jq, openssl 3) are checked first; on a machine without them the exit is 1, with them it is 3. Never 0, never a write.
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(target));
  if (r.status === 3) assert.match(r.stderr, /not on an encrypted volume/);
  fs.rmSync(dir, { recursive: true });
});

test("root is required, and a unit file or command that is not ours is never removed", () => {
  const r = spawnSync("sh", ["-c", `. "${INSTALL}"\nis_root`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1" } });
  assert.equal(r.status, process.getuid?.() === 0 ? 0 : 1);
  const mark = read(INSTALL).match(/^MARK="(.*)"$/m)?.[1];
  assert.ok(mark, "a mark is defined");
  const u = read(INSTALL);
  assert.match(u, /grep -q "\$MARK" "\$UNIT_DIR\/\$u"/);
  assert.match(u, /grep -q "\$MARK" "\$BIN_DIR\/vyre-server"/);
});

test("@heavy install on a fresh host with Docker ends with doctor green (install.heavy.test.sh)", { skip: process.env.VYRE_HEAVY_DOCKER === "1" ? false : "set VYRE_HEAVY_DOCKER=1 on a runner with Docker; this check is skipped by name, not passed" }, () => {
  const r = spawnSync("sh", [path.join(HERE, "install.heavy.test.sh")], { encoding: "utf8", env: process.env, timeout: 1_300_000, maxBuffer: 32 * 1024 * 1024 });
  process.stdout.write(r.stdout);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /# pass \d+ fail 0/);
  assert.doesNotMatch(r.stdout, /^not ok/m);
});

test('update parser pins selected channel, version and hash before any state change',()=>{
 const dir=tmp();try{
  const out=sh(SERVER,'parse_update_args --channel beta --version 1.1.0 --sha256 '+ 'a'.repeat(64) +' --feed-base https://updates.fixture.example/; printf "%s|%s|%s|%s" "$CHANNEL" "$WANT" "$WANT_SHA256" "$UPDATE_URL"',{VYRE_DIR:dir});
  assert.equal(out.status,0,out.stderr);assert.equal(out.stdout,'beta|1.1.0|'+ 'a'.repeat(64)+'|https://updates.fixture.example/');assert.deepEqual(fs.readdirSync(dir),[]);
  for(const args of ['--channel invalid','--version nope','--sha256 short',"--version ''","--sha256 ''",'--version','--feed-base file:///tmp/fixture']){const invalid=sh(SERVER,`parse_update_args ${args}`,{VYRE_DIR:dir});assert.notEqual(invalid.status,0,args);assert.deepEqual(fs.readdirSync(dir),[]);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('changed reviewed artifact digest is refused before tarball download or unpack',()=>{
 const dir=tmp();try{
  fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify({v:1,channel:'stable',server:{version:'1.1.0',tarball:'fixture.tgz',sha256:'a'.repeat(64)}}));
  const out=sh(SERVER,`TMP="$VYRE_FIXTURE_DIR"; WANT=1.1.0; WANT_SHA256=${'b'.repeat(64)}; UPDATE_URL=https://updates.fixture.example; verify_manifest(){ return 0; }; fetch(){ case "$1" in *.json) cp "$VYRE_FIXTURE_DIR/fixture.json" "$2" ;; *.sig) printf fixture >"$2" ;; *) touch "$VYRE_FIXTURE_DIR/artifact-requested"; return 1 ;; esac; }; fetch_release`,{VYRE_DIR:dir,VYRE_FIXTURE_DIR:dir});
  assert.notEqual(out.status,0);assert.match(out.stderr,/reviewed artifact/i);assert.equal(fs.existsSync(path.join(dir,'artifact-requested')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('update dry-run never unpacks, pulls images or takes a backup even when a target release already exists',()=>{
 const dir=tmp();try{
  const out=sh(SERVER,'cur_version(){ printf 1.0.0; }; fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ touch "$VYRE_FIXTURE_DIR/unpack-called"; }; cmd_update --dry-run --version 1.1.0',{VYRE_DIR:dir,VYRE_FIXTURE_DIR:dir,TMPDIR:dir});
  assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/Would install|would install/);assert.equal(fs.existsSync(path.join(dir,'unpack-called')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('only a healthy update persists the selected daily channel and feed',()=>{
 for(const healthy of [true,false]){
  const dir=tmp();try{
   for(const version of ['1.0.0','1.1.0']){fs.mkdirSync(path.join(dir,'releases',version),{recursive:true});fs.writeFileSync(path.join(dir,'releases',version,'images.lock'),'VYRE_IMAGE=fixture@sha256:'+ 'a'.repeat(64)+'\n');}
   fs.symlinkSync('releases/1.0.0',path.join(dir,'current'));fs.writeFileSync(path.join(dir,'compose.env'),'VYRE_IMAGE=fixture@sha256:'+ 'a'.repeat(64)+'\n');fs.writeFileSync(path.join(dir,'vyre.env'),'');fs.writeFileSync(path.join(dir,'channel'),'stable\n');fs.writeFileSync(path.join(dir,'update-url'),'https://old.fixture.example/\n');
   const body='cur_version(){ printf 1.0.0; }; fetch_release(){ REL_VERSION=1.1.0; }; unpack_release(){ :; }; docker(){ return 0; }; backup_data(){ BACKUP_FILE=fixture; }; set_current(){ :; }; dc(){ return '+(healthy?'0':'1')+'; }; wait_healthy(){ return 0; }; prune_releases(){ :; }; cmd_update --yes --channel beta --version 1.1.0 --sha256 '+ 'a'.repeat(64)+' --feed-base https://updates.fixture.example/';
   const out=sh(SERVER,body,{VYRE_DIR:dir,TMPDIR:dir});assert.equal(out.status,healthy?0:4,out.stderr);
   assert.equal(fs.readFileSync(path.join(dir,'channel'),'utf8'),healthy?'beta\n':'stable\n');assert.equal(fs.readFileSync(path.join(dir,'update-url'),'utf8'),healthy?'https://updates.fixture.example/\n':'https://old.fixture.example/\n');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('a contending update cannot remove the active updater lock during exit cleanup',()=>{
 const dir=tmp();try{const lock=path.join(dir,'state','update.lock');fs.mkdirSync(lock,{recursive:true});
  const out=sh(SERVER,'trap cleanup EXIT; cmd_update --check',{VYRE_DIR:dir,TMPDIR:dir});
  assert.equal(fs.existsSync(lock),true,'a contender must not clean a lock it did not acquire');assert.equal(out.status,75,out.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('manual rollback respects the same active operation lock before changing state',()=>{
 const dir=tmp();try{const lock=path.join(dir,'state','update.lock');fs.mkdirSync(lock,{recursive:true});
  const out=sh(SERVER,'trap cleanup EXIT; cmd_rollback',{VYRE_DIR:dir,TMPDIR:dir});assert.equal(out.status,75,out.stderr);assert.equal(fs.existsSync(lock),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("the default release feed is the GitHub feed of the chosen channel (no dependency on vyre.run), and VYRE_UPDATE_URL wins", () => {
  const feed = (a: string, env: Record<string, string> = {}): string => sh(INSTALL, `parse_args ${a}; echo "$UPDATE_URL"`, { VYRE_DIR: "/srv/vyre", ...env }).stdout.trim();
  assert.equal(feed("--yes"), "https://github.com/vyre-ai/vyre-v1/releases/latest/download/");
  assert.equal(feed("--channel beta"), "https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/");
  assert.equal(feed("--channel nightly"), "https://github.com/vyre-ai/vyre-v1/releases/download/channel-nightly/");
  assert.equal(feed("--channel beta", { VYRE_UPDATE_URL: "https://updates.example/server/" }), "https://updates.example/server/");
  assert.doesNotMatch(read(INSTALL), /vyre\.run\/server/);
  assert.doesNotMatch(read(SERVER), /vyre\.run\/server/);
  assert.match(read(SERVER), /printf 'https:\/\/github\.com\/vyre-ai\/vyre-v1\/releases\/latest\/download\/'/, "an install with no update-url file reads the stable feed");
});

// ---- the compute role: --role compute --server ADDRESS with VYRE_JOIN in the environment

test("the compute-role block is the same text in both installers", () => {
  const mac = fs.readFileSync(path.join(HERE, "../macos/install.sh"), "utf8");
  const mine = block(INSTALL, "node");
  assert.ok(mac.includes(mine), "the macOS installer carries the same node block");
});

test("parse_args for the compute role: it needs a Space address and a well-formed code, refuses the server flags, and keeps its own folder", () => {
  const args = (a: string, env: Record<string, string> = {}): Out => sh(INSTALL, `parse_args ${a}; echo "role=$ROLE server=$SERVER_ARG dir=$DIR data=$DATA_DIR join=$JOIN_ARG"`, env);
  const ok = args("--role compute --server https://home.example.com", { VYRE_JOIN: "VYRE-AB23-CD45" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /role=compute server=https:\/\/home\.example\.com dir=\/srv\/vyre-node data=\/srv\/vyre-node\/data join=VYRE-AB23-CD45/);
  assert.match(args("--role compute --server https://x.example --data-dir /mnt/a", { VYRE_DIR: "/opt/node" }).stdout, /dir=\/opt\/node data=\/mnt\/a/);
  assert.match(args("--role compute").stderr, /needs --server/);
  assert.match(args("--role compute --server home.example.com").stderr, /needs --server/);
  assert.match(args("--role compute --server 'https://x.example;rm'").stderr, /not part of an address/);
  assert.match(args("--role compute --server https://x.example", { VYRE_JOIN: "nope" }).stderr, /looks like VYRE-ABCD-2345/);
  assert.match(args("--role compute --server https://x.example --domain a.example.com").stderr, /not for --role compute/);
  assert.match(args("--server https://x.example").stderr, /--server is for --role compute/);
  assert.match(args("--role both").stderr, /space or compute/);
  assert.match(args("").stdout, /role=space server= dir=\/srv\/vyre /, "the server install is unchanged");
});

test("a first compute install needs the one-time code; a machine that already joined does not", () => {
  const dir = tmp();
  const need = (join: string): Out => sh(INSTALL, `DIR="${dir}"; JOIN_ARG="${join}"; node_need_code`);
  assert.match(need("").stderr, /one-time join code/);
  assert.equal(need("VYRE-AB23-CD45").status, 0);
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data/compute-state.json"), "{}");
  assert.equal(need("").status, 0, "already joined");
  fs.rmSync(dir, { recursive: true });
});

test("node_write_config keeps the code out of output and arguments, at mode 0600, and the compose file runs the compute role with the Docker socket", () => {
  const dir = tmp();
  const rel = path.join(dir, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), `VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:${"b".repeat(64)}\nVYRE_AGENT_IMAGE=ghcr.io/vyre-ai/agent@sha256:${"c".repeat(64)}\n`);
  const body = `DIR="${dir}"; REL_VERSION=1.0.0; CHANNEL=stable; DRY=0; SERVER_ARG=https://home.example.com; JOIN_ARG=VYRE-AB23-CD45; node_write_config`;
  const r = sh(INSTALL, body);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /VYRE-AB23-CD45/);
  const envFile = path.join(dir, "node.env");
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  assert.equal(read(envFile), "VYRE_ROLE=compute\nVYRE_SERVER=https://home.example.com\nVYRE_JOIN=VYRE-AB23-CD45\n");
  assert.equal(fs.statSync(path.join(dir, "data")).mode & 0o777, 0o700);
  const compose = read(path.join(dir, "compose.env"));
  assert.match(compose, /^VYRE_IMAGE=ghcr\.io\/vyre-ai\/vyred@sha256:b{64}$/m);
  assert.match(compose, /^VYRE_AGENT_IMAGE=ghcr\.io\/vyre-ai\/agent@sha256:c{64}$/m);
  const yml = read(path.join(dir, "compose.node.yml"));
  assert.match(yml, /"--role", "compute"/);
  assert.match(yml, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(yml, /image: \$\{VYRE_IMAGE\}/);
  assert.match(yml, /cap_drop: \[ALL\]/);
  assert.match(yml, /seccomp=unconfined/);
  assert.match(yml, /systempaths=unconfined/);
  assert.doesNotMatch(yml, /VYRE-AB23/, "the code is in node.env only");
  const dry = sh(INSTALL, body.replace("DRY=0", "DRY=1").replace(dir, path.join(dir, "elsewhere")));
  assert.match(dry.stdout, /would write .*node\.env/);
  assert.equal(fs.existsSync(path.join(dir, "elsewhere")), false, "a dry run writes nothing");
  fs.rmSync(dir, { recursive: true });
});

test("node_wait_fingerprint shows the fingerprint the machine printed, then forgets the one-time code; with no sign of joining it says what to read", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "node.env"), "VYRE_ROLE=compute\nVYRE_SERVER=https://x.example\nVYRE_JOIN=VYRE-AB23-CD45\n", { mode: 0o600 });
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin/docker"), `#!/bin/sh\nprintf 'vyred: Asked to join as "x". Fingerprint K7QD-4M2X. Waiting for a person to approve it.\\n'\n`, { mode: 0o755 });
  const env = { PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}` };
  const ok = sh(INSTALL, `DIR="${dir}"; DRY=0; node_wait_fingerprint; node_finish; echo "fp=$NODE_FP"`, env);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Fingerprint K7QD-4M2X\. Compare it with the one in Vyre, then approve\./);
  assert.match(ok.stdout, /fp=K7QD-4M2X/);
  assert.equal(read(path.join(dir, "node.env")), "VYRE_ROLE=compute\nVYRE_SERVER=https://x.example\n", "the code is gone once the machine has asked");
  assert.equal(fs.statSync(path.join(dir, "node.env")).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(dir, "bin/docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const none = sh(INSTALL, `DIR="${dir}"; DRY=0; node_wait_fingerprint`, { ...env, VYRE_UP_WAIT: "1" });
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /did not ask to join/);
  fs.rmSync(dir, { recursive: true });
});

test("the owner's claim link: vyre-server claim-link prints it from the data directory, and the installer's last words say to run it without printing the link", () => {
  const dir = tmp();
  const link = "https://mla.example.com/claim/abcdefghijklmnop#s=spc_fixture";
  const none = sh(SERVER, `DATA_DIR="${dir}"; main claim-link`);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /no claim link: the Space is claimed already, or the server has not started yet/);
  const quiet = sh(INSTALL, `DATA_DIR="${dir}"; DRY=0; REL_VERSION=1.0.0; DOMAIN=mla.example.com; RELAY=""; finish`);
  assert.doesNotMatch(quiet.stdout, /claim/, "no claim hint once the Space is claimed (the file is gone)");
  fs.mkdirSync(path.join(dir, "space/logs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "space/logs/claim-link.txt"), `${link}\n`, { mode: 0o600 });
  const got = sh(SERVER, `DATA_DIR="${dir}"; main claim-link`);
  assert.equal(got.status, 0);
  assert.equal(got.stdout, `${link}\n`);
  const done = sh(INSTALL, `DATA_DIR="${dir}"; DRY=0; REL_VERSION=1.0.0; DOMAIN=mla.example.com; RELAY=""; finish`);
  assert.match(done.stdout, /To claim this Space as its owner, run: sudo vyre-server claim-link/);
  assert.ok(!done.stdout.includes("/claim/"), "the installer's output never holds the link");
  assert.match(read(SERVER).split("\n").slice(1, 14).join("\n"), /vyre-server claim-link/, "the help text (lines 2-14) lists it");
  fs.rmSync(dir, { recursive: true });
});

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

test("a plain backup takes the Space with the server up and the daemon writing, and restores with databases that pass integrity_check", async () => {
  const dir = tmp();
  const space = path.join(dir, "data", "space");
  fs.mkdirSync(space, { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "caddy"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "caddy", "cert.pem"), "cert");
  const { spawn } = await import("node:child_process");
  const writer = spawn("node", ["--no-warnings", "-e", WRITER, space], { stdio: "inherit" });
  try {
    for (let n = 0; n < 100 && !fs.existsSync(path.join(space, "ready")); n++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(path.join(space, "ready")), "the writer started");
    // A plain backup keeps the server running: dc is never called, and the writer goes on through the whole backup (the worst case).
    for (let round = 0; round < 3; round++) {
      const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; cmd_backup; echo "$BACKUP_FILE"`, { VYRE_DIR: dir });
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
    assert.equal(fs.readdirSync(path.join(dir, "backups")).filter((f) => f.startsWith(".stage")).length, 0, "the staging folder is gone");
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
    spawnSync("node", ["--no-warnings", "-e", `const {DatabaseSync}=require("node:sqlite");new DatabaseSync(process.argv[1]).exec("CREATE TABLE t(x)")`, d]);
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; sqlite_snapshot(){ return 1; }; sleep(){ :; }; backup_data x`, { VYRE_DIR: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /nothing was changed/);
    const log = read(path.join(dir, "dc.log"));
    assert.match(log, /^stop/m);
    assert.match(log, /^up -d/m, "the server was started again");
    assert.deepEqual(fs.readdirSync(path.join(dir, "backups")), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

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
    assert.match(env, /^VYRE_AGENT_COMPUTER_IMAGE=ghcr\.io\/vyre-ai\/agent-computer@sha256:1{64}$/m, "the agent computer image follows the release, by digest");
    assert.equal(env.match(/^VYRE_AGENT_COMPUTER_IMAGE=/gm)?.length, 1, "one line, never two");
    assert.match(env, /^VYRE_PORT=8420$/m);
    assert.match(env, /^DOCKER_GID=1$/m);
    assert.equal(fs.existsSync(path.join(dir, "compose.env.new")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an update that was cut off is rolled back by the next command that takes the lock", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    fs.mkdirSync(path.join(dir, "state"));
    fs.writeFileSync(path.join(dir, "state", "update.pending"), "releases/1.0.0\n");
    const r = sh(SERVER, `dc(){ echo "$*" >>"${dir}/dc.log"; }; lock_update_operation; readlink "$DIR/current"; sed -n 's/^VYRE_IMAGE=//p' "$DIR/compose.env"`, { VYRE_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /cut off/);
    assert.match(r.stdout, /releases\/1\.0\.0/);
    assert.match(r.stdout, /old@sha256/);
    assert.equal(fs.existsSync(path.join(dir, "state", "update.pending")), false);
    assert.match(read(path.join(dir, "dc.log")), /^up -d/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
    const child = spawn("sh", ["-c", script], { env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_DIR: dir, TMPDIR: dir }, stdio: "ignore" });
    for (let n = 0; n < 100 && !fs.existsSync(path.join(dir, "waiting")); n++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(path.join(dir, "waiting")));
    assert.ok(fs.existsSync(path.join(dir, "state", "update.pending")), "the marker is there while the update runs");
    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));
    assert.equal(fs.readlinkSync(path.join(dir, "current")), "releases/1.0.0");
    assert.equal(fs.existsSync(path.join(dir, "state", "update.pending")), false);
    assert.match(read(path.join(dir, "compose.env")), /^VYRE_IMAGE=old@/m);
    assert.equal(fs.existsSync(path.join(dir, "state", "update.lock")), false, "the lock is released");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a lock left by a process that is gone is reclaimed; a lock with a live owner is not", () => {
  const dir = tmp();
  try {
    const lock = path.join(dir, "state", "update.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "pid"), "999999\n");
    const dead = sh(SERVER, 'lock_update_operation; echo got', { VYRE_DIR: dir });
    assert.equal(dead.status, 0, dead.stderr);
    assert.match(dead.stdout, /got/);
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "pid"), `${process.pid}\n`);
    const live = sh(SERVER, 'lock_update_operation', { VYRE_DIR: dir });
    assert.equal(live.status, 75);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an update backup also stops a container outside compose that still mounts the data folder, names it, and starts it again", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "data", "space"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "space", "events.db-x"), "x");
    const fake = `docker(){ echo "docker $*" >>"${dir}/docker.log"; case "$1 $2" in "volume ls") echo vyre-server_vyre-data ;; "volume inspect") printf '%s' "${dir}/data/space" ;; "ps -q") echo abc123 ;; "inspect -f") echo /vyre-site-9-app ;; esac; return 0; }`;
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "dc $*" >>"${dir}/docker.log"; }; ${fake}; backup_data pre; resume_strays`, { VYRE_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Stopping vyre-site-9-app too/);
    const log = read(path.join(dir, "docker.log"));
    assert.match(log, /^dc stop/m);
    assert.match(log, /^docker stop abc123/m);
    assert.match(log, /^docker start abc123/m);
    assert.ok(log.indexOf("docker stop abc123") < log.indexOf("docker start abc123"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

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
const treeSig = (d: string): string => spawnSync("sh", ["-c", `cd "${d}" && find . -type f | sort | xargs cat | shasum`], { encoding: "utf8" }).stdout;

test("restore puts a backup back after backing up the current data, and starts and checks the server", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "OLD");
    const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, { VYRE_DIR: dir });
    assert.equal(mk.status, 0, mk.stderr);
    const file = mk.stdout.trim().split("\n").pop()!;
    fs.rmSync(path.join(dir, "data"), { recursive: true });
    mkSpace(dir, "NEW");
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "NEW");
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ echo healthy >>"${dir}/dc.log"; }; trap cleanup EXIT; cmd_restore "${file}" --yes`, { VYRE_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "OLD");
    assert.equal(valueIn(path.join(dir, "data", "space", "modules.db")), "OLD");
    assert.equal(read(path.join(dir, "data", "caddy", "cert.pem")), "OLD");
    const pre = fs.readdirSync(path.join(dir, "backups")).filter((f) => f.startsWith("vyre-pre-restore"));
    assert.equal(pre.length, 1, "the current data was backed up first");
    const log = read(path.join(dir, "dc.log"));
    assert.ok(log.indexOf("stop") < log.indexOf("up -d") && log.indexOf("up -d") < log.indexOf("healthy"));
    // the backup it made holds what was replaced
    const chk = path.join(dir, "chk"); fs.mkdirSync(chk);
    assert.equal(spawnSync("tar", ["-xzf", path.join(dir, "backups", pre[0]!), "-C", chk]).status, 0);
    assert.equal(valueIn(path.join(chk, "space", "events.db")), "NEW");
    assert.deepEqual(fs.readdirSync(path.join(dir, "data")).sort(), ["caddy", "space"], "no leftovers");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("restore refuses a bad file, an unconfirmed run and a backup of the wrong shape, and changes nothing", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "LIVE");
    const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, { VYRE_DIR: dir });
    const good = mk.stdout.trim().split("\n").pop()!;
    const bytes = fs.readFileSync(good);
    const bad: Record<string, string> = {};
    bad.truncated = path.join(dir, "truncated.tar.gz"); fs.writeFileSync(bad.truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));
    bad.text = path.join(dir, "text.tar.gz"); fs.writeFileSync(bad.text, "not an archive");
    // a tar with a path outside space/ and caddy/
    const odd = path.join(dir, "odd"); fs.mkdirSync(path.join(odd, "etc"), { recursive: true }); fs.writeFileSync(path.join(odd, "etc", "passwd"), "x");
    bad.shape = path.join(dir, "shape.tar.gz"); spawnSync("tar", ["-czf", bad.shape, "-C", odd, "etc"]);
    // a good-looking backup whose database is damaged
    const dmg = path.join(dir, "dmg"); fs.mkdirSync(dmg); spawnSync("tar", ["-xzf", good, "-C", dmg]);
    const db = path.join(dmg, "space", "events.db"); const buf = fs.readFileSync(db); for (let i = 100; i < buf.length; i++) buf[i] = 0xff; fs.writeFileSync(db, buf);
    bad.corrupt = path.join(dir, "corrupt.tar.gz"); spawnSync("tar", ["-czf", bad.corrupt, "-C", dmg, "space", "caddy"]);
    const before = treeSig(path.join(dir, "data"));
    const backupsBefore = fs.readdirSync(path.join(dir, "backups")).sort();
    for (const [name, file] of Object.entries({ ...bad, missing: path.join(dir, "nope.tar.gz") })) {
      const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ :; }; trap cleanup EXIT; cmd_restore "${file}" --yes`, { VYRE_DIR: dir });
      assert.notEqual(r.status, 0, name);
      assert.match(r.stderr, /nothing was changed|no such backup/, name);
      assert.equal(treeSig(path.join(dir, "data")), before, `${name}: data unchanged`);
      assert.deepEqual(fs.readdirSync(path.join(dir, "data")).sort(), ["caddy", "space"], `${name}: no staging left`);
    }
    assert.equal(fs.existsSync(path.join(dir, "dc.log")), false, "the server was never touched");
    assert.deepEqual(fs.readdirSync(path.join(dir, "backups")).sort(), backupsBefore, "no backup was made either");
    // no --yes and no terminal
    const unconfirmed = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; trap cleanup EXIT; cmd_restore "${good}" </dev/null`, { VYRE_DIR: dir });
    assert.notEqual(unconfirmed.status, 0);
    assert.match(unconfirmed.stderr, /--yes|terminal/);
    assert.equal(treeSig(path.join(dir, "data")), before);
    assert.equal(fs.existsSync(path.join(dir, "dc.log")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("restore puts the old data back when the server is not healthy on the restored data", () => {
  const dir = tmp();
  try {
    mkSpace(dir, "OLD");
    const mk = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ :; }; backup_data good live; echo "$BACKUP_FILE"`, { VYRE_DIR: dir });
    const file = mk.stdout.trim().split("\n").pop()!;
    fs.rmSync(path.join(dir, "data"), { recursive: true });
    mkSpace(dir, "KEEP");
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; dc(){ echo "$*" >>"${dir}/dc.log"; }; wait_healthy(){ return 1; }; trap cleanup EXIT; cmd_restore "${file}" --yes`, { VYRE_DIR: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /health check.*the data that was there before is back/);
    assert.equal(valueIn(path.join(dir, "data", "space", "events.db")), "KEEP");
    assert.equal(read(path.join(dir, "data", "caddy", "cert.pem")), "KEEP");
    assert.deepEqual(fs.readdirSync(path.join(dir, "data")).sort(), ["caddy", "space"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

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
    assert.deepEqual(read(path.join(dir, "order")).trim().split("\n"), ["backup pre-1.1.0 live", "dc stop", "switch 1.1.0", "start", "switch 1.0.0", "start"], "back on the previous release, started again");
    assert.equal(fs.existsSync(path.join(dir, "state", "update.pending")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Round 4: a cloud server with a plain disk, and the walk's other install findings

/** A directory of fake commands that log their arguments (and whatever they read on stdin, as a length only) to calls.log. */
function fakeBin(dir: string, names: string[], extra: Record<string, string> = {}): string {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(bin, n), extra[n] ?? `#!/bin/sh\necho "${n} $*" >>"${dir}/calls.log"\ncat >/dev/null 2>&1 || true\nexit 0\n`, { mode: 0o755 });
  return bin;
}
const plainHost = (dir: string) => hostEnv(fakeHost(dir, { src: "/dev/sdb1", layers: ["part", "disk"] }));

test("the three answers to a plain disk: provider-encrypted and allow-plain-disk pass and are recorded as choices, two at once is refused", () => {
  const dir = tmp();
  const env = plainHost(dir);
  const prov = sh(INSTALL, `ENC_KIND=; PROVIDER_ENC=1; check_encrypted "${dir}/data"; echo "kind=$ENC_KIND"`, env);
  assert.equal(prov.status, 0, prov.stderr);
  assert.match(prov.stdout, /cannot check that from the inside; it is recorded as your statement/);
  assert.match(prov.stdout, /kind=provider/);
  const plain = sh(INSTALL, `ALLOW_PLAIN=1; check_encrypted "${dir}/data"; echo "kind=$ENC_KIND"`, env);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /NOT encrypted at rest/);
  assert.match(plain.stdout, /kind=plain/);
  const both = sh(INSTALL, `parse_args --allow-plain-disk --provider-encrypted`);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /choose one/);
  assert.equal(sh(INSTALL, `parse_args --key-file /x`).status, 2, "--key-file goes with --encrypt-data");
  assert.equal(sh(INSTALL, `parse_args --encrypt-data --encrypt-size 2`).status, 2);
  // an encrypted disk needs none of them, and says so
  const enc = sh(INSTALL, `check_encrypted "${dir}/data"; echo "kind=$ENC_KIND"`, hostEnv(fakeHost(dir, {})));
  assert.match(enc.stdout, /kind=detected/);
  fs.rmSync(dir, { recursive: true });
});

test("doctor says what was chosen: a plain disk is a standing warning (not a failure), a provider volume is the person's word, and a closed volume is down", () => {
  const dir = tmp();
  const env = plainHost(dir);
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  const run = (extra = ""): Out => sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; ${extra ? `${extra}; ` : ""}check_all; printf '%s\n' "$FINDINGS" | grep disk_encrypted; echo "down=$DOWN"`, env);
  const none = run();
  assert.match(none.stdout, /host\.disk_encrypted\tdown\t.*--encrypt-data, --provider-encrypted or --allow-plain-disk/, "no choice recorded: down, with the options");
  fs.writeFileSync(path.join(dir, "state/encryption"), "kind=plain\nsince=2026-11-11\n");
  const plain = run();
  assert.match(plain.stdout, /host\.disk_encrypted\tdegraded\tThe data is NOT encrypted at rest\. You chose to install on a plain disk on 2026-11-11/);
  assert.doesNotMatch(plain.stdout, /disk_encrypted\tdown/, "degraded, never down: a warning does not fail doctor, so the install finishes (finding sets DOWN only for down)");
  fs.writeFileSync(path.join(dir, "state/encryption"), "kind=provider\nsince=2026-11-11\n");
  const prov = run();
  assert.match(prov.stdout, /host\.disk_encrypted\thealthy\tYou said your cloud provider encrypts/);
  assert.match(prov.stdout, /cannot see that/);
  fs.writeFileSync(path.join(dir, "state/crypt.env"), "CRYPT_TARGET=/x.luks\nCRYPT_NAME=vyre-data\nCRYPT_MOUNT=/nowhere\nCRYPT_KEYFILE=\n");
  const closed = run();
  assert.match(closed.stdout, /host\.disk_encrypted\tdown\tThe encrypted data volume is closed/);
  assert.match(closed.stdout, /vyre-server unlock/);
  fs.rmSync(dir, { recursive: true });
});

test("a file-backed LUKS volume is reported for what it is: the check cannot see where the key is, and says a key on the same disk protects nothing", () => {
  const dir = tmp();
  const host = fakeHost(dir, { src: "/dev/mapper/vyre-data", layers: ["crypt", "loop"] });
  const r = sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; check_all; printf '%s\n' "$FINDINGS" | grep disk_encrypted`, hostEnv(host));
  assert.match(r.stdout, /host\.disk_encrypted\thealthy\t.*a file on this disk.*key is kept on this same disk, it protects nothing/);
  fs.rmSync(dir, { recursive: true });
});

test("--encrypt-data: a key file beside the data is refused, a key on another volume makes the volume, and no passphrase ever reaches an argument", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  fs.mkdirSync(dirVyre, { recursive: true });
  const bin = fakeBin(dir, ["cryptsetup", "mkfs.ext4", "mount", "fallocate"], { fallocate: `#!/bin/sh\necho "fallocate $*" >>"${dir}/calls.log"\n: >"$3"\n` });
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, VYRE_DIR: dirVyre, VYRE_TEST_FS_DEVICE: `${dir}/usb=/dev/sdc1,${dir}/srv=/dev/vda1,${dir}=/dev/vda1`, VYRE_MIN_FREE_MB: "1" };
  const base = `DIR="${dirVyre}"; DATA_DIR="${dirVyre}/data"; DRY=0; ENCRYPT=1; ENCRYPT_SIZE_GB=5; `;
  fs.mkdirSync(path.join(dir, "usb"));
  // the same disk: refused, nothing made
  const same = sh(INSTALL, `${base} KEY_FILE_ARG="${dir}/key.bin"; encrypt_data "${dirVyre}/data"`, env);
  assert.notEqual(same.status, 0);
  assert.match(same.stderr, /same disk as Vyre's data\. A key kept beside the data it opens protects nothing/);
  assert.ok(!fs.existsSync(path.join(dirVyre, "data.luks")), "nothing was made");
  // no terminal and no key file: it says how to go on, and makes nothing
  const noTty = sh(INSTALL, `${base} encrypt_data "${dirVyre}/data" </dev/null`, { ...env, VYRE_TEST_NO_TTY: "1" });
  assert.notEqual(noTty.status, 0);
  // another volume: the volume is made, formatted and mounted, and the honest text is said
  const ok = sh(INSTALL, `${base} KEY_FILE_ARG="${dir}/usb/key.bin"; encrypt_data "${dirVyre}/data"; echo "kind=$ENC_KIND"`, env);
  assert.equal(ok.status, 0, ok.stderr);
  const calls = read(path.join(dir, "calls.log"));
  assert.match(calls, /cryptsetup luksFormat --batch-mode --type luks2 --key-file .*\/usb\/key\.bin .*\/srv\/data\.luks/);
  assert.match(calls, /cryptsetup open --key-file .*\/usb\/key\.bin .*data\.luks vyre-data/);
  assert.match(calls, /mkfs\.ext4 -q -L vyre-data \/dev\/mapper\/vyre-data/);
  assert.match(calls, /mount \/dev\/mapper\/vyre-data .*\/srv\/data/);
  assert.match(ok.stdout, /kind=luks/);
  assert.match(ok.stdout, /It protects a copy of this disk/);
  assert.match(ok.stdout, /does not protect against someone who can log in to this server while it runs/);
  assert.match(ok.stdout, /key is the file .*\/usb\/key\.bin on another volume/);
  const crypt = read(path.join(dirVyre, "state/crypt.env"));
  assert.match(crypt, /^CRYPT_KEYFILE=.*\/usb\/key\.bin$/m);
  assert.equal(fs.statSync(path.join(dir, "usb/key.bin")).mode & 0o777, 0o600, "a key the installer made is private");
  // dry run: says what it would do and touches nothing
  const dry = sh(INSTALL, `${base} DRY=1; encrypt_data "${dirVyre}/data"`, env);
  assert.match(dry.stdout, /would make an encrypted \(LUKS\) volume/);
  fs.rmSync(dir, { recursive: true });
});

test("a server whose data is on its own encrypted volume does not start until the volume is open; a key file on another volume opens it; unlock asks nothing it does not need", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  const mounts = path.join(dir, "mounts");
  fs.writeFileSync(mounts, "/dev/vda1 / ext4 rw 0 0\n");
  const bin = fakeBin(dir, ["cryptsetup", "mount"]);
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, VYRE_TEST_PROC_MOUNTS: mounts };
  const mk = (keyfile: string): void => fs.writeFileSync(path.join(dir, "state/crypt.env"), `CRYPT_TARGET=${dir}/data.luks\nCRYPT_NAME=vyre-data-t\nCRYPT_MOUNT=${dir}/data\nCRYPT_KEYFILE=${keyfile}\n`);
  mk("");
  const locked = sh(SERVER, `DIR="${dir}"; ensure_unlocked`, env);
  assert.equal(locked.status, 6);
  assert.match(locked.stderr, /closed .*sudo vyre-server unlock/);
  fs.writeFileSync(path.join(dir, "key"), "k");
  mk(path.join(dir, "key"));
  const auto = sh(SERVER, `DIR="${dir}"; ensure_unlocked`, env);
  assert.equal(auto.status, 0, auto.stderr);
  assert.match(read(path.join(dir, "calls.log")), /cryptsetup open --key-file .*\/key .*data\.luks vyre-data-t/);
  fs.writeFileSync(mounts, `/dev/vda1 / ext4 rw 0 0\n/dev/mapper/vyre-data-t ${dir}/data ext4 rw 0 0\n`);
  fs.rmSync(path.join(dir, "calls.log"));
  const already = sh(SERVER, `DIR="${dir}"; ensure_unlocked`, env);
  assert.equal(already.status, 0);
  assert.ok(!fs.existsSync(path.join(dir, "calls.log")), "an open volume is left alone");
  const none = sh(SERVER, `DIR="${dir}-none"; cmd_unlock`);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /not on an encrypted volume made by the installer/);
  fs.rmSync(dir, { recursive: true });
});

test("claim-link: a link on 0.0.0.0 is printed alone on stdout, and stderr says where it opens and the ways to a real address", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "space/logs"), { recursive: true });
  const link = "http://0.0.0.0:8420/claim/clm_abcdefghijklmnop#s=spc_fixture";
  fs.writeFileSync(path.join(dir, "space/logs/claim-link.txt"), `${link}\n`, { mode: 0o600 });
  const r = sh(SERVER, `DATA_DIR="${dir}"; main claim-link`);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${link}\n`, "stdout is the link alone, as before");
  assert.match(r.stderr, /opens only on this server/);
  assert.match(r.stderr, /0\.0\.0\.0 is not an address you can open from another computer/);
  assert.match(r.stderr, /ssh -L 8420:127\.0\.0\.1:8420 root@/);
  assert.match(r.stderr, /--domain/);
  fs.writeFileSync(path.join(dir, "space/logs/claim-link.txt"), "https://mla.example.com/claim/abcdefghijklmnop#s=spc_fixture\n");
  assert.equal(sh(SERVER, `DATA_DIR="${dir}"; main claim-link`).stderr, "", "a real address needs no explanation");
  fs.rmSync(dir, { recursive: true });
});

test("the finish text in relay mode never offers a 0.0.0.0 link and says what the relay is for; with the app's code it says go back to the app", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "space/logs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "space/logs/claim-link.txt"), "http://0.0.0.0:8420/claim/clm_x#s=spc\n");
  const body = `DIR="${dir}"; DATA_DIR="${dir}"; DRY=0; REL_VERSION=1.0.0; DOMAIN=""; RELAY="https://relay.vyre.run"; finish`;
  const bare = sh(INSTALL, body);
  assert.doesNotMatch(bare.stdout, /0\.0\.0\.0/);
  assert.match(bare.stdout, /No port is open to the internet on this machine/);
  assert.match(bare.stdout, /no web address that a browser can open/);
  assert.match(bare.stdout, /Vyre app/);
  assert.match(bare.stdout, /--domain vyre\.example\.com/);
  assert.doesNotMatch(bare.stdout, /Go back to the Vyre app to finish/, "not the old line that left a browser-only client stuck");
  fs.writeFileSync(path.join(dir, "vyre.env"), "VYRE_SETUP_CODE=abc\n");
  const coded = sh(INSTALL, body);
  assert.match(coded.stdout, /Go back to the app: it finds this server/);
  assert.doesNotMatch(coded.stdout, /abc/, "the code is never printed");
  fs.rmSync(dir, { recursive: true });
});

test("the domain route prints its DNS needs as short lines and says which record is wrong", () => {
  const dir = tmp();
  const resolve = path.join(dir, "resolve");
  fs.writeFileSync(resolve, "vyre.example.com 203.0.113.9\n");
  const out = sh(INSTALL, `dns_lines vyre.example.com`, { VYRE_TEST_PUBLIC_IP: "203.0.113.9", VYRE_TEST_RESOLVE: resolve });
  const lines = out.stdout.trim().split("\n");
  assert.ok(lines.every((l) => l.length < 140), "no long line");
  assert.match(out.stdout, /1\. An A record for vyre\.example\.com that points to this machine \(203\.0\.113\.9\)/);
  assert.match(out.stdout, /2\. An A record for a\.vyre\.example\.com/);
  assert.match(out.stdout, /3\. Ports 80 and 443 open to the internet/);
  assert.match(out.stdout, /ok {2}vyre\.example\.com points to this machine/);
  assert.match(out.stdout, /!! {2}a\.vyre\.example\.com has no A record yet\. Create one that points to 203\.0\.113\.9/);
  fs.writeFileSync(resolve, "vyre.example.com 198.51.100.4\na.vyre.example.com 203.0.113.9\n");
  const wrong = sh(INSTALL, `dns_lines vyre.example.com`, { VYRE_TEST_PUBLIC_IP: "203.0.113.9", VYRE_TEST_RESOLVE: resolve });
  assert.match(wrong.stdout, /!! {2}vyre\.example\.com points to 198\.51\.100\.4, but this machine is 203\.0\.113\.9/);
  fs.rmSync(dir, { recursive: true });
});

test("switching a relay install to a domain (and back) changes the configuration, says so, and keeps the data; opening no port without a domain", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  const rel = path.join(dirVyre, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  const body = (domain: string, relay: string): string => `DIR="${dirVyre}"; DATA_DIR="${dirVyre}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="${domain}"; RELAY="${relay}"; DRY=0; UPDATE_URL=https://vyre.run/server/; ENC_KIND=; write_config`;
  const first = sh(INSTALL, body("", "https://relay.vyre.run"), { VYRE_DIR: dirVyre });
  assert.equal(first.status, 0, first.stderr);
  let env = read(path.join(dirVyre, "compose.env"));
  assert.match(env, /^VYRE_RELAY_URL=https:\/\/relay\.vyre\.run$/m);
  assert.match(env, /^VYRE_BIND=127\.0\.0\.1$/m, "a relay server opens no public port");
  assert.doesNotMatch(env, /VYRE_NETWORK_REV/, "a first install has no change to apply");
  fs.mkdirSync(path.join(dirVyre, "data/space"), { recursive: true });
  fs.writeFileSync(path.join(dirVyre, "data/space/keep"), "data");
  const sw = sh(INSTALL, body("vyre.example.com", ""), { VYRE_DIR: dirVyre });
  assert.equal(sw.status, 0, sw.stderr);
  assert.match(sw.stdout, /Changing how this server is reached: from Vyre's relay \(https:\/\/relay\.vyre\.run\) to your own name, https:\/\/vyre\.example\.com\. The Space's data is kept\./);
  env = read(path.join(dirVyre, "compose.env"));
  assert.match(env, /^VYRE_ADDRESS=vyre\.example\.com$/m);
  assert.doesNotMatch(env, /VYRE_RELAY_URL/);
  assert.doesNotMatch(env, /VYRE_BIND/, "a domain needs 80 and 443 open");
  assert.match(env, /^VYRE_NETWORK_REV=\d+$/m, "the Space is told the way changed, once");
  assert.equal(read(path.join(dirVyre, "data/space/keep")), "data");
  const back = sh(INSTALL, body("", "https://relay.vyre.run"), { VYRE_DIR: dirVyre });
  assert.match(back.stdout, /from your own name, https:\/\/vyre\.example\.com to Vyre's relay/);
  env = read(path.join(dirVyre, "compose.env"));
  assert.match(env, /^VYRE_RELAY_URL=/m);
  assert.doesNotMatch(env, /VYRE_ADDRESS/);
  assert.match(env, /^VYRE_BIND=127\.0\.0\.1$/m);
  // the same flags again change nothing and say nothing
  const rev = env.match(/^VYRE_NETWORK_REV=(\d+)$/m)![1];
  const same = sh(INSTALL, body("", "https://relay.vyre.run"), { VYRE_DIR: dirVyre });
  assert.doesNotMatch(same.stdout, /Changing how/);
  assert.match(read(path.join(dirVyre, "compose.env")), new RegExp(`^VYRE_NETWORK_REV=${rev}$`, "m"));
  // and the server is recreated, not just started (a plain start does nothing when it already runs)
  const stack = sh(INSTALL, `DIR="${dirVyre}"; DRY=0; mkdir -p "${dirVyre}/current/bin"; printf '#!/bin/sh\\necho "$@" >>"${dirVyre}/started"\\n' >"${dirVyre}/current/bin/vyre-server"; chmod +x "${dirVyre}/current/bin/vyre-server"; start_stack`);
  assert.equal(stack.status, 0, stack.stderr);
  assert.equal(read(path.join(dirVyre, "started")).trim(), "start");
  fs.rmSync(dir, { recursive: true });
});

test("Docker is added by default on Debian and Ubuntu, and only after its repository key matches the fingerprint Docker publishes", () => {
  const dir = tmp();
  const osr = path.join(dir, "os-release");
  fs.writeFileSync(osr, 'ID=ubuntu\nVERSION_CODENAME=noble\nUBUNTU_CODENAME=noble\n');
  const key = path.join(dir, "keyrings");
  const lst = path.join(dir, "lists");
  fs.mkdirSync(lst);
  const good = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88";
  const mk = (fpr: string): string => fakeBin(dir, ["apt-get", "dpkg", "install", "systemctl", "curl", "gpg"], {
    "apt-get": `#!/bin/sh\necho "apt-get $*" >>"${dir}/calls.log"\n`,
    dpkg: "#!/bin/sh\necho amd64\n",
    install: `#!/bin/sh\nmkdir -p "${key}"\n`,
    systemctl: "#!/bin/sh\n",
    curl: `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && { shift; : >"$1"; }; shift; done\n`,
    gpg: `#!/bin/sh\necho "fpr:::::::::${fpr}:"\n`,
  });
  const env = (bin: string): Record<string, string> => ({ PATH: `${bin}:${process.env.PATH ?? ""}`, VYRE_OS_RELEASE: osr, VYRE_KEYRING_DIR: key, VYRE_APT_LIST_DIR: lst });
  const bad = sh(INSTALL, `TMP="${dir}"; DRY=0; docker_apt_install`, env(mk("0000000000000000000000000000000000000000")));
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /not the one Docker publishes/);
  assert.ok(!fs.existsSync(path.join(lst, "docker.list")), "the repository was not added");
  const okBin = mk(good);
  const ok = sh(INSTALL, `TMP="${dir}"; DRY=0; docker_apt_install`, env(okBin));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Docker's repository key matches the fingerprint Docker publishes/);
  assert.match(read(path.join(lst, "docker.list")), /signed-by=.*keyrings\/docker\.asc\] https:\/\/download\.docker\.com\/linux\/ubuntu noble stable/);
  assert.match(read(path.join(dir, "calls.log")), /apt-get install -y docker-ce docker-ce-cli containerd\.io docker-compose-plugin/);
  // no question is asked: the installer does what its documentation says
  assert.doesNotMatch(read(INSTALL).slice(read(INSTALL).indexOf("need_docker() {"), read(INSTALL).indexOf("# BEGIN release")), /ask /);
  fs.rmSync(dir, { recursive: true });
});

test("--uninstall --purge from a pipe says why it cannot ask, and --yes confirms", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "srv"), { recursive: true });
  const body = `DIR="${path.join(dir, "srv")}"; DATA_DIR="${path.join(dir, "srv/data")}"; PURGE=1; DRY=1; BIN_DIR="${dir}/bin"; UNIT_DIR="${dir}/units"; uninstall`;
  const piped = sh(INSTALL, body + " </dev/null");
  assert.notEqual(piped.status, 0);
  assert.match(piped.stderr, /not purged/);
  assert.match(piped.stderr, /nothing was removed/);
  assert.match(piped.stderr, /--uninstall --purge --yes|you did not answer yes/);
  const yes = sh(INSTALL, body.replace("DRY=1", "DRY=1; YES=1") + " </dev/null");
  assert.equal(yes.status, 0, yes.stderr);
  fs.rmSync(dir, { recursive: true });
});

test("vyre-server logs says it is following, and --no-follow prints and exits", () => {
  const dir = tmp();
  const run = (args: string): string => {
    fs.rmSync(path.join(dir, "dc.log"), { force: true });
    sh(SERVER, `dc(){ echo "$*" >>"${dir}/dc.log"; }; cmd_logs ${args}`);
    return read(path.join(dir, "dc.log")).trim();
  };
  assert.equal(run("vyred"), "logs -f --tail 200  vyred".replace("  ", " ").replace("-f --tail 200 vyred", "-f --tail 200 vyred"));
  assert.equal(run("--no-follow vyred"), "logs --tail 200 vyred");
  assert.equal(run("vyred --no-follow"), "logs --tail 200 vyred");
  assert.match(read(SERVER).slice(0, 1800), /--no-follow/, "the help lists it");
  fs.rmSync(dir, { recursive: true });
});

test("a backup on the same disk as the data says it is no protection and gives the one command that copies it out; on another disk it is quiet", () => {
  const dir = tmp();
  const note = (devices: string): string => sh(SERVER, `DATA_DIR="${dir}/data"; BACKUP_FILE="${dir}/backups/vyre-manual.tar.gz"; backup_note`, { VYRE_TEST_FS_DEVICE: devices }).stdout;
  const same = note(`${dir}=/dev/vda1`);
  assert.match(same, /on the same disk as the Space's data/);
  assert.match(same, /lost with it/);
  assert.match(same, /scp root@\S+:.*\/backups\/vyre-manual\.tar\.gz \./);
  assert.equal(note(`${dir}/backups=/dev/sdc1,${dir}/data=/dev/vda1`), "", "another disk: nothing to add");
  fs.rmSync(dir, { recursive: true });
});
