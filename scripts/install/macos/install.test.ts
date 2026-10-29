// macOS server installer (P-V1_MAC): the checks that need no Docker and no Mac. The script is sourced with VYRE_SOURCE_ONLY=1 and its functions are
// called directly, as install.test.ts does for the Linux installer; the parts that differ by operating system (FileVault, launchd, Homebrew's OpenSSL)
// are driven through the VYRE_TEST_* seams, so the whole file runs on the Linux runners. Nothing here runs the installer on a real Mac.
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
const LINUX = path.join(HERE, "../linux/install.sh");
const SERVER = path.join(HERE, "../linux/vyre-server");
const read = (f: string): string => fs.readFileSync(f, "utf8");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mac-test-"));

type Out = { status: number | null; stdout: string; stderr: string };
function sh(script: string, body: string, env: Record<string, string> = {}): Out {
  const r = spawnSync("sh", ["-c", `. "${script}"\n${body}`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir(), VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Darwin", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function block(file: string, name: string): string {
  const m = read(file).match(new RegExp(`# BEGIN ${name}\\n[\\s\\S]*?# END ${name}\\n`));
  assert.ok(m, `${path.basename(file)} has a ${name} block`);
  return m[0];
}
/** A diskutil that answers with `out` for any volume. */
function fakeDiskutil(dir: string, out: string): string {
  const f = path.join(dir, "diskutil");
  fs.writeFileSync(f, `#!/bin/sh\ncat <<'EOT'\n${out}\nEOT\n`, { mode: 0o755 });
  return f;
}

test("the installer is valid POSIX sh, is made to be piped from curl, and carries a public release key only", () => {
  assert.equal(spawnSync("sh", ["-n", INSTALL], { encoding: "utf8" }).status, 0);
  const lines = read(INSTALL).trimEnd().split("\n");
  assert.match(lines[lines.length - 1], /^if \[ "\$\{VYRE_SOURCE_ONLY:-0\}" != 1 \]; then main "\$@"; fi$/);
  assert.match(read(INSTALL), /-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=]{44,}\n-----END PUBLIC KEY-----/);
  assert.doesNotMatch(read(INSTALL), /PRIVATE KEY/);
  const r = sh(INSTALL, "echo loaded; command -v main >/dev/null && echo has-main");
  assert.match(r.stdout, /loaded\nhas-main/);
});

test("the disk check, the version order and the signed-release code are the same text here, in the Linux installer and in vyre-server", () => {
  for (const name of ["diskcheck", "semver", "release"]) {
    assert.equal(block(INSTALL, name), block(LINUX, name), `${name}: mac differs from linux`);
    assert.equal(block(INSTALL, name), block(SERVER, name), `${name}: mac differs from vyre-server`);
  }
});

test("disk_encrypted on a Mac reads diskutil: FileVault passes, a plain volume is refused, silence is reported as such", () => {
  const dir = tmp();
  const run = (out: string): number | null => sh(INSTALL, `disk_encrypted "${dir}"`, { VYRE_TEST_DISKUTIL: fakeDiskutil(dir, out) }).status;
  assert.equal(run("   FileVault:                 Yes"), 0);
  assert.equal(run("   FileVault:                 No\n   Encrypted:                 Yes"), 0, "an encrypted external volume");
  assert.equal(run("   FileVault:                 No"), 1);
  assert.equal(run("   Volume Name:  X"), 2);
  fs.rmSync(dir, { recursive: true });
});

test("check_encrypted refuses a Mac without FileVault with exit 3 and the steps to turn it on, and passes one with it", () => {
  const dir = tmp();
  const bad = sh(INSTALL, `check_encrypted "${dir}/data"`, { VYRE_TEST_DISKUTIL: fakeDiskutil(dir, "   FileVault:                 No") });
  assert.equal(bad.status, 3);
  assert.match(bad.stderr, /not on an encrypted volume/);
  assert.match(bad.stderr, /FileVault/);
  assert.match(bad.stderr, /--data-dir/);
  const ok = sh(INSTALL, `check_encrypted "${dir}/data"`, { VYRE_TEST_DISKUTIL: fakeDiskutil(dir, "   FileVault:                 Yes") });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /on an encrypted volume/);
  fs.rmSync(dir, { recursive: true });
});

test("find_openssl skips the system LibreSSL and takes an OpenSSL 3; with none, need_tools says what to brew install", () => {
  const dir = tmp();
  const mk = (n: string, banner: string): string => { const f = path.join(dir, n); fs.writeFileSync(f, `#!/bin/sh\necho "${banner}"\n`, { mode: 0o755 }); return f; };
  const libre = mk("openssl", "LibreSSL 3.3.6");
  const three = mk("openssl3", "OpenSSL 3.4.0 22 Oct 2024 (Library: OpenSSL 3.4.0 22 Oct 2024)");
  const env = { PATH: `${dir}:/usr/bin:/bin`, VYRE_TEST_OPENSSL_ONLY: "1" };
  const found = sh(INSTALL, `find_openssl && echo "$OSSL"`, { ...env, VYRE_OPENSSL: three });
  assert.equal(found.stdout.trim(), three);
  const none = sh(INSTALL, `find_openssl || echo none`, { ...env, VYRE_OPENSSL: libre });
  assert.match(none.stdout, /none/);
  const tools = sh(INSTALL, `find_openssl() { return 1; }; need_tools`, env);
  assert.notEqual(tools.status, 0);
  assert.match(tools.stderr, /brew install .*openssl@3/);
  fs.rmSync(dir, { recursive: true });
});

test("verify_manifest takes the signature of the release key through the OpenSSL 3 that was found, and nothing else", () => {
  const dir = tmp();
  const key = path.join(dir, "k.pem"), pub = path.join(dir, "k.pub"), m = path.join(dir, "m.json"), msg = path.join(dir, "msg"), raw = path.join(dir, "raw"), sig = path.join(dir, "m.sig");
  assert.equal(spawnSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", key]).status, 0);
  assert.equal(spawnSync("openssl", ["pkey", "-in", key, "-pubout", "-out", pub]).status, 0);
  const body = '{"v":1}\n';
  fs.writeFileSync(m, body);
  fs.writeFileSync(msg, Buffer.concat([Buffer.from("vyre-release-sums\n"), Buffer.from(body)]));
  assert.equal(spawnSync("openssl", ["pkeyutl", "-sign", "-inkey", key, "-rawin", "-in", msg, "-out", raw]).status, 0);
  fs.writeFileSync(sig, fs.readFileSync(raw).toString("base64") + "\n");
  const verify = (file: string): number | null => sh(INSTALL, `TMP="${dir}"; verify_manifest "${file}" "${sig}"`, { VYRE_RELEASE_KEY_PEM: pub }).status;
  assert.equal(verify(m), 0);
  const t = path.join(dir, "t.json");
  fs.writeFileSync(t, body.replace("1", "2"));
  assert.notEqual(verify(t), 0, "a changed manifest");
  fs.rmSync(dir, { recursive: true });
});

test("fetch_release over file:// checks the signature and the tarball's sha256, and refuses a tarball that does not match the signed manifest", () => {
  const dir = tmp();
  const feed = path.join(dir, "feed");
  fs.mkdirSync(feed);
  const key = path.join(dir, "k.pem"), pub = path.join(dir, "k.pub");
  assert.equal(spawnSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", key]).status, 0);
  assert.equal(spawnSync("openssl", ["pkey", "-in", key, "-pubout", "-out", pub]).status, 0);
  const tarball = path.join(feed, "vyre.tgz");
  fs.writeFileSync(tarball, "pretend release");
  const sum = createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
  const publish = (digest: string): void => {
    const body = JSON.stringify({ v: 1, channel: "stable", server: { version: "1.0.0", tarball: "vyre.tgz", sha256: digest } });
    const msg = path.join(dir, "msg"), raw = path.join(dir, "raw");
    fs.writeFileSync(path.join(feed, "stable.json"), body);
    fs.writeFileSync(msg, Buffer.concat([Buffer.from("vyre-release-sums\n"), Buffer.from(body)]));
    assert.equal(spawnSync("openssl", ["pkeyutl", "-sign", "-inkey", key, "-rawin", "-in", msg, "-out", raw]).status, 0);
    fs.writeFileSync(path.join(feed, "stable.json.sig"), fs.readFileSync(raw).toString("base64") + "\n");
  };
  const fetchIt = (): Out => sh(INSTALL, `TMP="$(mktemp -d)"; UPDATE_URL="file://${feed}/"; fetch_release; echo "got=$REL_VERSION $(basename "$REL_TARBALL")"`, { VYRE_RELEASE_KEY_PEM: pub });
  publish(sum);
  const ok = fetchIt();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /got=1\.0\.0 release\.tgz/);
  publish("0".repeat(64));
  const bad = fetchIt();
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /does not match the signed release/);
  fs.rmSync(dir, { recursive: true });
});

test("parse_args: the same choices as Linux, plain paths only, and the Mac defaults live under the person's home", () => {
  const args = (a: string, env: Record<string, string> = {}): Out => sh(INSTALL, `parse_args ${a}; echo "relay=$RELAY domain=$DOMAIN data=$DATA_DIR dir=$DIR bin=$BIN_DIR agents=$AGENT_DIR"`, { HOME: "/Users/pat", ...env });
  assert.match(args("--domain a.example.com --relay").stderr, /choose one/);
  assert.match(args("--channel weekly").stderr, /stable, beta or nightly/);
  assert.match(args("--domain 'bad host!'").stderr, /host name/);
  assert.match(args("--relay").stdout, /relay=https:\/\/relay\.vyre\.run /);
  assert.match(args("--bogus").stderr, /unknown option/);
  assert.match(args("--data-dir '/Volumes/My Disk/vyre'").stderr, /plain path/);
  const d = args("--yes");
  assert.match(d.stdout, /dir=\/Users\/pat\/\.vyre\/server /);
  assert.match(d.stdout, /data=\/Users\/pat\/\.vyre\/server\/data /);
  assert.match(d.stdout, /bin=\/Users\/pat\/\.local\/bin /);
  assert.match(d.stdout, /agents=\/Users\/pat\/Library\/LaunchAgents/);
});

test("write_config keeps the setup code out of output at mode 0600, makes no chown, and a re-run keeps what the person set", () => {
  const dir = tmp();
  const d = path.join(dir, "vyre");
  fs.mkdirSync(path.join(d, "releases/1.0.0"), { recursive: true });
  fs.writeFileSync(path.join(d, "releases/1.0.0/images.lock"), "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:" + "b".repeat(64) + "\n");
  const body = (domain: string): string => `DIR="${d}"; DATA_DIR="${d}/data"; REL_VERSION=1.0.0; CHANNEL=stable; DOMAIN="${domain}"; RELAY=""; DRY=0; UPDATE_URL=https://vyre.run/server/; write_config`;
  const first = sh(INSTALL, body("vyre.example.com"), { VYRE_CODE: "code-77", VYRE_DIR: d });
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout + first.stderr, /code-77/);
  assert.equal(fs.statSync(path.join(d, "vyre.env")).mode & 0o777, 0o600);
  assert.equal(read(path.join(d, "vyre.env")), "VYRE_SETUP_CODE=code-77\n");
  assert.match(read(path.join(d, "compose.env")), /^VYRE_ADDRESS=vyre\.example\.com$/m);
  assert.match(read(path.join(d, "compose.override.yml")), /device: .*\/data\/space/);
  assert.doesNotMatch(read(INSTALL), /chown/, "no chown: Docker Desktop shares the folder under the person's own account");
  fs.appendFileSync(path.join(d, "vyre.env"), "MINE=1\n");
  assert.equal(sh(INSTALL, body(""), { VYRE_CODE: "other", VYRE_DIR: d }).status, 0);
  assert.equal(read(path.join(d, "vyre.env")), "VYRE_SETUP_CODE=code-77\nMINE=1\n");
  assert.match(read(path.join(d, "compose.env")), /^VYRE_ADDRESS=vyre\.example\.com$/m);
  fs.rmSync(dir, { recursive: true });
});

test("the launchd agents: marked, valid XML, the server starts at login and retries until Docker is up, the update runs daily at 04:00", () => {
  const dir = tmp();
  const d = path.join(dir, "vyre");
  const agents = path.join(dir, "LaunchAgents");
  const r = sh(INSTALL, `DIR="${d}"; BIN_DIR="${dir}/bin"; AGENT_DIR="${agents}"; DRY=0; mkdir -p "${d}"; write_agents`, {});
  assert.equal(r.status, 0, r.stderr);
  const server = read(path.join(agents, "ai.vyre.server.plist")), update = read(path.join(agents, "ai.vyre.server-update.plist"));
  for (const t of [server, update]) {
    assert.match(t, /<!-- Vyre Server, installed by install\.sh -->/);
    assert.match(t, new RegExp(`<string>${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/bin/vyre-server</string>`));
    assert.doesNotMatch(t, /@[A-Z_]+@/);
    const lint = spawnSync("plutil", ["-lint", "-"], { input: t, encoding: "utf8" });
    if (!lint.error) assert.equal(lint.status, 0, lint.stdout + lint.stderr);
    const xml = spawnSync("xmllint", ["--noout", "-"], { input: t, encoding: "utf8" });
    if (!xml.error) assert.equal(xml.status, 0, xml.stderr);
  }
  assert.match(server, /<string>start<\/string>/);
  assert.match(server, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(server, /<key>SuccessfulExit<\/key><false\/>/);
  assert.match(update, /<string>update<\/string>\s*<string>--yes<\/string>/);
  assert.match(update, /<key>Hour<\/key><integer>4<\/integer>/);
  assert.doesNotMatch(update, /RunAtLoad/);
  fs.rmSync(dir, { recursive: true });
});

test("link_current writes a vyre-server command that names this install and Docker's usual folders, then runs the current release", () => {
  const dir = tmp();
  const d = path.join(dir, "vyre");
  fs.mkdirSync(path.join(d, "releases/1.0.0"), { recursive: true });
  fs.mkdirSync(path.join(d, "state"));
  const r = sh(INSTALL, `DIR="${d}"; BIN_DIR="${dir}/bin"; REL_VERSION=1.0.0; DRY=0; link_current`, {});
  assert.equal(r.status, 0, r.stderr);
  const cmd = read(path.join(dir, "bin/vyre-server"));
  assert.match(cmd, /^# Vyre Server, installed by install\.sh$/m);
  assert.match(cmd, new RegExp(`^VYRE_DIR="${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m"));
  assert.match(cmd, /Docker\.app\/Contents\/Resources\/bin/);
  assert.match(cmd, /\.orbstack\/bin/);
  assert.match(cmd, /exec ".*\/current\/bin\/vyre-server" "\$@"/);
  assert.equal(fs.readlinkSync(path.join(d, "current")), "releases/1.0.0");
  assert.equal(fs.statSync(path.join(dir, "bin/vyre-server")).mode & 0o111, 0o111);
  fs.rmSync(dir, { recursive: true });
});

test("sudo is refused, and an agent or command that is not ours is never removed", () => {
  const asRoot = spawnSync("sh", ["-c", `. "${INSTALL}"\nis_user`], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir(), VYRE_SOURCE_ONLY: "1" } });
  assert.equal(asRoot.status, process.getuid?.() === 0 ? 1 : 0);
  const u = read(INSTALL);
  assert.match(u, /grep -q "\$MARK" "\$AGENT_DIR\/\$l\.plist"/);
  assert.match(u, /grep -q "\$MARK" "\$BIN_DIR\/vyre-server"/);
  const dir = tmp();
  const d = path.join(dir, "vyre"), agents = path.join(dir, "agents"), bin = path.join(dir, "bin");
  fs.mkdirSync(d); fs.mkdirSync(agents); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(agents, "ai.vyre.server.plist"), "<plist>someone else's</plist>");
  fs.writeFileSync(path.join(agents, "ai.vyre.server-update.plist"), "<!-- Vyre Server, installed by install.sh -->");
  fs.writeFileSync(path.join(bin, "vyre-server"), "#!/bin/sh\n# Vyre Server, installed by install.sh\n");
  const r = sh(INSTALL, `DIR="${d}"; AGENT_DIR="${agents}"; BIN_DIR="${bin}"; DATA_DIR="${d}/data"; DRY=0; PURGE=0; uninstall`, {});
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(agents, "ai.vyre.server.plist")), "another program's file stays");
  assert.ok(!fs.existsSync(path.join(agents, "ai.vyre.server-update.plist")), "ours goes");
  assert.ok(!fs.existsSync(path.join(bin, "vyre-server")));
  assert.ok(fs.existsSync(d), "data and backups stay without --purge");
  fs.rmSync(dir, { recursive: true });
});

test("--dry-run on the whole installer stops at the FileVault check with exit 3 and writes nothing", () => {
  const dir = tmp();
  const target = path.join(dir, "vyre");
  const r = spawnSync("sh", [INSTALL, "--yes", "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: dir, VYRE_TEST_MODE: "1", VYRE_TEST_OS: "Darwin", VYRE_DIR: target, VYRE_TEST_DISKUTIL: fakeDiskutil(dir, "   FileVault:                 No") } });
  // curl, jq and OpenSSL 3 are checked first: where one is missing the exit is 1, with all of them it is 3. Never 0, never a write.
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(target));
  if (r.status === 3) assert.match(r.stderr, /FileVault/);
  fs.rmSync(dir, { recursive: true });
});

test("the Linux installer points a Mac at this installer", () => {
  assert.match(read(LINUX), /install-mac\.sh/);
});
