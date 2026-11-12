// The Space browser's pieces of vyre-server (lane f-sbrowser), in a file of their own so install.test.ts and install.release.test.ts stay under the fast runner's 30 s cap: the cloud metadata block and `vyre-server stop` stopping the Space browser.
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

test("ensure_metadata_block keeps containers from the cloud metadata address but lets DNS to it pass, in order, once; skips a Mac; says why when it cannot; doctor reads the rules back", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    const shim = path.join(dir, "shim"); fs.mkdirSync(shim);
    const rules = (t: string): string => path.join(dir, `rules-${t}`);
    // a fake iptables and ip6tables keeping DOCKER-USER as an ordered file: -L succeeds when the chain file exists, -C FORWARD -j DOCKER-USER when the jump file exists, -C finds a rule, -I N inserts it at
    // line N, -D removes it once
    for (const t of ["iptables", "ip6tables"]) {
      fs.writeFileSync(path.join(shim, t), `#!/bin/sh
echo "${t} $*" >> "${dir}/calls"
shift; act=$1; shift; chain=$1; shift
[ -f "${dir}/chain-${t}" ] || exit 1
f="${rules(t)}"; touch "$f"
if [ "$chain" = FORWARD ]; then [ -f "${dir}/jump-${t}" ]; exit $?; fi
pos=""; case "$1" in [0-9]*) pos=$1; shift ;; esac
rule="$*"
case "$act" in
  -L) exit 0 ;;
  -C) grep -qxF -- "$rule" "$f" ;;
  -I) n=\${pos:-1}; awk -v n="$n" -v r="$rule" 'NR==n{print r} {print} END{if(NR<n)print r}' "$f" > "$f.new"; mv "$f.new" "$f" ;;
  -D) grep -qxF -- "$rule" "$f" || exit 1; awk -v r="$rule" '!d && $0==r {d=1; next} {print}' "$f" > "$f.new"; mv "$f.new" "$f" ;;
esac
`, { mode: 0o755 });
    }
    const env = { VYRE_DIR: dir, VYRE_TEST_METADATA: "1", PATH: `${shim}:${process.env.PATH ?? ""}` };
    // without the test's own opt-in, a test run never reaches the real firewall (the other tests run start and update as root on the box)
    assert.equal(sh(SERVER, "meta_state", { ...env, VYRE_TEST_METADATA: "0" }).stdout, "skip");
    const state = (o: Record<string, string> = {}): string => sh(SERVER, "meta_state", { ...env, ...o }).stdout;
    const finding = (): string => sh(SERVER, 'FINDINGS=""; DOWN=0; check_all >/dev/null 2>&1; printf "%s" "$FINDINGS"', env).stdout;
    // a Mac: nothing, no finding
    assert.equal(state({ VYRE_TEST_OS: "Darwin" }), "skip");
    // no DOCKER-USER chain: said, in plain words, as degraded; start says it too and changes nothing
    assert.match(state(), /^broken iptables has no DOCKER-USER chain/);
    assert.match(finding(), /host\.metadata\tdegraded\tAgents' containers may reach the cloud metadata address \(169\.254\.0\.0\/16\): iptables has no DOCKER-USER chain/);
    let r = sh(SERVER, "ensure_metadata_block", env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /may reach the cloud metadata address/);
    // the chain is there but Docker's traffic does not go through it in this tool's tables (a legacy and nft mismatch): said, never "on"
    for (const t of ["iptables", "ip6tables"]) fs.writeFileSync(path.join(dir, `chain-${t}`), "");
    assert.match(state(), /^broken the DOCKER-USER chain iptables shows is not in the path of Docker's traffic/);
    for (const t of ["iptables", "ip6tables"]) fs.writeFileSync(path.join(dir, `jump-${t}`), "");
    // Linux with the chain: off, then the rules in order: DNS passes above the drop, for both bridges; IPv6 drops the metadata address
    assert.equal(state(), "off");
    assert.match(finding(), /host\.metadata\tdegraded\t.*Fix: vyre-server start/);
    r = sh(SERVER, "ensure_metadata_block", env);
    assert.equal(r.status, 0, r.stderr);
    const v4 = read(rules("iptables")).trim().split("\n");
    assert.deepEqual(v4, [
      "-i br-+ -d 169.254.0.0/16 -p tcp --dport 53 -m comment --comment vyre-metadata -j RETURN",
      "-i br-+ -d 169.254.0.0/16 -p udp --dport 53 -m comment --comment vyre-metadata -j RETURN",
      "-i docker0 -d 169.254.0.0/16 -p tcp --dport 53 -m comment --comment vyre-metadata -j RETURN",
      "-i docker0 -d 169.254.0.0/16 -p udp --dport 53 -m comment --comment vyre-metadata -j RETURN",
      "-i br-+ -d 169.254.0.0/16 -m comment --comment vyre-metadata -j DROP",
      "-i docker0 -d 169.254.0.0/16 -m comment --comment vyre-metadata -j DROP",
    ], "every DNS pass stands above every drop");
    assert.deepEqual(read(rules("ip6tables")).trim().split("\n").sort(), ["-i br-+ -d fd00:ec2::254/128 -m comment --comment vyre-metadata -j DROP", "-i docker0 -d fd00:ec2::254/128 -m comment --comment vyre-metadata -j DROP"]);
    assert.equal(state(), "on");
    assert.match(finding(), /host\.metadata\thealthy\t.*DNS to it still passes/);
    // a second start adds nothing; an old drop-only rule set (dee49d04c) with a DNS pass missing is put back in order
    sh(SERVER, "ensure_metadata_block", env);
    assert.equal(read(rules("iptables")).trim().split("\n").length, 6);
    fs.writeFileSync(rules("iptables"), `${v4.slice(4).join("\n")}\n`);
    assert.equal(state(), "off");
    sh(SERVER, "ensure_metadata_block", env);
    assert.deepEqual(read(rules("iptables")).trim().split("\n"), v4, "repaired in order, no duplicate");
    // no ip6tables at all (third look, 12 Nov): the IPv4 rules still go in, and doctor says the IPv6 half is missing, with the reason
    fs.rmSync(path.join(shim, "ip6tables"));
    fs.writeFileSync(rules("iptables"), "");
    const noV6 = { ...env, PATH: `${shim}:/usr/bin:/bin` };
    assert.equal(sh(SERVER, "meta_state", noV6).stdout, "off", "the IPv4 half is judged on its own");
    sh(SERVER, "ensure_metadata_block", noV6);
    assert.deepEqual(read(rules("iptables")).trim().split("\n"), v4, "IPv4 blocked though there is no ip6tables");
    assert.equal(sh(SERVER, "meta_state", noV6).stdout, "on");
    assert.match(sh(SERVER, 'FINDINGS=""; DOWN=0; check_all >/dev/null 2>&1; printf "%s" "$FINDINGS"', noV6).stdout, /host\.metadata\tdegraded\t.*IPv4.*fd00:ec2::254.*there is no ip6tables/);
    // start, the update (also the daily check when there is nothing new) and the rollback all put it there
    const text = read(SERVER);
    assert.match(text, /cmd_start\(\) \{[^\n]*ensure_metadata_block; dc up/, "start (the boot unit runs it)");
    assert.match(text, /cmd_update\(\) \{\n(?:  if \[ "\$\{VYRE_UPDATE_CONTINUE:-0\}" = 1 \][^\n]*\n)?  parse_update_args "\$@"\n(?:  #[^\n]*\n)*  ensure_metadata_block\n/, "every update run, the daily check included (the child that carries an update out is started by a run that already did it)");
    assert.equal((text.match(/  ensure_metadata_block\n  refresh_bin\n  ensure_userns\n/g) ?? []).length, 2, "update and rollback");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Lead, 12 Nov: the Space browser container survives a restart of the daemon on purpose, but `vyre-server stop` (and so an uninstall, which runs it) stops it; an update does not.
test("vyre-server stop also stops the Space browser container; the update's own stop leaves it running", () => {
  const dir = tmp();
  try {
    installFixture(dir);
    const shim = path.join(dir, "shim"); fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, "docker"), `#!/bin/sh\necho "docker $*" >> "${dir}/docker.log"\n`, { mode: 0o755 });
    const r = sh(SERVER, "dc() { echo \"dc $*\" >> \"$VYRE_DIR/docker.log\"; }; cmd_stop", { VYRE_DIR: dir, PATH: `${shim}:${process.env.PATH ?? ""}` });
    assert.equal(r.status, 0, r.stderr);
    const log = read(path.join(dir, "docker.log"));
    assert.match(log, /^dc stop$/m);
    assert.match(log, /^docker stop -t 10 vyre-sbrowser$/m, "the browser container stops with the server");
    const text = read(SERVER);
    assert.ok(!/cmd_update\(\) \{[\s\S]*?\n\}/.exec(text)![0].includes("cmd_stop"), "an update stops the server with dc stop, not cmd_stop, so agents' browsers stay up through it");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
