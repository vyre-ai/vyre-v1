// engine-install.ts and engine-pins.ts: Vyre installs a missing CLI engine into a folder of its own, from the vendor's own download, checked against the pinned size and SHA-256 before it is unpacked and
// again before it is made executable. A file that does not match, a download cut short, a redirect to another host or a computer with no build leave nothing a lookup would pick up. The lookup order is a
// person's own install, then a copy an app carries, then Vyre's folder. The downloads here are served by a fake fetch; the real ones are proven on a Linux box (see the lane report).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";
import { ENGINE_PINS } from "../engine-pins.ts";
import type { EnginePin, EnginePlatform } from "../engine-pins.ts";
import { EngineInstallError, createEngineInstaller, enginePlatform, enginesRoot, installEngine, ownedProgram, ownedProgramDirs } from "../engine-install.ts";
import { findProgram, isOwned } from "../cli-programs.ts";
import { enginePath } from "../sandbox-default.ts";
import { ownedArgv } from "../session.ts";

const sha = (b: Buffer): string => crypto.createHash("sha256").update(b).digest("hex");
const zstd = (b: Buffer): Buffer => (zlib as unknown as { zstdCompressSync(b: Buffer): Buffer }).zstdCompressSync(b);
const PLATFORMS: EnginePlatform[] = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "linux-x64-musl", "linux-arm64-musl", "win32-x64", "win32-arm64"];

/** A pin for a tiny program (a shell script that prints its version), served zstd-compressed from a vendor host. */
function fakePin(program = "codex", body = "#!/bin/sh\necho \"codex-cli 0.166.0\"\n"): { pins: Record<string, EnginePin>; packed: Buffer; program: Buffer } {
  const bin = Buffer.from(body);
  const packed = zstd(bin);
  const build = { url: "https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-x86_64-unknown-linux-musl.zst", size: packed.length, sha256: sha(packed), binarySize: bin.length, binarySha256: sha(bin) };
  return { pins: { [program]: { program: program as EnginePin["program"], version: "0.166.0", hosts: ["github.com", "release-assets.githubusercontent.com"], builds: { "linux-x64": build } } }, packed, program: bin };
}

/** A fetch that answers from a table of URLs; a redirect is a 302 with a location. Records every URL it is asked for. */
function fakeFetch(table: Record<string, Buffer | { redirect: string } | { status: number } | { cut: Buffer }>): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const f = (async (input: URL | string) => {
    const url = String(input);
    asked.push(url);
    const hit = table[url];
    if (hit === undefined) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    if (Buffer.isBuffer(hit)) return new Response(new Uint8Array(hit), { status: 200 });
    if ("redirect" in hit) return new Response(null, { status: 302, headers: { location: hit.redirect } });
    if ("status" in hit) return new Response("no", { status: hit.status });
    // the first half arrives, then the connection drops
    const half = hit.cut;
    return new Response(body(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(half)); c.error(Object.assign(new TypeError("terminated"), { cause: { code: "ECONNRESET" } })); } })), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, asked };
}

/** A web stream as a Response body (Node's fetch takes one; its types name another ReadableStream). */
const body = (stream: ReadableStream<Uint8Array>): ConstructorParameters<typeof Response>[0] => stream as unknown as ConstructorParameters<typeof Response>[0];
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engines-"));
/** Everything under the engines folder, as relative paths: what a failed install must not leave. */
const tree = (root: string): string[] => (fs.existsSync(root) ? (fs.readdirSync(root, { recursive: true }) as string[]).map(String).sort() : []);

test("the pins: Claude Code, Codex and Grok at one version each, the versions the server image pinned, with a checked build for every computer Vyre runs on, from the vendor's own host", () => {
  assert.deepEqual(Object.keys(ENGINE_PINS), ["claude", "codex", "grok"]);
  assert.equal(ENGINE_PINS.claude.version, "2.1.316", "the version images/vyred pinned before");
  assert.equal(ENGINE_PINS.codex.version, "0.166.0", "the version images/vyred pinned before");
  assert.equal(ENGINE_PINS.grok.version, "1.0.70", "the Grok Build the driver's flags were checked against");
  for (const pin of Object.values(ENGINE_PINS)) {
    for (const p of PLATFORMS) {
      const b = pin.builds[p];
      assert.ok(b, `${pin.program} has a ${p} build`);
      const u = new URL(b.url);
      assert.equal(u.protocol, "https:");
      assert.ok(pin.hosts.includes(u.hostname), `${pin.program} downloads from its vendor's host, not ${u.hostname}`);
      assert.ok(b.url.includes(pin.version), `${b.url} is the pinned version`);
      assert.match(b.sha256, /^[0-9a-f]{64}$/);
      assert.match(b.binarySha256, /^[0-9a-f]{64}$/);
      assert.ok(b.size > 1_000_000 && b.binarySize > b.size, `${pin.program} ${p}: a compressed file and a larger program`);
    }
  }
  assert.equal(ENGINE_PINS.codex.builds["linux-x64-musl"], ENGINE_PINS.codex.builds["linux-x64"], "Codex's Linux build is static: one file for glibc and musl");
  assert.notEqual(ENGINE_PINS.claude.builds["linux-x64-musl"]?.sha256, ENGINE_PINS.claude.builds["linux-x64"]?.sha256, "Claude Code ships its own musl build");
});

test("the engines folder: on a Mac under the desktop app's folder in Application Support, elsewhere under the data directory; VYRE_ENGINES_DIR overrides", () => {
  assert.equal(enginesRoot({ platform: "darwin", home: "/Users/dana", env: {} }), "/Users/dana/Library/Application Support/ai.vyre.desktop/engines");
  assert.equal(enginesRoot({ platform: "linux", dataDir: "/data", env: {} }), "/data/engines");
  assert.equal(enginesRoot({ platform: "linux", env: {} }), null, "no data directory, nowhere to put them");
  assert.equal(enginesRoot({ platform: "linux", dataDir: "/data", env: { VYRE_ENGINES_DIR: "/srv/engines" } }), "/srv/engines");
  assert.equal(enginesRoot({ platform: "linux", dataDir: "/data", env: { VYRE_ENGINES_DIR: "relative" } }), "/data/engines", "only an absolute folder is taken");
  assert.equal(enginePlatform("darwin", "arm64", false), "darwin-arm64");
  assert.equal(enginePlatform("darwin", "x64", false), "darwin-x64");
  assert.equal(enginePlatform("linux", "x64", false), "linux-x64");
  assert.equal(enginePlatform("linux", "arm64", true), "linux-arm64-musl");
  assert.equal(enginePlatform("win32", "x64", false), "win32-x64");
  assert.equal(enginePlatform("win32", "arm64", false), "win32-arm64");
  assert.equal(ownedProgram("/e", "claude", "win32"), "/e/claude/2.1.316/claude.exe", "Windows runs a program named .exe");
  assert.equal(enginePlatform("linux", "ia32", false), null);
  assert.equal(ownedProgram("/e", "codex"), "/e/codex/0.166.0/codex");
  assert.equal(ownedProgram("/e", "node"), null, "only the pinned engines");
  assert.deepEqual(ownedProgramDirs("/e"), ["/e/claude/2.1.316", "/e/codex/0.166.0", "/e/grok/1.0.70"]);
});

test("an install downloads from the vendor (following its redirect), checks the file and the program against the pins, and renames the folder into place executable", async () => {
  const root = tmp();
  const f = fakePin();
  const asset = "https://release-assets.githubusercontent.com/github-production-release-asset/1/codex.zst";
  const net = fakeFetch({ [f.pins.codex!.builds["linux-x64"]!.url]: { redirect: asset }, [asset]: f.packed });
  const seen: number[] = [];
  const at = await installEngine("codex", { root, platform: "linux-x64", pins: f.pins, fetch: net.fetch, onProgress: (done) => seen.push(done) });
  assert.equal(at, path.join(root, "codex", "0.166.0", "codex"));
  assert.deepEqual(fs.readFileSync(at), f.program);
  assert.equal(fs.statSync(at).mode & 0o111, 0o111, "executable");
  assert.deepEqual(tree(root), ["codex", "codex/0.166.0", "codex/0.166.0/codex"], "only the program: no download, no hidden folder");
  assert.equal(seen.at(-1), f.packed.length, "progress reaches the whole file");
  assert.deepEqual(net.asked, [f.pins.codex!.builds["linux-x64"]!.url, asset]);
  assert.equal(execFileSync(at, ["--version"], { encoding: "utf8" }).trim(), "codex-cli 0.166.0");
  // a second install answers the program that is there, without a download
  const again = fakeFetch({});
  assert.equal(await installEngine("codex", { root, platform: "linux-x64", pins: f.pins, fetch: again.fetch }), at);
  assert.deepEqual(again.asked, []);
});

test("Windows: the pinned builds are the vendors' .exe files, and an install puts <program>.exe in place", async () => {
  for (const pin of Object.values(ENGINE_PINS)) for (const p of ["win32-x64", "win32-arm64"] as const) assert.match(pin.builds[p]?.url ?? "", /\.exe\.zst$/, `${pin.program} ${p}`);
  const root = tmp();
  const f = fakePin();
  const build = f.pins.codex!.builds["linux-x64"]!;
  const pins: Record<string, EnginePin> = { codex: { ...f.pins.codex!, builds: { "win32-x64": build } } };
  const at = await installEngine("codex", { root, platform: "win32-x64", pins, fetch: fakeFetch({ [build.url]: f.packed }).fetch });
  assert.equal(at, path.join(root, "codex", "0.166.0", "codex.exe"));
  assert.deepEqual(tree(root), ["codex", "codex/0.166.0", "codex/0.166.0/codex.exe"]);
  const installer = createEngineInstaller({ root, platform: "win32-x64", pins });
  assert.equal(installer.supported("codex"), true);
  assert.equal(installer.installed("codex"), at);
});

test("a download that is not the pinned file is refused and nothing is left: no program, no folder a lookup would find", async () => {
  const root = tmp();
  const f = fakePin();
  const url = f.pins.codex!.builds["linux-x64"]!.url;
  const evil = zstd(Buffer.from("#!/bin/sh\necho owned\n"));
  // same size, other bytes
  const tampered = Buffer.concat([evil, Buffer.alloc(Math.max(0, f.packed.length - evil.length))]).subarray(0, f.packed.length);
  await assert.rejects(installEngine("codex", { root, platform: "linux-x64", pins: f.pins, fetch: fakeFetch({ [url]: tampered }).fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "checksum");
  await assert.rejects(installEngine("codex", { root, platform: "linux-x64", pins: f.pins, fetch: fakeFetch({ [url]: Buffer.concat([f.packed, Buffer.from("x")]) }).fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "checksum", "one byte too many");
  // the file matches but the program inside does not: the pin's program hash is checked too
  const wrongInside: Record<string, EnginePin> = { codex: { ...f.pins.codex!, builds: { "linux-x64": { ...f.pins.codex!.builds["linux-x64"]!, binarySha256: "0".repeat(64) } } } };
  await assert.rejects(installEngine("codex", { root, platform: "linux-x64", pins: wrongInside, fetch: fakeFetch({ [url]: f.packed }).fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "checksum");
  assert.deepEqual(tree(root), ["codex"], "nothing but the empty program folder");
  assert.equal(findProgram("codex", { platform: "linux", env: { PATH: "/nonexistent" }, enginesRoot: root }), null);
});

test("a download cut short, an unreachable vendor, an error page or a redirect to another host leave nothing behind, each with its reason", async () => {
  const root = tmp();
  const f = fakePin();
  const url = f.pins.codex!.builds["linux-x64"]!.url;
  const o = { root, platform: "linux-x64" as const, pins: f.pins };
  await assert.rejects(installEngine("codex", { ...o, fetch: fakeFetch({ [url]: { cut: f.packed.subarray(0, Math.floor(f.packed.length / 2)) } }).fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "offline");
  await assert.rejects(installEngine("codex", { ...o, fetch: fakeFetch({}).fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "offline" && /ENOTFOUND/.test(e.message));
  await assert.rejects(installEngine("codex", { ...o, fetch: fakeFetch({ [url]: { status: 404 } }).fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "failed");
  const away = fakeFetch({ [url]: { redirect: "https://evil.example/codex.zst" }, "https://evil.example/codex.zst": f.packed });
  await assert.rejects(installEngine("codex", { ...o, fetch: away.fetch }), (e: unknown) => e instanceof EngineInstallError && /evil\.example/.test(e.message));
  assert.ok(!away.asked.includes("https://evil.example/codex.zst"), "the other host is never asked");
  await assert.rejects(installEngine("codex", { ...o, fetch: fakeFetch({ [url]: { redirect: "http://github.com/x.zst" } }).fetch }), (e: unknown) => e instanceof EngineInstallError, "plain http is refused too");
  assert.deepEqual(tree(root), ["codex"]);
  // a download that stops sending is given up on
  const slow = (async () => new Response(body(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(f.packed.subarray(0, 10))); } })), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(installEngine("codex", { ...o, fetch: slow, stallMs: 50 }), (e: unknown) => e instanceof EngineInstallError && e.reason === "offline" && /stopped sending/.test(e.message));
  assert.deepEqual(tree(root), ["codex"]);
});

test("a computer with no build is told so before anything is fetched; a hidden folder a crash left is swept, and an older version is pruned after an install", async () => {
  const root = tmp();
  const f = fakePin();
  const net = fakeFetch({});
  await assert.rejects(installEngine("codex", { root, platform: "darwin-arm64", pins: f.pins, fetch: net.fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "unsupported");
  await assert.rejects(installEngine("codex", { root, platform: null, pins: f.pins, fetch: net.fetch }), (e: unknown) => e instanceof EngineInstallError && e.reason === "unsupported");
  assert.deepEqual(net.asked, []);
  const stale = path.join(root, "codex", ".part-1-dead");
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, "codex"), "half", { mode: 0o755 });
  const old = new Date(Date.now() - 2 * 60 * 60_000);
  fs.utimesSync(stale, old, old);
  fs.mkdirSync(path.join(root, "codex", "0.150.0"), { recursive: true });
  fs.writeFileSync(path.join(root, "codex", "0.150.0", "codex"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(findProgram("codex", { platform: "linux", env: { PATH: "/nonexistent" }, enginesRoot: root }), null, "neither a hidden folder nor an older version is ever looked in");
  await installEngine("codex", { root, platform: "linux-x64", pins: f.pins, fetch: fakeFetch({ [f.pins.codex!.builds["linux-x64"]!.url]: f.packed }).fetch });
  assert.deepEqual(tree(root), ["codex", "codex/0.166.0", "codex/0.166.0/codex"]);
});

test("the installer: one install per program however many ask, its progress, a failure remembered for a while and forgotten when a person presses Install", async () => {
  let now = 1_000;
  let calls = 0;
  let release: () => void = () => undefined;
  const root = tmp();
  let fail = true;
  const inst = createEngineInstaller({
    root, platform: "linux-x64", now: () => now, failureMs: 60_000,
    install: async (program, o) => {
      calls++;
      o.onProgress?.(50, 100);
      await new Promise<void>((r) => { release = r; });
      if (fail) throw new EngineInstallError("offline", "the vendor could not be reached");
      const at = path.join(o.root, program, ENGINE_PINS.codex.version, program);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, "#!/bin/sh\n", { mode: 0o755 });
      return at;
    },
  });
  assert.equal(inst.supported("codex"), true);
  assert.equal(inst.supported("node"), false);
  assert.equal(inst.supported("toString"), false, "a name off the object's prototype is no engine");
  assert.equal(createEngineInstaller({ root, platform: null }).supported("codex"), false, "no build for this computer");
  const a = inst.ensure("codex"), b = inst.ensure("codex");
  assert.equal(a, b, "the same install");
  assert.deepEqual(inst.state("codex"), { phase: "installing", done: 50, total: 100 });
  release();
  await assert.rejects(a, (e: unknown) => e instanceof EngineInstallError && e.reason === "offline");
  assert.equal(calls, 1);
  assert.equal(inst.failedRecently("codex"), true);
  assert.equal(inst.state("codex").reason, "offline");
  now += 61_000;
  assert.equal(inst.failedRecently("codex"), false, "a failure is remembered for a while only");
  now -= 61_000;
  inst.forget();
  assert.equal(inst.failedRecently("codex"), false, "Install starts afresh");
  fail = false;
  const c = inst.ensure("codex");
  release();
  assert.equal(await c, path.join(root, "codex", "0.166.0", "codex"));
  assert.equal(inst.installed("codex"), await c);
  assert.equal(inst.state("codex").phase, "ready");
  assert.equal(await inst.ensure("codex"), await c, "there now: no second install");
  assert.equal(calls, 2);
});

test("lookup order: a person's own install first, then Vyre's engines folder; a copy an app carries is never used, on a Mac and on Linux", () => {
  const home = "/Users/dana";
  const root = `${home}/Library/Application Support/ai.vyre.desktop/engines`;
  const own = `${home}/.local/bin/codex`, app = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", vyre = `${root}/codex/0.166.0/codex`;
  const dirs = (files: string[]) => new Set(files.flatMap((f) => [f, path.dirname(f)]));
  const probe = (files: string[]) => { const there = dirs(files); return { platform: "darwin" as const, env: { PATH: "/usr/bin:/bin", HOME: home }, exists: (p: string) => there.has(p), enginesRoot: root }; };
  assert.equal(findProgram("codex", probe([own, app, vyre])), own, "the person's own install wins");
  assert.equal(findProgram("codex", probe([app, vyre])), vyre, "the copy inside the ChatGPT app is passed over for Vyre's own");
  assert.equal(findProgram("codex", probe([vyre])), vyre, "then Vyre's own");
  assert.equal(findProgram("codex", { ...probe([vyre]), enginesRoot: null }), null, "with no engines folder, nothing");
  assert.equal(isOwned(vyre, probe([vyre])), true);
  assert.equal(isOwned(own, probe([own])), false);
  const path_ = enginePath({ PATH: "/usr/bin:/bin" }, home, "darwin", (p) => dirs([own, app, vyre]).has(p), () => [], ownedProgramDirs(root)).split(":");
  assert.deepEqual(path_.slice(-1), [`${root}/codex/0.166.0`], "Vyre's folders come last on the engine's PATH");
  const lin = "/data/engines";
  const linux = (files: string[]) => { const there = dirs(files); return { platform: "linux" as const, env: { PATH: "/usr/local/bin:/usr/bin", HOME: "/home/v" }, exists: (p: string) => there.has(p), enginesRoot: lin }; };
  assert.equal(findProgram("grok", linux(["/usr/local/bin/grok", `${lin}/grok/1.0.70/grok`])), "/usr/local/bin/grok", "the image's baked copy wins on a server");
  assert.equal(findProgram("grok", linux([`${lin}/grok/1.0.70/grok`])), `${lin}/grok/1.0.70/grok`, "a server whose image lacks Grok runs the one Vyre installed");
});

test("an engine Vyre installed is started by its full path (a sandbox's PATH never holds the engines folder); a person's own is started by name as before", () => {
  const root = tmp();
  const at = path.join(root, "grok", "1.0.70", "grok");
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.writeFileSync(at, "#!/bin/sh\n", { mode: 0o755 });
  const empty = tmp();
  assert.deepEqual(ownedArgv(["grok", "-p"], { platform: "linux", env: { PATH: empty }, enginesRoot: root }), [at, "-p"]);
  const mine = tmp();
  fs.writeFileSync(path.join(mine, "grok"), "#!/bin/sh\n", { mode: 0o755 });
  assert.deepEqual(ownedArgv(["grok", "-p"], { platform: "linux", env: { PATH: mine }, enginesRoot: root }), ["grok", "-p"]);
  assert.deepEqual(ownedArgv(["node", "x.js"], { platform: "linux", env: { PATH: empty }, enginesRoot: root }), ["node", "x.js"], "only the CLI engines");
});
