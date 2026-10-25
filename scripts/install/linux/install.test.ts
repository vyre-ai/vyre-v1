// Linux installer (P-L10_09, spec 3.13, ARCH 7.13): the checks that need no Docker. The scripts are sourced with VYRE_SOURCE_ONLY=1 and their
// functions are called directly, so each test names one rule: the signature check, the encrypted-disk refusal, the version order, the units.
// The full install on real Docker is install.heavy.test.sh; the last test here runs it when VYRE_HEAVY_DOCKER=1 and is skipped by name otherwise.
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
/** Runs a snippet of sh with a script's functions loaded and nothing else executed. */
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", ...env } });
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

test("check_encrypted refuses a plain disk with exit 3 and the LUKS steps, and passes an encrypted one", () => {
  const dir = tmp();
  const plain = fakeHost(dir, { src: "/dev/sdb1", layers: ["part", "disk"] });
  const bad = sh(INSTALL, `check_encrypted "${dir}/data"`, hostEnv(plain));
  assert.equal(bad.status, 3);
  assert.match(bad.stderr, /not on an encrypted volume/);
  assert.match(bad.stderr, /cryptsetup luksFormat/);
  assert.match(bad.stderr, /--data-dir/);
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
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
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
  const r = spawnSync("sh", [INSTALL, "--yes", "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", VYRE_TEST_MODE: "1", VYRE_TEST_NONROOT: "1", VYRE_DIR: target, ...hostEnv(plain) } });
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
