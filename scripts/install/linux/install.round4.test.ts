// The installer's answers to a cloud server with a plain disk and the walk's other install findings (round 4 and its review): the disk choices, the relay's honesty, the relay and domain switch, Docker, the DNS check,
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

// ---- Round 4: a cloud server with a plain disk, and the walk's other install findings

/** A directory of fake commands that log their arguments (and whatever they read on stdin, as a length only) to calls.log. */
function fakeBin(dir: string, names: string[], extra: Record<string, string> = {}): string {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(bin, n), extra[n] ?? `#!/bin/sh\necho "${n} $*" >>"${dir}/calls.log"\ncat >/dev/null 2>&1 || true\nexit 0\n`, { mode: 0o755 });
  return bin;
}
const plainHost = (dir: string) => hostEnv(fakeHost(dir, { src: "/dev/sdb1", layers: ["part", "disk"] }));

test("the two answers to a plain disk: provider-encrypted and allow-plain-disk pass and are recorded as choices; both at once is refused; a recorded choice is not silently replaced", () => {
  const dir = tmp();
  const env = plainHost(dir);
  const prov = sh(INSTALL, `ENC_KIND=; PROVIDER_ENC=1; check_encrypted "${dir}/data"; echo "kind=$ENC_KIND explicit=$ENC_EXPLICIT"`, env);
  assert.equal(prov.status, 0, prov.stderr);
  assert.match(prov.stdout, /cannot check that from the inside; it is recorded as your statement, not as verified/);
  assert.match(prov.stdout, /kind=provider explicit=1/);
  const plain = sh(INSTALL, `ALLOW_PLAIN=1; check_encrypted "${dir}/data"; echo "kind=$ENC_KIND"`, env);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /NOT encrypted at rest/);
  assert.match(plain.stdout, /kind=plain/);
  const both = sh(INSTALL, `parse_args --allow-plain-disk --provider-encrypted`);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /choose one/);
  for (const gone of ["--encrypt-data", "--encrypt-device /dev/sdb", "--key-file /x", "--encrypt-size 8"]) assert.equal(sh(INSTALL, `parse_args ${gone}`).status, 2, `${gone} is not an option`);
  // an encrypted disk needs neither, and says what was and was not verified
  const encDir = tmp();
  const enc = sh(INSTALL, `check_encrypted "${encDir}/data"; echo "kind=$ENC_KIND"`, hostEnv(fakeHost(encDir, {})));
  fs.rmSync(encDir, { recursive: true });
  assert.match(enc.stdout, /kind=detected/);
  assert.match(enc.stdout, /cannot see where its key is kept/);
  // a recorded choice stands on a re-run with no flag, for the same folder; another folder is asked again
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  fs.writeFileSync(path.join(dir, "state/encryption"), `kind=provider\nsince=2026-11-01\ndata_dir=${dir}/data\n`);
  const same = sh(INSTALL, `DIR="${dir}"; check_encrypted "${dir}/data"; echo "kind=$ENC_KIND"`, env);
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /your earlier choice stands \(provider\)/);
  assert.match(same.stdout, /kind=provider/);
  const other = sh(INSTALL, `DIR="${dir}"; check_encrypted "${dir}/elsewhere"`, env);
  assert.equal(other.status, 3, "a different folder is a different question");
  fs.rmSync(dir, { recursive: true });
});
test("doctor looks at the disk each time and says what was chosen: plain is a standing warning, the provider's encryption is its own unverified state, a recorded 'detected' is not trusted", () => {
  const dir = tmp();
  const env = plainHost(dir);
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  const run = (): Out => sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; check_all; printf '%s\n' "$FINDINGS" | grep disk_encrypted`, env);
  const none = run();
  assert.match(none.stdout, /host\.disk_encrypted\tdown\t.*--provider-encrypted \(the provider's encrypted volume\) or --allow-plain-disk/, "no choice recorded: down, with the options");
  fs.writeFileSync(path.join(dir, "state/encryption"), "kind=plain\nsince=2026-11-11\n");
  const plain = run();
  assert.match(plain.stdout, /host\.disk_encrypted\tdegraded\tThe data is NOT encrypted at rest\. You chose to install on a plain disk on 2026-11-11/);
  fs.writeFileSync(path.join(dir, "state/encryption"), "kind=provider\nsince=2026-11-11\n");
  const prov = run();
  assert.match(prov.stdout, /host\.disk_encrypted\tdegraded\tNot verified: your provider's encryption, as you stated on 2026-11-11\. This server cannot check it/);
  assert.doesNotMatch(prov.stdout, /healthy/, "never counted as encrypted");
  // a record that says "detected" is only a record: the disk is looked at now, and is plain
  fs.writeFileSync(path.join(dir, "state/encryption"), "kind=detected\nsince=2026-11-01\n");
  assert.match(run().stdout, /host\.disk_encrypted\tdown\t/, "the disk changed: doctor says so");
  // and a verified volume is healthy, in words that say what was verified
  const enc = sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; check_all; printf '%s\n' "$FINDINGS" | grep disk_encrypted`, hostEnv(fakeHost(dir, {})));
  assert.match(enc.stdout, /host\.disk_encrypted\thealthy\t.*verified here; where its key is kept is not visible/);
  fs.rmSync(dir, { recursive: true });
});
test("a file-backed LUKS volume (one the person made) is reported for what it is: a warning, because the check cannot see where the key is", () => {
  const dir = tmp();
  const host = fakeHost(dir, { src: "/dev/mapper/vyre-data", layers: ["crypt", "loop"] });
  const r = sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; check_all; printf '%s\n' "$FINDINGS" | grep disk_encrypted`, hostEnv(host));
  assert.match(r.stdout, /host\.disk_encrypted\tdegraded\t.*a file on this disk.*cannot tell where its key is kept.*protects nothing/);
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
  assert.match(wrong.stdout, /\?\? {2}vyre\.example\.com points to 198\.51\.100\.4; this machine's public address appears to be 203\.0\.113\.9\. If a proxy or load balancer is in front, that is fine/);
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

test("Docker is added on Debian and Ubuntu: said first, only Docker's own key is trusted (a file holding a second key gives apt nothing extra), a machine with containerd is left alone, and the log survives", () => {
  const dir = tmp();
  const osr = path.join(dir, "os-release");
  fs.writeFileSync(osr, 'ID=ubuntu\nVERSION_CODENAME=noble\nUBUNTU_CODENAME=noble\n');
  const key = path.join(dir, "keyrings");
  const lst = path.join(dir, "lists");
  fs.mkdirSync(lst);
  fs.mkdirSync(path.join(dir, "tmp"));
  const good = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88";
  const evil = "AAAA00000000000000000000000000000000AAAA";
  // a fake gpg that behaves like the real one on the points that matter: --import reads the downloaded file (its fingerprints are in the file), --export FPR writes only that key,
  // --show-keys lists the keys in a keyring file. A key file is a text file with one "fpr:<id>" line per key.
  const gpg = `#!/bin/sh
echo "gpg $*" >>"${dir}/calls.log"
case "$*" in
  *--import*) for a; do f=$a; done; cp "$f" "${dir}/imported" ;;
  *--export*) for a; do fpr=$a; done; grep -x "fpr:$fpr" "${dir}/imported" >&1 || true ;;
  *--show-keys*) for a; do f=$a; done; sed -n 's/^fpr:/fpr:::::::::/p;' "$f" | sed 's/$/:/' ;;
esac
exit 0
`;
  const mk = (keyFileLines: string[], dpkgInstalled = ""): string => fakeBin(dir, ["apt-get", "dpkg", "install", "systemctl", "curl", "gpg"], {
    "apt-get": `#!/bin/sh\necho "apt-get $*" >>"${dir}/calls.log"\n`,
    dpkg: `#!/bin/sh\nif [ "$1" = -s ]; then case " ${dpkgInstalled} " in *" $2 "*) echo "Status: install ok installed"; exit 0 ;; esac; exit 1; fi\necho amd64\n`,
    install: `#!/bin/sh\nfor a; do last=$a; done\ncase "$*" in *-d*) mkdir -p "${key}" ;; *) mkdir -p "${key}"; cp "$3" "$last" ;; esac\n`,
    systemctl: "#!/bin/sh\n",
    curl: `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && { shift; printf '%s\\n' ${keyFileLines.map((l) => `'${l}'`).join(" ")} >"$1"; }; shift; done\n`,
    gpg,
  });
  const env = (bin: string): Record<string, string> => ({ PATH: `${bin}:${process.env.PATH ?? ""}`, VYRE_OS_RELEASE: osr, VYRE_KEYRING_DIR: key, VYRE_APT_LIST_DIR: lst });
  const run = (bin: string): Out => sh(INSTALL, `TMP="${dir}/tmp"; DIR="${dir}/srv"; DRY=0; docker_apt_install`, env(bin));
  // a file that does not hold Docker's key at all: refused, nothing added
  const none = run(mk([`fpr:${evil}`]));
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /does not hold the key Docker publishes/);
  assert.ok(!fs.existsSync(path.join(lst, "docker.list")), "the repository was not added");
  // a file holding Docker's key and a second one: only Docker's is trusted (the keyring apt reads is built from the pinned fingerprint alone)
  const two = run(mk([`fpr:${good}`, `fpr:${evil}`]));
  assert.equal(two.status, 0, two.stderr);
  assert.match(two.stdout, /Docker is not installed\. This installer will now install Docker Engine .* Add --no-docker-install to stop here instead/, "said before it is done");
  assert.match(two.stdout, /only that key is trusted/);
  const calls = read(path.join(dir, "calls.log"));
  assert.match(calls, new RegExp(`--export ${good}$`, "m"), "the keyring is exported by the pinned fingerprint");
  const ring = read(path.join(key, "docker.gpg"));
  assert.match(ring, new RegExp(good));
  assert.doesNotMatch(ring, new RegExp(evil), "the second key never reaches apt");
  assert.match(read(path.join(lst, "docker.list")), /signed-by=.*keyrings\/docker\.gpg\] https:\/\/download\.docker\.com\/linux\/ubuntu noble stable/);
  assert.match(calls, /apt-get install -y docker-ce docker-ce-cli containerd\.io docker-compose-plugin/);
  // a machine that already runs containerd (or another engine) is not changed, and says what and why
  const conflict = run(mk([`fpr:${good}`], "containerd"));
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /already has containerd installed, which Docker's own packages would replace/);
  assert.match(conflict.stderr, /Nothing was changed/);
  // a failed install leaves its log where the message says, after the installer has exited and cleaned up its temp folder
  const failBin = mk([`fpr:${good}`]);
  fs.writeFileSync(path.join(failBin, "apt-get"), `#!/bin/sh\necho "apt-get $*" >>"${dir}/calls.log"\ncase "$*" in *docker-ce*) echo "E: broken" ; exit 100 ;; esac\n`, { mode: 0o755 });
  const failed = sh(INSTALL, `TMP="${dir}/tmp"; DIR="${dir}/srv"; DRY=0; trap cleanup EXIT; docker_apt_install`, env(failBin));
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, new RegExp(`Its own output is in ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/srv/state/docker-install\\.log`));
  assert.match(read(path.join(dir, "srv/state/docker-install.log")), /E: broken/, "the log the message names is still there");
  // --no-docker-install stops instead
  const no = sh(INSTALL, `NO_DOCKER=1; PATH=/nonexistent; need_docker`, {});
  assert.notEqual(no.status, 0);
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

// ---- Round 5: the review's findings that remain once the installer no longer makes encrypted volumes

test("backups live with the data: a data folder on another volume holds its backups too, an empty or unmounted data folder writes none and never pushes real backups out", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  const rel = path.join(dirVyre, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  const cfg = (data: string): Out => sh(INSTALL, `DIR="${dirVyre}"; DATA_DIR="${data}"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="vyre.example.com"; RELAY=""; DRY=0; UPDATE_URL=https://vyre.run/server/; ENC_KIND=provider; write_config`, { VYRE_DIR: dirVyre });
  const other = path.join(dir, "mnt/vyre/data");
  assert.equal(cfg(other).status, 0);
  assert.equal(read(path.join(dirVyre, "backup-dir")).trim(), path.join(other, "backups"), "a provider volume holds its own backups, so they are as protected as the data");
  assert.ok(fs.existsSync(path.join(other, "backups")));
  fs.rmSync(path.join(dirVyre, "backup-dir"));
  assert.equal(cfg(path.join(dirVyre, "data")).status, 0);
  assert.equal(read(path.join(dirVyre, "backup-dir")).trim(), path.join(dirVyre, "backups"), "the default layout is unchanged");
  // no Space in the data folder (an unmounted volume): no backup, and the earlier ones stay
  const old = path.join(dirVyre, "backups");
  for (const n of ["a", "b", "c"]) fs.writeFileSync(path.join(old, `vyre-${n}-20261101T000000Z.tar.gz`), n);
  const env = { VYRE_DIR: dirVyre };
  const r = sh(SERVER, `DATA_DIR="${dirVyre}/empty"; dc(){ :; }; stop_strays(){ :; }; backup_data manual live`, env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /there is no Space in .*empty \(no space\/events\.db\): is the data volume mounted\? No backup was written, and the earlier backups were left as they are/);
  assert.equal(fs.readdirSync(old).filter((f) => f.endsWith(".tar.gz")).length, 3, "nothing was pruned or added");
  fs.rmSync(dir, { recursive: true });
});

test("--uninstall --purge does what it says and says what it did: contents of a mount point go and the folder stays, backups elsewhere go, and what is not removed is named", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  const data = path.join(dir, "mnt/data");
  fs.mkdirSync(path.join(data, "space"), { recursive: true });
  fs.writeFileSync(path.join(data, "space/events.db"), "x");
  fs.mkdirSync(path.join(data, "backups"));
  fs.writeFileSync(path.join(data, "backups/vyre-a.tar.gz"), "b");
  fs.mkdirSync(dirVyre);
  fs.writeFileSync(path.join(dirVyre, "data-dir"), `${data}\n`);
  fs.writeFileSync(path.join(dirVyre, "backup-dir"), `${data}/backups\n`);
  const bin = fakeBin(dir, ["mountpoint"], { mountpoint: `#!/bin/sh\n[ "$2" = "${data}" ]\n` });
  const out = sh(INSTALL, `DIR="${dirVyre}"; DATA_DIR="${data}"; PURGE=1; YES=1; DRY=0; BIN_DIR="${dir}/bin"; UNIT_DIR="${dir}/units"; uninstall`, { PATH: `${bin}:${process.env.PATH ?? ""}` });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(fs.existsSync(data), "a mount point cannot be removed");
  assert.deepEqual(fs.readdirSync(data), [], "but it is emptied, backups included");
  assert.ok(!fs.existsSync(dirVyre));
  assert.match(out.stdout, /Removed: the server's containers and Docker volumes, the Space's data \(the folder .* stays, because it is a separate volume's mount point, but it is empty\), every backup in .*backups, the install folder/);
  assert.match(out.stdout, /Not removed: the Docker images it pulled .*, Docker itself, your DNS records, certificates issued for the name, and any backup you copied somewhere else\./);
  fs.rmSync(dir, { recursive: true });
});

test("the DNS check asks a public resolver (dig) rather than this machine's hosts file, takes only an IPv4 answer, forces IPv4 for its own address, and a proxy is not called wrong", () => {
  const dir = tmp();
  const bin = fakeBin(dir, ["dig", "curl"], {
    dig: `#!/bin/sh\necho "dig $*" >>"${dir}/calls.log"\nprintf 'cname.example.net.\\n203.0.113.9\\n'\n`,
    curl: `#!/bin/sh\necho "curl $*" >>"${dir}/calls.log"\ncase "$*" in *ipify*) printf '<html>not an address</html>' ;; *) printf '203.0.113.9\\n' ;; esac\n`,
  });
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, VYRE_TEST_ALLOW_NET: "1" };
  const out = sh(INSTALL, `dns_lines vyre.example.com`, env);
  const calls = read(path.join(dir, "calls.log"));
  assert.match(calls, /curl -4 -fsS --max-time 5 https:\/\/api\.ipify\.org/, "IPv4 forced");
  assert.match(calls, /curl -4 .*ifconfig\.me\/ip/, "an answer that is not an address is skipped and the next service asked");
  assert.match(calls, /dig \+short \+time=3 \+tries=1 A vyre\.example\.com @1\.1\.1\.1/, "a public resolver, not /etc/hosts");
  assert.match(out.stdout, /ok {2}vyre\.example\.com points to this machine \(203\.0\.113\.9\)/, "the CNAME line in dig's answer is ignored");
  fs.writeFileSync(path.join(bin, "dig"), `#!/bin/sh\nprintf '104.16.0.1\\n'\n`, { mode: 0o755 });
  const proxied = sh(INSTALL, `dns_lines vyre.example.com`, env);
  assert.match(proxied.stdout, /\?\? {2}vyre\.example\.com points to 104\.16\.0\.1; this machine's public address appears to be 203\.0\.113\.9\. If a proxy or load balancer is in front, that is fine/);
  assert.doesNotMatch(proxied.stdout, /Change the record/, "no advice that would break a working proxy setup");
  fs.rmSync(dir, { recursive: true });
});

test("the disk choice is written once and changed only in the open: a first install records it with the folder, a re-run keeps it, a different choice says what changed", () => {
  const dir = tmp();
  const dirVyre = path.join(dir, "srv");
  const rel = path.join(dirVyre, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  const cfg = (kind: string): Out => sh(INSTALL, `DIR="${dirVyre}"; DATA_DIR="${dirVyre}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="vyre.example.com"; RELAY=""; DRY=0; UPDATE_URL=https://vyre.run/server/; ENC_KIND=${kind}; write_config`, { VYRE_DIR: dirVyre });
  const first = cfg("provider");
  assert.equal(first.status, 0, first.stderr);
  const rec = read(path.join(dirVyre, "state/encryption"));
  assert.match(rec, /^kind=provider$/m);
  assert.match(rec, new RegExp(`^data_dir=${dirVyre}/data$`, "m"));
  const since = /^since=(.*)$/m.exec(rec)![1];
  fs.writeFileSync(path.join(dirVyre, "state/encryption"), rec.replace(since, "2026-01-02"));
  const same = cfg("provider");
  assert.doesNotMatch(same.stdout, /recorded disk choice changed/);
  assert.match(read(path.join(dirVyre, "state/encryption")), /^since=2026-01-02$/m, "the date of the original choice is kept");
  assert.match(read(path.join(dirVyre, "compose.env")), /^VYRE_DISK_ENCRYPTION_SINCE=2026-01-02$/m);
  const changed = cfg("plain");
  assert.match(changed.stdout, /The recorded disk choice changed: from provider to plain\./);
  assert.match(read(path.join(dirVyre, "state/encryption")), /^kind=plain$/m);
  fs.rmSync(dir, { recursive: true });
});

test("vyre-server looks at the disk at each start and tells the Console what it sees; an update closes the relay server's public ports", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=x\nVYRE_DISK_ENCRYPTION=detected\nVYRE_DISK_ENCRYPTION_SINCE=2026-11-01\n");
  const env = plainHost(dir);
  // the recorded "detected" is not true any more: the volume is plain, nothing was said by the person, so the line goes
  const r = sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; refresh_disk_env; cat "${dir}/compose.env"`, env);
  assert.doesNotMatch(r.stdout, /VYRE_DISK_ENCRYPTION/);
  // the person's statement stays, and a verified volume is detected
  fs.writeFileSync(path.join(dir, "state/encryption"), "kind=provider\nsince=2026-11-05\n");
  const p = sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; refresh_disk_env; cat "${dir}/compose.env"`, env);
  assert.match(p.stdout, /^VYRE_DISK_ENCRYPTION=provider$/m);
  assert.match(p.stdout, /^VYRE_DISK_ENCRYPTION_SINCE=2026-11-05$/m);
  const enc = tmp();
  fs.writeFileSync(path.join(enc, "compose.env"), "VYRE_IMAGE=x\n");
  const e = sh(SERVER, `DIR="${enc}"; DATA_DIR="${enc}/data"; refresh_disk_env; cat "${enc}/compose.env"`, hostEnv(fakeHost(enc, {})));
  assert.match(e.stdout, /^VYRE_DISK_ENCRYPTION=detected$/m);
  // sync_image (an update) adds the loopback bind to a server that has no domain, and leaves a domain server alone
  const rel = path.join(dir, "releases/1.0.0");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  fs.symlinkSync("releases/1.0.0", path.join(dir, "current"));
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=old\nVYRE_RELAY_URL=https://relay.vyre.run\n");
  assert.equal(sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; sync_image`, env).status, 0);
  assert.match(read(path.join(dir, "compose.env")), /^VYRE_BIND=127\.0\.0\.1$/m);
  fs.writeFileSync(path.join(dir, "compose.env"), "VYRE_IMAGE=old\nVYRE_ADDRESS=vyre.example.com\n");
  assert.equal(sh(SERVER, `DIR="${dir}"; DATA_DIR="${dir}/data"; sync_image`, env).status, 0);
  assert.doesNotMatch(read(path.join(dir, "compose.env")), /VYRE_BIND/);
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(enc, { recursive: true });
});
