// @heavy docker
// A browser profile at rest on a real Docker host (ARCH 6.6, V1-SPEC 2.7): an agent computer's profile disk and an agent's Chrome folder in the Space browser. Every check looks at the real volume with
// `docker run find` or `docker exec ls`, and at the real sealed bytes on the host's disk:
//   - while a computer sleeps its volume is empty and the sealed file holds neither a planted string nor a file name; the wake puts every byte back
//   - a sealed file that was changed does not open: the computer is not started, and the sealed data is not touched
//   - a computer killed while awake leaves a plain profile; the next boot seals it (with the newer state) before the computer can start
//   - a computer made before sealing existed keeps its sign-ins (its plain volume is adopted at the next wake and sealed at the next sleep), and one that was asleep through the update is sealed at boot
//   - a computer that never had a profile still wakes and sleeps
//   - a profile of about 300 MB of small and large files is sealed and unsealed; the times are printed (SEAL-TIMES) and are not asserted
//   - the Space browser: a real Chromium signs in to a local site, the idle browser stops, the profile is sealed and gone from the volume, and the next tool call finds the same sign-in
//
// Runs only with VYRE_HEAVY_DOCKER=1. Without it every test here is skipped with its reason; a skip is never a pass of the real thing. With it on, nothing is skipped.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDockerApi, DEFAULT_IMAGE, unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { tarFiles } from "../../../sandbox/src/tar.ts";
import { createDockerComputerHost, FILES_GUEST } from "../impl.ts";
import { createProfileSeal } from "../handlers/seal.ts";
import { createDockerSpaceBrowser } from "../sbrowser/docker.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts containers)";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = `vyre-comp-sl${suffix}-`;
const http = unixSocketHttp();
const api = createDockerApi(http);
const KEY = new Uint8Array(32).fill(5);
const sealDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-seal-heavy-"));
const filesRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-seal-files-")));
const USER = { uid: 10001, gid: 10001 };
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const MARKER = "PROFILE-MARKER-4f9a21";
const CTL = `${FILES_GUEST}/.agentd-ctl`;
const CTL_SCRIPT = `#!/bin/sh\ncase "$1" in\n  status) printf '{"tabs":1,"busy":false,"lastFrameAt":1}';;\n  configure) printf '{}';;\n  sessions) printf '{"sessions":[]}';;\n  *) printf '{}';;\nesac\n`;

function sh(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}
const nameOf = (id: string): string => `${PREFIX}${id.replace(/^cmt_/, "")}`;
const newHost = (sealed: boolean) => createDockerComputerHost({
  api, http, image: DEFAULT_IMAGE, cmd: ["sleep", "infinity"], prefix: PREFIX, ctl: CTL, filesRoot: () => filesRoot, startTimeoutMs: 40_000, user: USER,
  ...(sealed ? { profileSeal: { key: () => KEY, dir: sealDir } } : {}),
});
const seals = () => createProfileSeal({ http, key: () => KEY, dir: sealDir, container: nameOf, image: DEFAULT_IMAGE, user: USER });
const sealedFile = (id: string): string => path.join(sealDir, `${id}.profile`);
const inVolume = async (id: string): Promise<string> => (await sh("docker", ["run", "--rm", "--network", "none", "--entrypoint", "find", "-v", `${nameOf(id)}-profile:/p:ro`, DEFAULT_IMAGE, "/p", "-mindepth", "1"], 120_000)).out.trim();
const execIn = (id: string, script: string) => api.exec(nameOf(id), { cmd: ["sh", "-c", script], env: [], user: "10001:10001" });

async function wake(host: ReturnType<typeof newHost>, id: string, agentId = "agt_seal"): Promise<number> {
  const t0 = Date.now();
  const starting = host.start({ computerId: id, agentId, tabLimit: 4 });
  // the stand-in for agentd's control program goes in as soon as the container runs, as in lifecycle.heavy.test.ts
  for (let i = 0; i < 300 && !(await api.containerRunning(nameOf(id))); i++) await sleepMs(100);
  await api.putArchive(nameOf(id), FILES_GUEST, tarFiles([{ path: ".agentd-ctl", data: new TextEncoder().encode(CTL_SCRIPT), mode: 0o755, uid: 10001, gid: 10001, mtime: Math.floor(Date.now() / 1000) }]));
  await starting;
  return Date.now() - t0;
}
const sleepIt = async (host: ReturnType<typeof newHost>, id: string, agentId = "agt_seal"): Promise<number> => { const t0 = Date.now(); await host.stop({ computerId: id, agentId, reason: "sleep" }); return Date.now() - t0; };
// The stand-in image (person-sandbox) has no profile folder of its own, so a new volume starts root-owned; it is handed to the computer's user here, as the real image's own folder is.
const make = async (host: ReturnType<typeof newHost>, id: string, agentId = "agt_seal"): Promise<void> => {
  await host.create({ computerId: id, agentId, tabLimit: 4 });
  const own = await sh("docker", ["run", "--rm", "--network", "none", "--user", "0", "--entrypoint", "chown", "-v", `${nameOf(id)}-profile:/p`, DEFAULT_IMAGE, "10001:10001", "/p"], 60_000);
  assert.equal(own.code, 0, own.out);
};

before(async () => {
  if (!ON) return;
  assert.equal(await api.ping(), true, "the Docker daemon answers");
  assert.equal(await api.imageExists(DEFAULT_IMAGE), true, `the image ${DEFAULT_IMAGE} is on this runner`);
  fs.chmodSync(filesRoot, 0o777);
});

after(async () => {
  if (!ON) return;
  const list = await http({ method: "GET", path: "/containers/json", query: { all: "true", filters: JSON.stringify({ name: [PREFIX] }) } });
  for (const c of JSON.parse(new TextDecoder().decode(list.body)) as Array<{ Id: string }>) { await api.exec(c.Id, { cmd: ["sh", "-c", `rm -rf ${FILES_GUEST}/.agentd-ctl`], env: [] }).catch(() => undefined); await api.containerRemove(c.Id); }
  const vols = await http({ method: "GET", path: "/volumes", query: { filters: JSON.stringify({ name: [PREFIX] }) } });
  for (const v of (JSON.parse(new TextDecoder().decode(vols.body)) as { Volumes?: Array<{ Name: string }> }).Volumes ?? []) await http({ method: "DELETE", path: `/volumes/${v.Name}`, query: { force: "true" } });
  fs.rmSync(sealDir, { recursive: true, force: true });
  try { fs.rmSync(filesRoot, { recursive: true, force: true }); } catch { /* a leftover temp folder is not a failure */ }
});

test("@heavy seal: a sleeping computer's volume is empty and its sealed file holds nothing readable; a wake puts everything back; a changed file does not open", { skip, timeout: 600_000 }, async () => {
  const host = newHost(true);
  const id = "cmt_00000000-aaaa-4000-8000-000000000001";
  await make(host, id);
  await wake(host, id);
  const planted0 = await execIn(id, `mkdir -p /home/agent/.profile-disk/chrome/Default && printf '${MARKER}' > /home/agent/.profile-disk/chrome/Default/Cookies && printf 'user=dana pw=${MARKER}' > '/home/agent/.profile-disk/chrome/Default/Login Data'`);
  assert.equal(planted0.exitCode, 0, `planting the profile failed: ${planted0.stderr}`);
  await sleepIt(host, id);
  assert.equal(await inVolume(id), "", "the profile volume is empty while the computer sleeps");
  const file = sealedFile(id);
  const blob = fs.readFileSync(file);
  assert.ok(blob.length > 0, "the sealed profile is on disk");
  for (const needle of [MARKER, "Cookies", "Login Data", "chrome/Default"]) assert.ok(!blob.includes(needle), `the sealed bytes do not contain ${needle}`);
  assert.equal(fs.statSync(file).mode & 0o077, 0, "the sealed file is private to the daemon's user");
  // a changed sealed file: the wake fails with a clear reason, nothing starts, and the file is not touched
  const flipped = Buffer.from(blob); const mid = Math.floor(flipped.length / 2); flipped[mid] = flipped[mid] === 65 ? 66 : 65;
  fs.writeFileSync(file, flipped, { mode: 0o600 });
  await assert.rejects(host.start({ computerId: id, agentId: "agt_seal", tabLimit: 4 }), /sealed profile did not open/);
  assert.equal(await api.containerRunning(nameOf(id)), false, "no container was started with a half profile");
  assert.equal(await inVolume(id), "");
  assert.ok(fs.readFileSync(file).equals(flipped), "the sealed data was left as it was");
  fs.writeFileSync(file, blob, { mode: 0o600 });
  await wake(host, id);
  assert.equal((await execIn(id, "cat /home/agent/.profile-disk/chrome/Default/Cookies")).stdout.trim(), MARKER, "the wake puts the profile back");
  assert.equal((await execIn(id, "cat '/home/agent/.profile-disk/chrome/Default/Login Data'")).stdout.trim(), `user=dana pw=${MARKER}`);
  // a wrong key: not even the first byte is put back
  await sleepIt(host, id);
  const second = fs.readFileSync(file);
  const other = createDockerComputerHost({ api, http, image: DEFAULT_IMAGE, cmd: ["sleep", "infinity"], prefix: PREFIX, ctl: CTL, filesRoot: () => filesRoot, startTimeoutMs: 40_000, user: USER, profileSeal: { key: () => new Uint8Array(32).fill(6), dir: sealDir } });
  await assert.rejects(other.start({ computerId: id, agentId: "agt_seal", tabLimit: 4 }), /sealed profile did not open/);
  assert.equal(await inVolume(id), "");
  assert.ok(fs.readFileSync(file).equals(second), "the sealed file is intact after a wrong key");
  await host.remove(id);
  assert.equal(fs.existsSync(file), false, "removing the computer removes its sealed profile");
});

test("@heavy seal: a computer killed while awake is sealed at the next boot with its newest state, before it can start; one that never had a profile still wakes and sleeps", { skip, timeout: 600_000 }, async () => {
  const host = newHost(true);
  const id = "cmt_00000000-aaaa-4000-8000-000000000002";
  await make(host, id);
  await wake(host, id);
  await execIn(id, `mkdir -p /home/agent/.profile-disk/chrome && printf 'first' > /home/agent/.profile-disk/chrome/Cookies`);
  await sleepIt(host, id);
  await wake(host, id);
  await execIn(id, `printf 'newest-${MARKER}' > /home/agent/.profile-disk/chrome/Cookies`);
  const killed = await sh("docker", ["kill", nameOf(id)], 30_000);
  assert.equal(killed.code, 0, killed.out);
  assert.notEqual(await inVolume(id), "", "the crash left the plain profile on the volume");
  const before = fs.statSync(sealedFile(id)).mtimeMs;
  const boot = newHost(true);
  assert.deepEqual(await boot.recover(), [id]);
  assert.equal(await inVolume(id), "", "the boot sealed what the crash left");
  assert.ok(fs.statSync(sealedFile(id)).mtimeMs > before && !fs.readFileSync(sealedFile(id)).includes(MARKER), "rewritten with the newest state, and holds no plain text");
  await wake(boot, id);
  assert.equal((await execIn(id, "cat /home/agent/.profile-disk/chrome/Cookies")).stdout.trim(), `newest-${MARKER}`, "the newest state came back");
  await sleepIt(boot, id);
  await boot.remove(id);

  // a computer that never had a profile
  const fresh = "cmt_00000000-aaaa-4000-8000-000000000003";
  await make(boot, fresh);
  await wake(boot, fresh);
  await sleepIt(boot, fresh);
  await wake(boot, fresh);
  assert.equal(await api.containerRunning(nameOf(fresh)), true, "it wakes");
  await sleepIt(boot, fresh);
  assert.equal(await inVolume(fresh), "");
  await boot.remove(fresh);
});

test("@heavy seal: a computer made before sealing existed keeps its sign-ins, and one asleep through the update is sealed at boot", { skip, timeout: 600_000 }, async () => {
  const old = newHost(false);
  const awake = "cmt_00000000-aaaa-4000-8000-000000000004";
  const asleep = "cmt_00000000-aaaa-4000-8000-000000000005";
  for (const id of [awake, asleep]) {
    await make(old, id);
    await wake(old, id);
    await execIn(id, `mkdir -p /home/agent/.profile-disk/chrome/Default && printf 'signed-in-${MARKER}' > /home/agent/.profile-disk/chrome/Default/Cookies`);
    await sleepIt(old, id);
  }
  assert.notEqual(await inVolume(awake), "", "before the update the profile sits plain on the volume");
  assert.equal(fs.existsSync(sealedFile(awake)), false);
  const upgraded = newHost(true);
  assert.deepEqual((await upgraded.recover()).sort(), [awake, asleep].sort(), "both stopped computers are sealed at the first boot");
  assert.equal(await inVolume(asleep), "");
  assert.ok(!fs.readFileSync(sealedFile(asleep)).includes(MARKER));
  await wake(upgraded, asleep);
  assert.equal((await execIn(asleep, "cat /home/agent/.profile-disk/chrome/Default/Cookies")).stdout.trim(), `signed-in-${MARKER}`, "the sign-in survived the migration");
  await sleepIt(upgraded, asleep);
  // the other path: the plain volume is adopted at the wake and sealed at the next sleep (no boot in between)
  const third = "cmt_00000000-aaaa-4000-8000-000000000006";
  await make(old, third); await wake(old, third);
  await execIn(third, `mkdir -p /home/agent/.profile-disk/chrome && printf 'keep-${MARKER}' > /home/agent/.profile-disk/chrome/Cookies`);
  await sleepIt(old, third);
  await wake(upgraded, third);
  assert.equal((await execIn(third, "cat /home/agent/.profile-disk/chrome/Cookies")).stdout.trim(), `keep-${MARKER}`);
  await sleepIt(upgraded, third);
  assert.equal(await inVolume(third), "");
  assert.ok(fs.existsSync(sealedFile(third)));
  for (const id of [awake, asleep, third]) await upgraded.remove(id);
});

test("@heavy seal: a profile of about 300 MB of small and large files is sealed and unsealed, and the times are reported", { skip, timeout: 900_000 }, async () => {
  const host = newHost(true);
  const id = "cmt_00000000-aaaa-4000-8000-000000000007";
  await make(host, id);
  await wake(host, id);
  // 8,000 small files (about 4 KB each) and nine large ones (30 MB each): incompressible, like a cache and a history database
  const made = await execIn(id, `d=/home/agent/.profile-disk/chrome; mkdir -p $d/Default/Cache $d/Default/Big; i=0; while [ $i -lt 8000 ]; do head -c 4096 /dev/urandom > $d/Default/Cache/f$i; i=$((i+1)); done; i=0; while [ $i -lt 9 ]; do head -c 31457280 /dev/urandom > $d/Default/Big/b$i; i=$((i+1)); done; printf '${MARKER}' > $d/Default/Cookies; du -sm $d | cut -f1`);
  assert.equal(made.exitCode, 0, made.stderr);
  const mb = Number(made.stdout.trim().split("\n").pop());
  assert.ok(mb >= 280, `the profile is about 300 MB (${mb} MB)`);
  const before = (await execIn(id, "cd /home/agent/.profile-disk && find . -type f | wc -l; find . -type f -exec cksum {} + | sort | cksum")).stdout.trim();
  const sleepMsTotal = await sleepIt(host, id);                 // container stop + seal
  assert.equal(await inVolume(id), "");
  const size = fs.statSync(sealedFile(id)).size;
  // the seal and the unseal alone, on the stopped container
  const s = seals();
  const t0 = Date.now(); await s.unseal(id); const unsealMs = Date.now() - t0;
  const t1 = Date.now(); await s.seal(id); const sealMs = Date.now() - t1;
  const wakeMs = await wake(host, id);                          // unseal + container start + agentd
  const after = (await execIn(id, "cd /home/agent/.profile-disk && find . -type f | wc -l; find . -type f -exec cksum {} + | sort | cksum")).stdout.trim();
  assert.equal(after, before, "every file came back with the same bytes");
  // the same wake without sealing, for the difference
  const plainHost = newHost(false);
  const plainId = "cmt_00000000-aaaa-4000-8000-000000000008";
  await make(plainHost, plainId);
  const tp = await wake(plainHost, plainId); await sleepIt(plainHost, plainId);
  const tp2 = await wake(plainHost, plainId);
  console.log(`SEAL-TIMES profile=${mb}MB files=${before.split("\n")[0]} sealed=${Math.round(size / 1e6)}MB seal=${sealMs}ms unseal=${unsealMs}ms sleep(stop+seal)=${sleepMsTotal}ms wake(unseal+start)=${wakeMs}ms plain-wake(empty profile)=${tp2}ms first-plain-wake=${tp}ms`);
  await sleepIt(host, id);
  await host.remove(id);
  await newHost(false).remove(plainId);
});

// ---- the Space browser ----------------------------------------------------------------------------------------------------------------------------

const IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"] ?? "vyre/space-browser:heavy";
const NAME = `vyre-sbrowser-sl${suffix}`;
let site: Server;
let sitePort = 0;
let GATEWAY = "172.17.0.1";
const page = (res: ServerResponse, body: string, headers: Record<string, string | string[]> = {}): void => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers }); res.end(`<!doctype html><meta charset=utf-8><title>site</title><body>${body}</body>`); };

test("@heavy seal: the Space browser seals an idle agent's profile and a real Chromium finds its sign-in again; a profile killed while plain is sealed at boot", { skip, timeout: 1_500_000 }, async () => {
  const gw = await sh("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"], 20_000);
  if (gw.code === 0 && /^\d+\.\d+\.\d+\.\d+/.test(gw.out.trim())) GATEWAY = gw.out.trim().split("\n")[0]!;
  const ext = process.env["VYRE_CHROME_EXT_DIR"] ?? path.join(ROOT, "apps/chrome");
  const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), `sbrowser-ctx-${suffix}-`));
  fs.cpSync(path.join(ROOT, "images/agent-computer"), path.join(ctxDir, "agent-computer"), { recursive: true });
  fs.cpSync(path.join(ROOT, "images/space-browser"), path.join(ctxDir, "space-browser"), { recursive: true });
  const vendor = path.join(ctxDir, "space-browser/browserd/vendor/chrome-bridge.ts");
  fs.rmSync(vendor, { force: true });
  fs.copyFileSync(path.join(ROOT, "lib/chrome-bridge.ts"), vendor);
  fs.cpSync(ext, path.join(ctxDir, "agent-computer/vyre-chrome"), { recursive: true, filter: (s) => !/\/(tests|node_modules)(\/|$)/.test(s) });
  const built = await sh("docker", ["build", "-f", path.join(ctxDir, "space-browser/Dockerfile"), "-t", IMAGE, ctxDir], 1_200_000);
  fs.rmSync(ctxDir, { recursive: true, force: true });
  assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  site = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/set") page(res, "<p>set</p>", { "set-cookie": [`sid=${MARKER}; Path=/; Max-Age=3600`] });
    else if (url.pathname === "/whoami") page(res, `<p id=out>cookie:[${req.headers.cookie ?? ""}]</p>`);
    else res.writeHead(404).end("no");
  });
  await new Promise<void>((r) => site.listen(0, "0.0.0.0", () => r()));
  sitePort = (site.address() as { port: number }).port;
  const url = (p: string): string => `http://${GATEWAY}:${sitePort}${p}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sbseal-"));
  const make = (key = KEY) => createDockerSpaceBrowser({ api, http, name: NAME, image: IMAGE, user: USER, idleMinutes: 0.05, sweepSeconds: 2, startTimeoutMs: 90_000, profileSeal: { key: () => key, dir }, sealSweepMs: 0, sealQuietMs: 1_000 });
  const sb = make();
  const run = (id: string, name: string, args: Record<string, unknown> = {}) => sb.tool({ profileId: id, tool: name, args, timeoutMs: 30_000 });
  const lsChrome = async (id: string): Promise<string> => (await api.exec(NAME, { cmd: ["sh", "-c", `ls -A /data/profiles/${id}/chrome 2>/dev/null | head -3`], env: [] })).stdout.trim();
  try {
    await run("agt_sealed", "chrome_open", { url: url("/set") });
    await run("agt_sealed", "chrome_open", { url: url("/whoami") });
    assert.match(String((await run("agt_sealed", "chrome_eval", { expression: "document.body.innerText" }))["result"]), new RegExp(`sid=${MARKER}`), "signed in");
    // pad the Chrome folder to about 300 MB, like a profile that has been used for a while
    const pad = await api.exec(NAME, { cmd: ["sh", "-c", "d=/data/profiles/agt_sealed/chrome/Default/Pad; mkdir -p $d; i=0; while [ $i -lt 9 ]; do head -c 31457280 /dev/urandom > $d/b$i; i=$((i+1)); done; i=0; mkdir -p $d/s; while [ $i -lt 6000 ]; do head -c 4096 /dev/urandom > $d/s/f$i; i=$((i+1)); done"], env: [], user: "10001:10001" });
    assert.equal(pad.exitCode, 0, pad.stderr);
    // the idle stop closes the browser (3 s of quiet, looked at every 2 s), then the profile is sealed
    let stopped = false;
    for (let i = 0; i < 60 && !stopped; i++) { await sleepMs(1000); stopped = (await sb.profiles()).profiles.find((x) => x.profileId === "agt_sealed")?.running === false; }
    assert.ok(stopped, "the browser stopped after idle");
    await sleepMs(1500);
    const t0 = Date.now();
    assert.deepEqual(await sb.sweep(), ["agt_sealed"]);
    const sealMs = Date.now() - t0;
    assert.equal(await lsChrome("agt_sealed"), "", "the Chrome folder is gone from the volume");
    const file = path.join(dir, "browser", "agt_sealed.profile");
    const blob = fs.readFileSync(file);
    for (const needle of [MARKER, "Cookies", "Login Data", "sid="]) assert.ok(!blob.includes(needle), `the sealed bytes do not contain ${needle}`);
    // the next tool call finds the same sign-in
    const t1 = Date.now();
    await run("agt_sealed", "chrome_open", { url: url("/whoami") });
    const wakeMs = Date.now() - t1;
    assert.match(String((await run("agt_sealed", "chrome_eval", { expression: "document.body.innerText" }))["result"]), new RegExp(`cookie:\\[sid=${MARKER}\\]`), "the sign-in came back from the sealed profile");
    console.log(`SEAL-TIMES browser sealed=${Math.round(blob.length / 1e6)}MB seal=${sealMs}ms first-tool-after-seal(unseal+browser start+open)=${wakeMs}ms`);
    // a wrong key does not open it and does not start a browser on an empty folder
    await sb.stop("agt_sealed");
    assert.equal(await lsChrome("agt_sealed"), "", "an explicit stop seals at once");
    const other = make(new Uint8Array(32).fill(8));
    await assert.rejects(other.tool({ profileId: "agt_sealed", tool: "chrome_state", args: {}, timeoutMs: 30_000 }), /did not open/);
    assert.equal(await lsChrome("agt_sealed"), "");
    // killed while plain: the container dies, a new daemon boots, the profile is sealed before any call is served
    await run("agt_sealed", "chrome_open", { url: url("/whoami") });
    assert.notEqual(await lsChrome("agt_sealed"), "");
    assert.equal((await sh("docker", ["kill", NAME], 30_000)).code, 0);
    assert.equal((await sh("docker", ["start", NAME], 30_000)).code, 0);
    for (let i = 0; i < 60; i++) { if ((await api.exec(NAME, { cmd: ["/opt/browserd/ctl", "status", "{}"], env: [] }).catch(() => ({ exitCode: 1 }))).exitCode === 0) break; await sleepMs(500); }
    const boot = make();
    assert.deepEqual(await boot.recover(), ["agt_sealed"]);
    assert.equal(await lsChrome("agt_sealed"), "", "sealed at boot");
    await boot.tool({ profileId: "agt_sealed", tool: "chrome_open", args: { url: url("/whoami") }, timeoutMs: 30_000 });
    assert.match(String((await boot.tool({ profileId: "agt_sealed", tool: "chrome_eval", args: { expression: "document.body.innerText" }, timeoutMs: 30_000 }))["result"]), new RegExp(`sid=${MARKER}`));
  } finally {
    await api.containerStop(NAME, 5).catch(() => undefined);
    await api.containerRemove(NAME).catch(() => undefined);
    await http({ method: "DELETE", path: `/volumes/${NAME}-data`, query: { force: "true" } }).catch(() => undefined);
    site?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
