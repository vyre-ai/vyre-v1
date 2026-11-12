// Round 8 of the installer: a Mac: doctor, macOS tools, the wrapper, the installer re-run, the manifest version, the damaged-database hold in doctor. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SERVER, INSTALL, MAC, read, tmp, esc, SAME, sh, world, MAC_ENV, db, mkSpace, releases, macDoctor, holdingServer } from "./install.round8-kit.test.ts";
import type { Out } from "./install.round8-kit.test.ts";

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
test("re-running the Mac installer over an old install switches `current` before it loads the daily update, and never loads it for a release whose updater predates the fix", () => {
  const text = read(MAC);
  const main = text.slice(text.indexOf("\nmain() {"));
  assert.ok(main.indexOf("  link_current\n") > 0 && main.indexOf("  link_current\n") < main.indexOf("  write_agents\n"), "link_current (the new updater in place) comes before write_agents (the daily job)");
  const dir = tmp();
  try {
    releases(dir, { old: "#!/bin/sh\n# vyre-server: run and look after Vyre Server (an old one)\n", new: read(SERVER) });
    const agents = path.join(dir, "agents");
    const run = (): Out => sh(MAC, `DIR="${dir}"; AGENT_DIR="${agents}"; BIN_DIR="${dir}/bin"; DRY=0; write_agents`, { ...MAC_ENV });
    // current is the old release: the job files are written, the job is not turned on, and the person is told why
    const old = run();
    assert.equal(old.status, 0, old.stderr);
    assert.match(old.stdout, /The daily update is not turned on: the release in .* has an updater that would back up the live databases from macOS\./);
    assert.equal(sh(MAC, `DIR="${dir}"; update_job_safe && echo safe || echo unsafe`, MAC_ENV).stdout.trim(), "unsafe");
    // current is a release with the fixed updater
    fs.rmSync(path.join(dir, "current")); fs.symlinkSync("releases/1.1.0", path.join(dir, "current"));
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr);
    assert.doesNotMatch(ok.stdout, /not turned on/);
    assert.equal(sh(MAC, `DIR="${dir}"; update_job_safe && echo safe || echo unsafe`, MAC_ENV).stdout.trim(), "safe");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("a release manifest with v 2 (a release that needs this updater) is read by the fixed scripts; any other version is refused before anything is fetched", () => {
  for (const script of [SERVER, INSTALL, MAC]) {
    const dir = tmp();
    try {
      const m = (v: number): Out => {
        fs.writeFileSync(path.join(dir, "m.json"), JSON.stringify({ v, channel: "stable" }));
        return sh(script, `TMP="${dir}"; CHANNEL=stable; UPDATE_URL=https://x.example/; WANT=""; WANT_SHA256=""; fetch(){ case "$1" in *.json) cp "${dir}/m.json" "$2" ;; *) : >"$2" ;; esac; }; verify_manifest(){ return 0; }; fetch_release`, script === MAC ? MAC_ENV : {});
      };
      for (const v of [1, 2]) {
        const r = m(v);
        assert.notEqual(r.status, 0);
        assert.doesNotMatch(r.stderr, /not a version this installer reads/, `${script} reads v ${v}`);
        assert.match(r.stderr, /no server version/, "and goes on to the next check");
      }
      assert.match(m(3).stderr, /not a version this installer reads; nothing was installed\./, `${script} refuses v 3`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
test("doctor names a server that holds on a damaged database, with the file and the restore command, and reports damaged data a restore set aside (never deleting it)", async () => {
  const dir = tmp();
  const srv = await holdingServer();
  try {
    mkSpace(dir, "D");
    releases(dir);
    fs.mkdirSync(path.join(dir, "data", "space.damaged-20261112T010000Z"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "space.damaged-20261112T010000Z", "modules.db"), Buffer.alloc(3 * 1024 * 1024));
    const r = sh(SERVER, `DATA_DIR="${dir}/data"; cmd_doctor`, { ...world(dir, { running: true, ...SAME }), VYRE_TEST_HEALTH_URL: srv.url, VYRE_TEST_DOCKER_ROOT: "", VYRE_TEST_USERNS_PROC: path.join(dir, "none"), VYRE_TEST_PROC_MOUNTS: "/nonexistent" });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout, /^DOWN host\.healthz +vyred is holding, not serving: modules\.db is damaged \(database disk image is malformed\), so the Space cannot start\. .*vyre-server restore <backup file> --yes Backups are in \S+\/backups\./m, r.stdout);
    assert.match(r.stdout, new RegExp(`^warn host\\.damaged_data +1 folder\\(s\\) of damaged data that a restore set aside are still here \\(3 MB\\)\\. Nothing uses them\\. Once the Space works, delete them: rm -rf ${esc(path.join(dir, "data", "space.damaged-20261112T010000Z"))}$`, "m"));
    assert.ok(fs.existsSync(path.join(dir, "data", "space.damaged-20261112T010000Z")), "doctor never deletes it");
  } finally { srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
