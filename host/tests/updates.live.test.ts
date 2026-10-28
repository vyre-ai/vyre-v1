// P-L7b_17: the updates module is live on a booted daemon. The host registers the release key, feed and installer through hostSeams.configureUpdates (host/src/seams/updates.ts); a
// person with server.update checks for an update over HTTP and the signed manifest is verified with the compiled-in kind of key. The feed network and the vyre-server command are faked
// (the test passes its own driver under the same setter name, which is how a test replaces a built-in); everything between them is the real module, pipeline and gateway.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { createUpdatesHost, githubFeedBase } from "../src/seams/updates.ts";
import type { FeedFetch, RunCommand } from "../src/seams/updates.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const PREFIX = "vyre-release-sums\n";

const pair = crypto.generateKeyPairSync("ed25519");
const PUB_HEX = Buffer.from(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");
const sign = (manifest: string): string => crypto.sign(null, Buffer.from(PREFIX + manifest), pair.privateKey).toString("base64");

const manifest = (channel: string, version: string): string =>
  JSON.stringify({ v: 1, channel, server: { version, tarball: "vyre.tgz", sha256: "a".repeat(64), notes: "Faster sync" }, apps: { mac: "1.0.0" } });

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-updates-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

interface Feed { urls: string[]; tamper: boolean }

async function boot(dir: string, feed: Feed, key = PUB_HEX, runOverride?: RunCommand): Promise<Daemon> {
  const fetchFeed: FeedFetch = async (url) => {
    feed.urls.push(url);
    const channel = /\/(stable|beta|nightly)\.json(\.sig)?$/.exec(url)?.[1] ?? "stable";
    const m = manifest(channel, "1.1.0");
    const body = url.endsWith(".sig") ? sign(feed.tamper ? m.replace("1.1.0", "9.9.9") : m) : m;
    return { status: 200, text: async () => body };
  };
  const run: RunCommand = runOverride ?? (async (argv) => (argv[1] === "version" ? { code: 0, stdout: "1.0.0\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }));
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "updates-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    seams: { drivers: { configureUpdates: () => createUpdatesHost({ releaseKeyHex: key, fetch: fetchFeed, run, readText: () => null }) } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("updates live: the daemon wires configureUpdates, reports the running version, finds a newer signed release on the feed, and reads it back", async () => {
  const feed: Feed = { urls: [], tamper: false };
  const d = await boot(seededDir(), feed);
  try {
    assert.ok(d.seams?.wired.includes("configureUpdates"), "configureUpdates is wired by the generic loader and daemon");
    assert.deepEqual(d.seams?.missing, [], "no module is left without its driver");

    const before = await call(d, "updates.status", {});
    assert.equal(before.status, 200, JSON.stringify(before.data));
    assert.equal(before.data.current, "1.0.0");
    assert.equal(before.data.channel, "stable");
    assert.equal(before.data.available, undefined);

    const checked = await call(d, "updates.check", {});
    assert.equal(checked.status, 200, JSON.stringify(checked.data));
    assert.equal(checked.data.available, "1.1.0");
    assert.deepEqual(feed.urls, ["https://github.com/vyre-ai/vyre-v1/releases/latest/download/stable.json", "https://github.com/vyre-ai/vyre-v1/releases/latest/download/stable.json.sig"]);

    const after = await call(d, "updates.status", {});
    assert.equal(after.data.available, "1.1.0", "the finding is kept");

    assert.equal((await call(d, "updates.channel_set", { channel: "beta" })).status, 200);
    feed.urls.length = 0;
    const beta = await call(d, "updates.check", {});
    assert.equal(beta.status, 200, JSON.stringify(beta.data));
    assert.ok(feed.urls[0]?.startsWith("https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/beta.json"), "beta is read from its rolling release");
  } finally { await d.stop(); }
});

test("updates live: a manifest whose signature does not match the release key is refused and nothing is recorded as available", async () => {
  const feed: Feed = { urls: [], tamper: true };
  const d = await boot(seededDir(), feed);
  try {
    const r = await call(d, "updates.check", {});
    assert.notEqual(r.status, 200);
    assert.match(JSON.stringify(r.data), /signature/i);
    assert.equal((await call(d, "updates.status", {})).data.available, undefined);
  } finally { await d.stop(); }
});

test("updates live: a build with no release key cannot read any feed", async () => {
  const d = await boot(seededDir(), { urls: [], tamper: false }, "");
  try {
    const r = await call(d, "updates.check", {});
    assert.notEqual(r.status, 200);
    assert.match(JSON.stringify(r.data), /release feed could not be reached/i);
  } finally { await d.stop(); }
});

test("updates seam: the feed address, the installer through vyre-server, and the release kept to go back to", async () => {
  assert.equal(githubFeedBase("stable"), "https://github.com/vyre-ai/vyre-v1/releases/latest/download/");
  assert.equal(githubFeedBase("nightly"), "https://github.com/vyre-ai/vyre-v1/releases/download/channel-nightly/");
  const ran: string[][] = [];
  let version = "1.0.0";
  const run: RunCommand = async (argv) => {
    ran.push([...argv]);
    if (argv[1] === "version") return { code: 0, stdout: `${version}\n`, stderr: "" };
    if (argv[1] === "update") { version = "1.1.0"; return { code: 0, stdout: "", stderr: "" }; }
    if (argv[1] === "doctor") return { code: 0, stdout: "", stderr: "" };
    if (argv[1] === "rollback") { version = "1.0.0"; return { code: 0, stdout: "", stderr: "" }; }
    return { code: 1, stdout: "", stderr: "unknown" };
  };
  const h = createUpdatesHost({ releaseKeyHex: PUB_HEX, run, readText: (f) => (f.endsWith("/previous") ? "releases/1.0.0\n" : null), dir: "/srv/vyre" });
  assert.equal(h.releaseKey.length, 32);
  assert.equal(await h.installer.current(), "1.0.0");
  assert.deepEqual(await h.installer.previous(), ["1.0.0"]);
  await h.installer.install({ version: "1.1.0", tarball: "vyre.tgz", sha256: "a".repeat(64) }, "beta");
  assert.deepEqual(ran.find((a) => a[1] === "update"), ["vyre-server", "update", "--yes", "--channel", "beta", "--version", "1.1.0", "--sha256", "a".repeat(64), "--feed-base", githubFeedBase("beta")]);
  assert.equal(await h.installer.healthy(), true);
  await assert.rejects(h.installer.switchTo("0.9.0"), /not the release kept/);
  await h.installer.switchTo("1.0.0");
  assert.equal(version, "1.0.0");
  await assert.rejects(h.installer.install({ version: "2.0.0", tarball: "vyre.tgz", sha256: "a".repeat(64) }), /installed 1\.1\.0, not 2\.0\.0|installed 1\.0\.0/);
});


test("updates HTTP applies exactly the reviewed beta release through pinned installer arguments", async () => {
  const dir=seededDir(),feed:Feed={urls:[],tamper:false};let version='1.0.0';const commands:string[][]=[];
  const run:RunCommand=async argv=>{
    commands.push([...argv]);
    if(argv[1]==='version')return{code:0,stdout:version,stderr:''};
    if(argv[1]==='update'){assert.equal(argv[argv.indexOf('--channel')+1],'beta');assert.equal(argv[argv.indexOf('--version')+1],'1.1.0');assert.equal(argv[argv.indexOf('--sha256')+1],'a'.repeat(64));assert.equal(argv[argv.indexOf('--feed-base')+1],githubFeedBase('beta'));version='1.1.0';return{code:0,stdout:'',stderr:''};}
    if(argv[1]==='doctor')return{code:0,stdout:'',stderr:''};
    return{code:1,stdout:'',stderr:'fixture unsupported command'};
  };
  const d=await boot(dir,feed,PUB_HEX,run);
  try{
    assert.equal((await call(d,'backup.config_set',{target:{kind:'local',path:path.join(dir,'fixture-backups')},schedule:'0 3 * * *',enabled:false})).status,200);
    assert.equal((await call(d,'updates.channel_set',{channel:'beta'})).status,200);
    const applied=await call(d,'updates.apply',{to:'1.1.0'});assert.equal(applied.status,200,JSON.stringify(applied));
    assert.ok(commands.some(argv=>argv[1]==='update'));const status=await call(d,'updates.status',{});assert.equal(status.data.current,'1.1.0');assert.equal(status.data.lastResult,'ok');
  }finally{await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
