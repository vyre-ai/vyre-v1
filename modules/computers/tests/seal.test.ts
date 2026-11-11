// A browser profile at rest (handlers/seal.ts, sbrowser/seal.ts) against scripted Engines that can fail, stop halfway and run things at the same time. The tests named F1 to F16 are the findings of the
// security review of the first version (team/v1/SEAL-REVIEW-2026-11-11.md); each reproduces the reviewer's scenario. The sealed bytes are checked as bytes: a plain base64 or hex copy of a profile fails them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { tarFiles, untar } from "../../../sandbox/src/tar.ts";
import type { DockerHttp, DockerRequest } from "../../../sandbox/src/docker.ts";
import { checkId, createProfileSeal, createSealedStore, openFrom, peekTar, sealTo, SEAL_CAP_BYTES, TooLargeError, UNOPENED, UnopenedError, WIPE_SCRIPT, CHUNK, tarIsEmpty } from "../handlers/seal.ts";
import { createBrowserSeal } from "../sbrowser/seal.ts";
import type { ProfileRow } from "../sbrowser/port.ts";
import { createDockerComputerHost } from "../impl.ts";
import { createDockerSpaceBrowser } from "../sbrowser/docker.ts";
import { loadedProfileKey } from "../../../host/src/seams/computers-host.ts";

const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);
const file = (p: string, text: string) => ({ path: p, data: new TextEncoder().encode(text), mode: 0o600, uid: 10001, gid: 10001, mtime: 1 });
const dirOf = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-seal-"));
const SECRET = "PLANTED-COOKIE-7f3a91";
const profileTar = (): Uint8Array => tarFiles([file("chrome/Default/Cookies", `session=${SECRET}`), file("chrome/Default/Login Data", `user=dana password=${SECRET}`)]);
const text = (b: Uint8Array | undefined): string => (b ? new TextDecoder().decode(b) : "");
const CID = (n: string): string => `cmt_${n}`;
const nameOf = (id: string): string => `vyre-comp-${id.replace(/^cmt_/, "")}`;
const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));
const planted = { "chrome/Default/Cookies": `session=${SECRET}`, "chrome/Default/Login Data": `password=${SECRET}` };
const wipeLines = (log: string[]): number => log.filter((l) => l.startsWith("wipe ")).length;

/** Every form a plain copy of the secret could take in a file: raw, base64 (at each of its three alignments), hex. */
function formsOf(secret: string): Buffer[] {
  const raw = Buffer.from(secret);
  const out = [raw, Buffer.from(raw.toString("hex"))];
  for (const pad of ["", "x", "xx"]) { const b = Buffer.from(pad + secret).toString("base64"); out.push(Buffer.from(b.slice(Math.ceil((pad.length * 4) / 3) + 1, -4))); }
  return out;
}
const assertNoPlain = (blob: Buffer, what: string): void => {
  for (const f of formsOf(SECRET)) assert.ok(!blob.includes(f), `${what}: no raw, base64 or hex form of the secret`);
  for (const n of ["Cookies", "Login Data", "chrome/Default"]) assert.ok(!blob.includes(n), `${what}: no file name ${n}`);
};
const sealedBlob = async (k: Uint8Array, kind: "computers" | "sbrowser", id: string, tar: Uint8Array): Promise<{ file: string; blob: Buffer }> => {
  const f = path.join(dirOf(), "x.profile");
  await sealTo(f, Readable.from([Buffer.from(tar)]), k, kind, id);
  return { file: f, blob: fs.readFileSync(f) };
};
const drain = async (g: AsyncIterable<Uint8Array>): Promise<Buffer> => { const parts: Buffer[] = []; for await (const c of g) parts.push(Buffer.from(c)); return Buffer.concat(parts); };

// ---- the format ----------------------------------------------------------------------------------------------------------------------------------------

test("the sealed bytes are real encryption: no raw, base64 or hex form of a secret, no file name, and they do not open under another key, profile or kind", async () => {
  const tar = profileTar();
  const { file: f, blob } = await sealedBlob(key(1), "computers", CID("aaaa1111"), tar);
  assertNoPlain(blob, "computers");
  assert.ok(Buffer.from(tar).equals(await drain(openFrom(f, key(1), "computers", CID("aaaa1111")))), "opens with the same key, kind and profile");
  for (const [k, kind, id] of [[key(2), "computers", CID("aaaa1111")], [key(1), "computers", CID("bbbb2222")], [key(1), "sbrowser", CID("aaaa1111")]] as const) {
    await assert.rejects(drain(openFrom(f, k, kind, id)), (e: unknown) => e instanceof UnopenedError, `${kind} ${id}`);
  }
  // the key, and a plain copy of the tar, are what would pass a plain "contains" check: a plain base64 copy does contain the secret's base64 form
  assert.ok(Buffer.from(Buffer.from(tar).toString("base64")).includes(formsOf(SECRET)[2]!) || Buffer.from(Buffer.from(tar).toString("base64")).includes(formsOf(SECRET)[3]!) || Buffer.from(Buffer.from(tar).toString("base64")).includes(formsOf(SECRET)[4]!), "the check does catch a plain base64 copy");
});

test("F14: chunks cannot be spliced between two files of one profile, a cut, swapped, dropped or flipped file is refused, and a short tag is refused", async () => {
  const big = Uint8Array.from({ length: 2 * CHUNK + 1000 }, (_, i) => (i * 31) & 255);
  const a = await sealedBlob(key(1), "computers", CID("aaaa1111"), big);
  const b = await sealedBlob(key(1), "computers", CID("aaaa1111"), big);
  const la = a.blob.toString("utf8").split("\n").filter((l) => l.length > 0);
  const lb = b.blob.toString("utf8").split("\n").filter((l) => l.length > 0);
  assert.equal(la.length, 4, "a header and three chunks");
  const opens = async (lines: string[]): Promise<boolean> => { const f = path.join(dirOf(), "y.profile"); fs.writeFileSync(f, `${lines.join("\n")}\n`); try { await drain(openFrom(f, key(1), "computers", CID("aaaa1111"))); return true; } catch (e) { assert.ok(e instanceof UnopenedError, `only a failed check, not ${String(e)}`); return false; } };
  assert.equal(await opens(la), true);
  assert.equal(await opens([la[0]!, la[1]!, lb[2]!, la[3]!]), false, "a chunk of another file of the same profile and key");
  assert.equal(await opens([la[0]!, la[1]!, la[2]!]), false, "cut after chunk 2");
  assert.equal(await opens([la[0]!, la[1]!, la[3]!]), false, "a chunk dropped");
  assert.equal(await opens([la[0]!, la[2]!, la[1]!, la[3]!]), false, "chunks swapped");
  assert.equal(await opens(la.slice(1)), false, "no header");
  const short = JSON.parse(la[3]!) as { iv: string; ct: string; tag: string };
  assert.equal(await opens([...la.slice(0, 3), JSON.stringify({ ...short, tag: Buffer.from(short.tag, "base64").subarray(0, 8).toString("base64") })]), false, "a shortened tag");
  const flipped = Buffer.from(a.blob); const at = Math.floor(flipped.length / 2); flipped[at] = flipped[at] === 65 ? 66 : 65;
  const f = path.join(dirOf(), "z.profile"); fs.writeFileSync(f, flipped);
  await assert.rejects(drain(openFrom(f, key(1), "computers", CID("aaaa1111"))), (e: unknown) => e instanceof UnopenedError);
});

test("F1: sealing and opening stream (a file grows while the source is still being read, a chunk comes out before the file is read to the end), and a disk error is not reported as a bad file", async () => {
  const dir = dirOf();
  const f = path.join(dir, "s.profile");
  let produced = 0, sizeWhileProducing = 0;
  async function* src(): AsyncGenerator<Uint8Array> { for (let i = 0; i < 40; i++) { produced += 1; yield new Uint8Array(1024 * 1024).fill(i); if (produced === 30) sizeWhileProducing = fs.statSync(f).size; } }
  await sealTo(f, src(), key(1), "computers", CID("aaaa1111"));
  assert.ok(sizeWhileProducing > 8_000_000, `the sealed file was already ${sizeWhileProducing} bytes on disk when 30 of 40 MB had been read`);
  const it = openFrom(f, key(1), "computers", CID("aaaa1111"));
  const first = await it.next();
  assert.equal(first.done, false);
  assert.equal(first.value.length, CHUNK, "the first chunk is there before the rest is read");
  await it.return(undefined);
  // not a file at all: the error is the disk's, never "changed, cut short or another key"
  fs.mkdirSync(path.join(dir, "d.profile"));
  await assert.rejects(drain(openFrom(path.join(dir, "d.profile"), key(1), "computers", CID("aaaa1111"))), (e: unknown) => !(e instanceof UnopenedError));
  await assert.rejects(drain(openFrom(path.join(dir, "missing.profile"), key(1), "computers", CID("aaaa1111"))), (e: unknown) => !(e instanceof UnopenedError));
});

test("F1: a profile over the cap is refused without leaving a file, however it arrives", async () => {
  const dir = dirOf();
  const f = path.join(dir, "big.profile");
  async function* three(): AsyncGenerator<Uint8Array> { for (let i = 0; i < 3; i++) yield new Uint8Array(1024 * 1024); }
  await assert.rejects(sealTo(f, three(), key(1), "computers", CID("aaaa1111"), 2 * 1024 * 1024 + 5), (e: unknown) => e instanceof TooLargeError);
  assert.deepEqual(fs.readdirSync(dir), [], "no half-sealed file, no temporary file");
  assert.equal(SEAL_CAP_BYTES, 1024 ** 3);
});

test("tarIsEmpty reads only the first bytes: an emptied profile is empty, one file or one folder is not", () => {
  assert.equal(tarIsEmpty(tarFiles([]), true), true);
  assert.equal(tarIsEmpty(new Uint8Array(1024), true), true);
  assert.equal(tarIsEmpty(tarFiles([file("Cookies", "x")]), true), false);
  assert.equal(tarIsEmpty(tarFiles([file("Default/Cookies", "x")]), true), false);
  assert.equal(tarIsEmpty(new Uint8Array(100), false), null, "not enough yet");
});

test("F16: only the id of a computer or a profile names a file, never a rewritten one", () => {
  for (const bad of ["agt+dex", "agt/dex", "../x", "", "ab", 5, undefined]) assert.throws(() => checkId("sbrowser", bad as string), /not the id/, String(bad));
  for (const bad of ["agt_dex", "cmt_x", "cmt_aaaa1111/..", "cmt_aaaa 1111"]) assert.throws(() => checkId("computers", bad), /not the id/, bad);
  assert.equal(checkId("sbrowser", "agt_dex"), "agt_dex");
  assert.equal(checkId("computers", "cmt_aaaa1111"), "cmt_aaaa1111");
  const store = createSealedStore({ key: () => key(1), dir: dirOf(), kind: "sbrowser" });
  assert.throws(() => store.file("agt+dex"), /not the id/);
});

// ---- an Engine that can fail, stop halfway and hold things up ------------------------------------------------------------------------------------

type Hooks = { onWait?: (helper: string) => Promise<void>; onGet?: (name: string) => Promise<void>; putFailAfterFiles?: number; putThrows?: boolean; wipeExit?: number; failCreate?: boolean };
function engine(dir: string, hooks: Hooks = {}) {
  const vols = new Map<string, Map<string, Uint8Array>>();
  const status = new Map<string, "running" | "exited" | "created" | "paused">();
  const helpers = new Map<string, string>();
  const log: string[] = [];
  const vol = (c: string): Map<string, Uint8Array> => { let v = vols.get(c); if (!v) { v = new Map(); vols.set(c, v); } return v; };
  const json = (v: unknown, code = 200) => ({ status: code, body: new TextEncoder().encode(JSON.stringify(v)) });
  const tarOf = (c: string): Uint8Array => tarFiles([...vol(c)].map(([p, data]) => ({ path: p, data, mode: 0o600, uid: 10001, gid: 10001, mtime: 1 })));
  const http = (async (r: DockerRequest) => {
    log.push(`${r.method} ${r.path}`);
    if (r.method === "GET" && r.path === "/_ping") return { status: 200, body: new TextEncoder().encode("OK") };
    if (r.method === "GET" && r.path === "/containers/json") return json([...status].map(([n, s]) => ({ State: s, Labels: { "vyre.computer": `cmt_${n.replace(/^vyre-comp-/, "")}` } })));
    if (r.method === "POST" && r.path === "/containers/create") {
      if (hooks.failCreate) return { status: 500, body: new Uint8Array() };
      const body = r.json as { HostConfig: { VolumesFrom: string[] }; Cmd: string[]; User: string; Entrypoint: unknown[] };
      assert.deepEqual(body.Cmd, ["sh", "-c", WIPE_SCRIPT], "the wipe helper runs its one fixed script");
      assert.equal(body.User, "10001:10001"); assert.deepEqual(body.Entrypoint, []);
      helpers.set(r.query!["name"]!, body.HostConfig.VolumesFrom[0]!);
      return { status: 201, body: new Uint8Array() };
    }
    if (r.method === "DELETE") return { status: 204, body: new Uint8Array() };
    let m = /^\/containers\/([^/]+)\/json$/.exec(r.path);
    if (m) { const s = status.get(m[1]!); return s ? json({ State: { Status: s, Running: s === "running" } }) : { status: 404, body: new Uint8Array() }; }
    m = /^\/containers\/([^/]+)\/(start|wait)$/.exec(r.path);
    if (m && m[2] === "start") return { status: 204, body: new Uint8Array() };
    if (m && m[2] === "wait") {
      await hooks.onWait?.(m[1]!);
      const exit = hooks.wipeExit ?? 0;
      if (exit === 0) { const c = helpers.get(m[1]!)!; vol(c).clear(); log.push(`wipe ${c}`); }
      return json({ StatusCode: exit });
    }
    return { status: 404, body: new Uint8Array() };
  }) as DockerHttp;
  http.stream = {
    async get(a) {
      const m = /^\/containers\/([^/]+)\/archive$/.exec(a.path);
      log.push(`GET-STREAM ${a.path}`);
      await hooks.onGet?.(m![1]!);
      if (!m || !status.has(m[1]!)) return { status: 404, body: Readable.from([]) as never };
      const tar = Buffer.from(tarOf(m[1]!));
      const pieces: Buffer[] = []; for (let i = 0; i < tar.length; i += 65536) pieces.push(tar.subarray(i, i + 65536));
      return { status: 200, body: Readable.from(pieces) as never };
    },
    async put(a) {
      const m = /^\/containers\/([^/]+)\/archive$/.exec(a.path)!;
      log.push(`PUT-STREAM ${a.path}`);
      const parts: Buffer[] = [];
      for await (const c of a.body) parts.push(Buffer.from(c as Uint8Array));
      if (hooks.putThrows) throw new Error("the connection to the Engine broke");
      const files = untar(Buffer.concat(parts)).filter((e) => e.type === "file");
      const n = hooks.putFailAfterFiles ?? files.length;
      for (const e of files.slice(0, n)) vol(m[1]!).set(e.path, e.data);
      return { status: n < files.length ? 500 : 200, body: new Uint8Array() };
    },
  };
  const seal = (o: { k?: Uint8Array; lock?: ReturnType<typeof import("../handlers/seal.ts").keyedLock>; logs?: Array<[string, string]>; cap?: number } = {}) => createProfileSeal({
    http, key: () => o.k ?? key(1), dir, container: nameOf, image: "img", user: { uid: 10001, gid: 10001 },
    ...(o.lock ? { lock: o.lock } : {}), ...(o.cap ? { cap: o.cap } : {}), ...(o.logs ? { log: (l: string, m: string) => { o.logs!.push([l, m]); } } : {}),
  });
  return {
    http, seal, vols, vol, status, log, hooks,
    plant(id: string, files: Record<string, string> = planted, st: "running" | "exited" | "created" | "paused" = "exited"): string { const n = nameOf(id); status.set(n, st); for (const [p, t] of Object.entries(files)) vol(n).set(p, new TextEncoder().encode(t)); return n; },
  };
}
const sealedFile = (dir: string, id: string): string => path.join(dir, `${id}.profile`);

test("sleep seals the profile and empties the volume, wake puts back the same bytes, and the file is real encryption", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa1111"); const name = e.plant(id); const s = e.seal();
  await s.unseal(id);
  assert.equal(s.state(id), "hot");
  assert.equal(await s.seal(id), "sealed");
  assert.equal(e.vol(name).size, 0, "the volume is empty while the computer sleeps");
  assert.equal(s.state(id), "sealed");
  assertNoPlain(fs.readFileSync(sealedFile(dir, id)), "the sealed profile");
  assert.equal(fs.statSync(sealedFile(dir, id)).mode & 0o077, 0, "private to the daemon's user");
  await s.unseal(id);
  assert.equal(text(e.vol(name).get("chrome/Default/Login Data")), `password=${SECRET}`);
  assert.equal(s.state(id), "hot");
});

test("a wrong key or a changed file fails closed: nothing is put back, the file and the state stay as they were", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("bbbb2222"); const name = e.plant(id);
  await e.seal().unseal(id); await e.seal().seal(id);
  const f = sealedFile(dir, id); const before = fs.readFileSync(f);
  await assert.rejects(e.seal({ k: key(9) }).unseal(id), (err: Error) => err.message === UNOPENED);
  assert.equal(e.vol(name).size, 0); assert.equal(e.seal().state(id), "sealed"); assert.ok(fs.readFileSync(f).equals(before));
  const cut = Buffer.from(before.subarray(0, Math.floor(before.length / 2))); fs.writeFileSync(f, cut);
  await assert.rejects(e.seal().unseal(id), (err: Error) => err.message === UNOPENED);
  assert.ok(fs.readFileSync(f).equals(cut)); assert.equal(e.vol(name).size, 0);
  fs.writeFileSync(f, before); await e.seal().unseal(id); assert.equal(e.vol(name).size, 2);
});

test("F5: no key is a loud refusal, never a new key: nothing is sealed, opened or created, and the files stay as they were", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("cccc3333"); const name = e.plant(id);
  await e.seal().unseal(id); await e.seal().seal(id);
  const before = fs.readFileSync(sealedFile(dir, id)); const listing = fs.readdirSync(dir).sort();
  const none = createProfileSeal({ http: e.http, key: () => { throw new Error("no key"); }, dir, container: nameOf, image: "img", user: { uid: 10001, gid: 10001 } });
  await assert.rejects(none.unseal(id), /seal key is not available/);
  const short = createProfileSeal({ http: e.http, key: () => new Uint8Array(4), dir, container: nameOf, image: "img", user: { uid: 10001, gid: 10001 } });
  await assert.rejects(short.unseal(id), /seal key is not available/);
  assert.equal(e.vol(name).size, 0); assert.ok(fs.readFileSync(sealedFile(dir, id)).equals(before)); assert.deepEqual(fs.readdirSync(dir).sort(), listing, "no file made");
  // and sealing a plain profile with no key leaves it plain and untouched
  const id2 = CID("dddd4444"); const n2 = e.plant(id2);
  await assert.rejects(createProfileSeal({ http: e.http, key: () => new Uint8Array(0), dir, container: nameOf, image: "img", user: { uid: 10001, gid: 10001 } }).seal(id2), /seal key is not available/);
  assert.equal(e.vol(n2).size, 2, "the plain profile was not wiped");
  // the daemon hands over the key it loaded: a missing one throws, and the call site does not read or make a key file
  assert.throws(() => loadedProfileKey(() => undefined)(), /not loaded/);
  assert.throws(() => loadedProfileKey(() => "short")(), /not loaded/);
  assert.equal(loadedProfileKey(() => "0".repeat(64))().length, 64);
  const daemon = fs.readFileSync(new URL("../../../host/src/daemon/daemon.ts", import.meta.url), "utf8");
  const line = daemon.split("\n").find((l) => l.includes("profileKey:")) ?? "";
  assert.match(line, /loadedProfileKey\(\(\) => sealKey\.key\)/);
  assert.doesNotMatch(line, /sealKeyFile|readFileSync|writeFileSync/);
});

test("a crash between unseal and seal: the next start seals the plain profile before anything reads it, with the newest state", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("eeee5555"); const name = e.plant(id);
  await e.seal().unseal(id); await e.seal().seal(id); await e.seal().unseal(id);
  e.vol(name).set("chrome/Default/Cookies", new TextEncoder().encode(`newer=${SECRET}`));
  const after = e.seal();
  assert.equal(after.state(id), "hot");
  assert.deepEqual(await after.recoverStopped(), [id]);
  assert.equal(e.vol(name).size, 0);
  await after.unseal(id);
  assert.equal(text(e.vol(name).get("chrome/Default/Cookies")), `newer=${SECRET}`);
  e.status.set(name, "running");
  assert.deepEqual(await e.seal().recoverStopped(), []);
  assert.equal(e.vol(name).size, 2, "a running computer is left alone");
});

test("a computer that never had a profile still starts; a profile from before sealing is sealed at its first sleep and at boot without losing a sign-in", async () => {
  const dir = dirOf(); const e = engine(dir);
  const fresh = CID("ffff6666"); const fn = e.plant(fresh, {});
  const s = e.seal();
  await s.unseal(fresh); assert.equal(e.vol(fn).size, 0);
  assert.equal(await s.seal(fresh), "empty"); assert.equal(s.state(fresh), "none");
  const a = CID("gggg7777"); const an = e.plant(a); const b = CID("hhhh8888"); const bn = e.plant(b);
  assert.equal(s.state(a), "none");
  assert.equal(await s.seal(a), "sealed"); assert.equal(e.vol(an).size, 0);
  await s.unseal(a); assert.equal(text(e.vol(an).get("chrome/Default/Cookies")), `session=${SECRET}`, "the sign-in survived the migration");
  e.status.set(an, "running");
  assert.deepEqual(await e.seal().recoverStopped(), [b]);
  assert.equal(e.vol(bn).size, 0);
});

test("a removed computer's sealed profile goes with it", async () => {
  const dir = dirOf(); const e = engine(dir); const id = CID("iiii9999"); e.plant(id);
  const s = e.seal(); await s.seal(id); await s.unseal(id); await s.seal(id);
  await s.discard(id);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// ---- F2: nothing runs under a computer that is being sealed -----------------------------------------------------------------------------------------

test("F2: a profile is never sealed or wiped under a running, paused or restarting container", async () => {
  const dir = dirOf(); const e = engine(dir); const id = CID("aaaa0001"); const name = e.plant(id);
  const s = e.seal(); await s.unseal(id);
  for (const st of ["running", "paused"] as const) {
    e.status.set(name, st);
    await assert.rejects(s.seal(id), /is running/, st);
    assert.equal(e.vol(name).size, 2, `the live volume is untouched (${st})`);
  }
  assert.equal(wipeLines(e.log), 0, "no wipe helper ran");
  assert.equal(s.state(id), "hot");
});

test("F2: a wake and the migration read of one sleeping computer take turns (scenario A), and a wake that arrives while a sleep is between save and wipe waits for the wipe (scenario B)", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0002"); const name = e.plant(id);
  const startedAt: string[] = [];
  const api = {
    async ping() { return true; }, async imageExists() { return true; }, async networkCreate() { throw new Error("no"); }, async networkRemove() {},
    async containerCreate() { return "x"; }, async containerStart(n: string) { startedAt.push(`start live=${e.vol(n).size}`); e.status.set(n, "running"); },
    async containerStop(n: string) { e.status.set(n, "exited"); }, async containerRemove() {}, async containerRunning(n: string) { return e.status.get(n) === "running"; },
    async exec() { return { exitCode: 0, stdout: "{}", stderr: "" }; }, async putArchive() {},
  };
  const host = createDockerComputerHost({ api: api as never, http: e.http, image: "img", profileSeal: { key: () => key(1), dir }, startTimeoutMs: 5_000, user: { uid: 10001, gid: 10001 }, sleep: async () => {} });
  await host.start({ computerId: id, agentId: "agt_x", tabLimit: 4 });          // first wake: marked plain
  await host.stop({ computerId: id, agentId: "agt_x", reason: "sleep" });       // sealed
  assert.equal(e.vol(name).size, 0);
  // A: the migration read and a wake started together
  const reading = host.chromeData!(id);
  const waking = host.start({ computerId: id, agentId: "agt_x", tabLimit: 4 });
  await Promise.all([reading, waking]);
  assert.equal(e.vol(name).size, 2, "the profile is on the volume of the running computer: chromeData did not seal it under the browser");
  assert.equal(wipeLines(e.log), 2, "the sleep wiped, and the migration read sealed the profile again before the wake restored it, one after the other");
  assert.deepEqual(startedAt, ["start live=2", "start live=2"], "the container started only after the profile was back on its volume");
  assert.equal(e.status.get(name), "running");
  // B: a sleep held between its save and its wipe, a wake arrives
  let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; });
  e.hooks.onWait = () => gate;
  const sleeping = host.stop({ computerId: id, agentId: "agt_x", reason: "sleep" });
  await tick(30);
  const wokeEarly = host.start({ computerId: id, agentId: "agt_x", tabLimit: 4 });
  await tick(30);
  assert.equal(e.status.get(name), "exited", "the wake has not started the container while the sleep is between save and wipe");
  e.hooks.onWait = undefined; release();
  await Promise.all([sleeping, wokeEarly]);
  assert.equal(e.status.get(name), "running");
  assert.equal(e.vol(name).size, 2, "the wipe did not run under the woken computer, and the profile came back whole");
  assert.deepEqual(startedAt.at(-1), "start live=2");
});

// ---- F3: a restore that breaks must not become the truth -----------------------------------------------------------------------------------------

test("F3: a restore that fails partway (a 500 after some files, or a broken connection) wipes the partial copy and leaves the good file the truth; the retry restores everything and a seal never saves the partial", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0003"); const name = e.plant(id);
  await e.seal().unseal(id); await e.seal().seal(id);
  const good = fs.readFileSync(sealedFile(dir, id));
  e.hooks.putFailAfterFiles = 1;
  await assert.rejects(e.seal().unseal(id), /could not be put back \(500\)/);
  assert.equal(e.vol(name).size, 0, "the half-restored profile was wiped");
  assert.equal(e.seal().state(id), "wiping", "the file is still the truth");
  assert.ok(fs.readFileSync(sealedFile(dir, id)).equals(good), "the good file is intact");
  e.hooks.putFailAfterFiles = undefined; e.hooks.putThrows = true;
  await assert.rejects(e.seal().unseal(id), /broke/);
  assert.equal(e.vol(name).size, 0);
  e.hooks.putThrows = false;
  await e.seal().unseal(id);
  assert.equal(e.vol(name).size, 2, "the retry restores the whole profile");
  assert.equal(e.seal().state(id), "hot");
  await e.seal().seal(id);
  await e.seal().unseal(id);
  assert.equal(text(e.vol(name).get("chrome/Default/Login Data")), `password=${SECRET}`, "nothing was lost in two sleeps");
});

// ---- F9, F13: a wipe that fails -------------------------------------------------------------------------------------------------------------------

test("F9: a wipe that fails does not brick the computer: the wake still restores (the PUT overwrites), and the wipe script opens up locked folders first", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0004"); const name = e.plant(id);
  await e.seal().unseal(id);
  e.hooks.wipeExit = 1;
  const logs: Array<[string, string]> = [];
  await assert.rejects(e.seal({ logs }).seal(id), /not emptied/);
  assert.equal(e.seal().state(id), "wiping");
  assert.equal(e.vol(name).size, 2, "the volume still holds the files the failed wipe could not remove");
  await e.seal({ logs }).unseal(id);   // the wake: its own wipe fails too, and the restore goes on
  assert.equal(e.seal().state(id), "hot");
  assert.ok(logs.some(([, m]) => m === "computers.profile.wipe_failed"), "the failed wipe is logged");
  assert.match(WIPE_SCRIPT, /^chmod -R u\+rwX \/home\/agent\/\.profile-disk .*; find \/home\/agent\/\.profile-disk -mindepth 1 -delete$/);
  const policy = fs.readFileSync(new URL("../../../host/src/sites-runner/computers-policy.ts", import.meta.url), "utf8");
  assert.ok(policy.includes("export const SEAL_RM_SCRIPT = `chmod -R u+rwX ${PROFILE_GUEST} 2>/dev/null; find ${PROFILE_GUEST} -mindepth 1 -delete`;"), "the runner policy holds the same script");
});

test("F13: one computer that cannot be sealed does not stop the others at boot, and each failure is logged", async () => {
  const dir = dirOf(); const e = engine(dir);
  const a = CID("aaaa000a"); const b = CID("bbbb000b"); const c = CID("cccc000c");
  const an = e.plant(a); const bn = e.plant(b); const cn = e.plant(c);
  // the first one's volume cannot be read; the others can
  const get = e.http.stream!.get;
  e.http.stream!.get = async (x) => { if (x.path.includes(an)) return { status: 500, body: Readable.from([]) as never }; return get(x); };
  const logs: Array<[string, string]> = [];
  const done = await e.seal({ logs }).recoverStopped();
  assert.deepEqual(done.sort(), [b, c].sort());
  assert.equal(e.vol(bn).size + e.vol(cn).size, 0, "the later computers were sealed");
  assert.equal(e.vol(an).size, 2);
  assert.ok(logs.some(([, m]) => m === "computers.profile.recover_failed"));
});

// ---- F10: a cleared profile does not come back ------------------------------------------------------------------------------------------------------

test("F10: when the profile was restored (hot) and then cleared, the old sealed file is dropped, not brought back", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0010"); const name = e.plant(id);
  await e.seal().unseal(id); await e.seal().seal(id); await e.seal().unseal(id);
  e.vol(name).clear();                                    // the person cleared everything
  assert.equal(await e.seal().seal(id), "empty");
  assert.equal(fs.existsSync(sealedFile(dir, id)), false, "the old sign-ins are gone");
  await e.seal().unseal(id);
  assert.equal(e.vol(name).size, 0, "the next wake brings nothing back");
});

// ---- F11, F12: durable steps in order ---------------------------------------------------------------------------------------------------------------

test("F11, F12: the state says plain data before the sealed file exists, and the directory is flushed after the rename and before the wipe", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0011"); e.plant(id);
  const events: string[] = [];
  const realRename = fs.renameSync, realFsync = fs.fsyncSync;
  fs.renameSync = ((a: fs.PathLike, b: fs.PathLike) => { const to = String(b); if (to.endsWith(".profile")) events.push(`rename-file state=${createSealedStore({ key: () => key(1), dir, kind: "computers" }).state(id)}`); else if (to.endsWith(".state")) events.push("rename-state"); return realRename(a, b); }) as typeof fs.renameSync;
  fs.fsyncSync = ((fd: number) => { try { if (fs.fstatSync(fd).isDirectory()) events.push("fsync-dir"); } catch { /* closed */ } return realFsync(fd); }) as typeof fs.fsyncSync;
  e.hooks.onWait = async () => { events.push("wipe"); };
  try { await e.seal().seal(id); } finally { fs.renameSync = realRename; fs.fsyncSync = realFsync; }
  const at = (x: string): number => events.findIndex((v) => v.startsWith(x));
  assert.match(events[at("rename-file")]!, /state=hot/, "a crash after the save still reads as plain data to seal (F12)");
  assert.ok(events.indexOf("fsync-dir", at("rename-file")) > at("rename-file") && events.indexOf("fsync-dir", at("rename-file")) < at("wipe"), `the directory is flushed between the rename and the wipe: ${events.join(", ")}`);
  assert.ok(events.indexOf("fsync-dir", at("rename-state")) > at("rename-state"), "and after each state change");
});

// ---- F1 at the computer level: oversize is left plain and reported -----------------------------------------------------------------------------------

test("F1: a profile over the cap is left plain and reported, never half sealed, and a timer does not read it again", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0001"); const name = e.plant(id, { "chrome/Default/Big": "x".repeat(4 * 1024 * 1024) });
  const logs: Array<[string, string]> = [];
  const s = e.seal({ logs, cap: 1024 * 1024 });
  await s.unseal(id);
  assert.equal(await s.seal(id), "oversize");
  assert.equal(e.vol(name).size, 1, "still plain on the volume"); assert.equal(s.state(id), "hot");
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".profile") || n.endsWith(".tmp")), [], "no sealed file, no partial file");
  assert.deepEqual(s.oversize(), [id]);
  assert.ok(logs.some(([l, m]) => l === "warn" && m === "computers.profile.too_large"));
  assert.equal(wipeLines(e.log), 0);
  const reads = e.log.filter((l) => l.startsWith("GET-STREAM")).length;
  assert.deepEqual(await s.recoverStopped(), []);
  assert.equal(e.log.filter((l) => l.startsWith("GET-STREAM")).length, reads, "the periodic check does not read an oversize profile again");
});

// ---- F8: a container that dies on its own ----------------------------------------------------------------------------------------------------------

test("F8: a computer whose container dies outside a sleep is sealed by the periodic check, not only at the next boot", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0008"); const name = e.plant(id);
  const api = { async ping() { return true; }, async imageExists() { return true; }, async networkCreate() { throw new Error("no"); }, async networkRemove() {}, async containerCreate() { return "x"; }, async containerStart() {}, async containerStop() {}, async containerRemove() {}, async containerRunning() { return false; }, async exec() { return { exitCode: 0, stdout: "{}", stderr: "" }; }, async putArchive() {} };
  const host = createDockerComputerHost({ api: api as never, http: e.http, image: "img", profileSeal: { key: () => key(1), dir }, recoverEveryMs: 20, user: { uid: 10001, gid: 10001 } });
  await host.recover();
  await e.seal().unseal(id);       // woken: plain
  e.status.set(name, "running");
  await tick(60);
  assert.equal(e.vol(name).size, 2, "a running computer is left alone by the check");
  e.status.set(name, "exited");    // the container dies
  for (let i = 0; i < 40 && e.vol(name).size > 0; i++) await tick(25);
  assert.equal(e.vol(name).size, 0, "the check sealed it");
  assert.ok(fs.existsSync(sealedFile(dir, id)));
});

// ---- the Space browser's profiles ----------------------------------------------------------------------------------------------------------------

type BHooks = { putFails?: number; rowsFail?: boolean; onRead?: () => Promise<void>; resetFails?: boolean };
function browser(dir: string, o: { k?: Uint8Array; hooks?: BHooks; cap?: number; logs?: Array<[string, string]> } = {}) {
  const hooks = o.hooks ?? {};
  const folders = new Map<string, Map<string, Uint8Array>>();
  const rows = new Map<string, ProfileRow>();
  const guards = new Map<string, boolean>();
  const calls: string[] = [];
  const f = (id: string): Map<string, Uint8Array> => { let v = folders.get(id); if (!v) { v = new Map(); folders.set(id, v); } return v; };
  let clock = 1_000_000;
  const store = createSealedStore({ key: () => o.k ?? key(1), dir, kind: "sbrowser" });
  const seal = createBrowserSeal({
    store, now: () => clock, quietMs: 20_000, ...(o.cap ? { cap: o.cap } : {}), ...(o.logs ? { log: (l, m) => { o.logs!.push([l, m]); } } : {}),
    async read(id) {
      calls.push(`read ${id}`); await hooks.onRead?.();
      if (f(id).size === 0) return { status: 404, body: Readable.from([]) as never };
      return { status: 200, body: Readable.from([Buffer.from(tarFiles([...f(id)].map(([p, data]) => ({ path: `chrome/${p}`, data, mode: 0o600, uid: 10001, gid: 10001, mtime: 1 }))))]) as never };
    },
    async put(id, body) {
      calls.push(`put ${id}`);
      const files = untar(await drain(body)).filter((e) => e.type === "file");
      const n = hooks.putFails !== undefined ? hooks.putFails : files.length;
      for (const e of files.slice(0, n)) f(id).set(e.path.replace(/^chrome\//, ""), e.data);
      return { status: n < files.length ? 500 : 200 };
    },
    async reset(id) { calls.push(`reset ${id}`); if (hooks.resetFails) throw new Error("reset failed"); f(id).clear(); const r = rows.get(id); if (r) r.running = false; },
    async stop(id) { calls.push(`stop ${id}`); const r = rows.get(id); if (r) r.running = false; },
    async guard(id, on) { calls.push(`guard ${id} ${on}`); guards.set(id, on); },
    async rows() { if (hooks.rowsFail) throw new Error("status did not answer"); return [...rows.values()]; },
    async disk() { return [...folders].filter(([, v]) => v.size > 0).map(([id]) => id); },
  });
  const row = (id: string, x: Partial<ProfileRow> = {}): void => { rows.set(id, { profileId: id, running: false, tabs: 0, busy: false, takeover: false, viewers: 0, lastActiveAt: 0, held: 0, paused: false, ...x }); };
  return { seal, store, f, row, rows, guards, calls, hooks, advance(ms: number) { clock += ms; }, tool: <T>(id: string, fn: () => Promise<T>) => seal.use(id, fn) };
}
const cookie = (t: string): Uint8Array => new TextEncoder().encode(t);

test("browser: an idle profile is sealed and gone from the volume, the next call puts it back; a running or just-stopped one is left alone; the sealed bytes are real encryption", async () => {
  const dir = dirOf(); const b = browser(dir);
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie(`sid=${SECRET}`)); b.row("agt_dex", { running: true, lastActiveAt: 1_000_000 }); });
  assert.deepEqual(await b.seal.sweep(), [], "a running browser is never sealed");
  b.rows.get("agt_dex")!.running = false;
  assert.deepEqual(await b.seal.sweep(), [], "just stopped: given a few seconds first");
  b.advance(25_000);
  assert.deepEqual(await b.seal.sweep(), ["agt_dex"]);
  assert.equal(b.f("agt_dex").size, 0);
  assert.equal(b.guards.get("agt_dex"), true, "browserd is told not to start a browser on the emptied folder");
  assertNoPlain(fs.readFileSync(b.store.file("agt_dex")), "the sealed browser profile");
  await b.tool("agt_dex", async () => { assert.equal(text(b.f("agt_dex").get("Default/Cookies")), `sid=${SECRET}`, "the sign-in is back before the call runs"); });
  assert.equal(b.guards.get("agt_dex"), false, "the guard is lifted once the folder is back");
});

test("browser: a wrong key fails closed and leaves the sealed profile, the volume and the guard as they were", async () => {
  const dir = dirOf(); const b = browser(dir);
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie(`sid=${SECRET}`)); });
  b.advance(60_000); await b.seal.sweep();
  const before = fs.readFileSync(b.store.file("agt_dex"));
  const wrong = browser(dir, { k: key(7) });
  await assert.rejects(wrong.tool("agt_dex", async () => "ran"), (e: Error) => e.message === UNOPENED);
  assert.ok(fs.readFileSync(b.store.file("agt_dex")).equals(before)); assert.equal(wrong.store.state("agt_dex"), "sealed"); assert.deepEqual(wrong.calls, []);
});

test("F3 (browser): a restore that fails wipes the partial folder, keeps the good file, never runs the call, and the retry restores everything", async () => {
  const dir = dirOf(); const b = browser(dir);
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie(`sid=${SECRET}`)); b.f("agt_dex").set("Default/Login Data", cookie("pw")); });
  b.advance(60_000); await b.seal.sweep();
  const good = fs.readFileSync(b.store.file("agt_dex"));
  b.hooks.putFails = 1;
  let ran = false;
  await assert.rejects(b.tool("agt_dex", async () => { ran = true; }), /could not be put back/);
  assert.equal(ran, false, "the browser is not started on a half profile");
  assert.equal(b.f("agt_dex").size, 0, "the partial folder was wiped"); assert.equal(b.store.state("agt_dex"), "wiping"); assert.ok(fs.readFileSync(b.store.file("agt_dex")).equals(good));
  assert.equal(b.guards.get("agt_dex"), true, "the guard stays on");
  b.hooks.putFails = undefined;
  await b.tool("agt_dex", async () => {});
  assert.equal(b.f("agt_dex").size, 2); assert.equal(b.store.state("agt_dex"), "hot");
});

test("F6: a browser started by a viewer or a take-over cannot run over a sealed profile: the guard is on until the folder is back, and a sweep that finds a plain folder beside a sealed state says so", async () => {
  const dir = dirOf(); const logs: Array<[string, string]> = []; const b = browser(dir, { logs });
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie(`sid=${SECRET}`)); });
  b.advance(60_000); await b.seal.sweep();
  assert.equal(b.guards.get("agt_dex"), true);
  const guardIdx = b.calls.lastIndexOf("guard agt_dex true"), resetIdx = b.calls.lastIndexOf("reset agt_dex");
  assert.ok(guardIdx > resetIdx, "the guard goes on right after the folder is emptied");
  b.f("agt_dex").set("Default/Cookies", cookie("signed-in-by-a-stray-launch"));   // something put a plain folder over the sealed profile
  assert.deepEqual(await b.seal.sweep(), []);
  assert.ok(logs.some(([, m]) => m === "computers.browser.sealed_profile_has_plain_folder"), "it is logged, not skipped");
  const manager = fs.readFileSync(new URL("../../../images/space-browser/browserd/profiles.ts", import.meta.url), "utf8");
  assert.match(manager, /if \(o\.blocked\?\.\(id\)\) throw unavailable/, "browserd refuses to start a browser on a guarded profile");
  const main = fs.readFileSync(new URL("../../../images/space-browser/browserd/main.ts", import.meta.url), "utf8");
  assert.match(main, /blocked: \(id\) => existsSync\(`\$\{ROOT\}\/profiles\/\$\{id\}\/sealed\.flag`\)/);
});

test("F7: a status call that fails means the profile is not sealed; a call in flight keeps it from being sealed; only when it is over, and quiet, is it sealed", async () => {
  const dir = dirOf(); const b = browser(dir);
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie(`sid=${SECRET}`)); });
  b.advance(60_000);
  b.hooks.rowsFail = true;
  assert.deepEqual(await b.seal.sweep(), [], "browserd could not be asked: nothing sealed");
  assert.equal(b.f("agt_dex").size, 1, "the live folder was not read or reset"); assert.ok(!b.calls.includes("reset agt_dex"));
  b.hooks.rowsFail = false;
  let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; });
  const longCall = b.tool("agt_dex", async () => { await gate; });
  await tick(20);
  b.advance(60_000);
  assert.deepEqual(await b.seal.sweep(), [], "a call of more than 20 s is still using the profile");
  release(); await longCall;
  assert.deepEqual(await b.seal.sweep(), [], "just finished: quiet first");
  b.advance(60_000);
  assert.deepEqual(await b.seal.sweep(), ["agt_dex"]);
});

test("F8 (browser): a profile whose state says plain is found even when the browser container is down and its folder is empty", async () => {
  const dir = dirOf(); const b = browser(dir);
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie(`sid=${SECRET}`)); });
  assert.deepEqual(b.seal.pending(), ["agt_dex"], "the state file names it");
  b.f("agt_dex").clear();   // cleared while nothing watched
  b.advance(60_000);
  assert.deepEqual(await b.seal.sweep(), []);
  assert.deepEqual(b.seal.pending(), [], "a cleared hot profile with no data leaves no state behind");
});

test("F10 (browser): a profile that was restored and then cleared is not brought back", async () => {
  const dir = dirOf(); const b = browser(dir);
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie(`sid=${SECRET}`)); });
  b.advance(60_000); await b.seal.sweep();
  await b.tool("agt_dex", async () => { b.f("agt_dex").clear(); });   // restored, then the person cleared it
  b.advance(60_000); await b.seal.sweep();
  assert.equal(fs.existsSync(b.store.file("agt_dex")), false, "the old file is gone");
  await b.tool("agt_dex", async () => { assert.equal(b.f("agt_dex").size, 0, "nothing comes back"); });
});

test("F1 (browser): a profile over the cap is left plain and reported", async () => {
  const dir = dirOf(); const logs: Array<[string, string]> = []; const b = browser(dir, { cap: 1024, logs });
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Big", new Uint8Array(4096)); });
  b.advance(60_000);
  assert.deepEqual(await b.seal.sweep(), []);
  assert.equal(b.f("agt_dex").size, 1); assert.deepEqual(b.seal.oversize(), ["agt_dex"]);
  assert.ok(logs.some(([, m]) => m === "computers.browser.profile_too_large")); assert.ok(!b.calls.includes("reset agt_dex"));
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".profile") || n.endsWith(".tmp")), []);
});

test("F15: an import runs under the profile's lock: a sweep cannot seal and reset the folder in the middle of it, and the imported data is kept", async () => {
  const dir = dirOf(); const b = browser(dir);
  await b.tool("agt_dex", async () => { b.f("agt_dex").set("Default/Cookies", cookie("old")); });
  b.advance(60_000);
  let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; });
  const importing = b.seal.replace("agt_dex", async () => { b.f("agt_dex").clear(); await gate; b.f("agt_dex").set("Default/Cookies", cookie(`imported=${SECRET}`)); });
  await tick(20);
  const sweeping = b.seal.sweep();
  await tick(30);
  assert.ok(!b.calls.includes("read agt_dex"), "no read of the folder while the import is in the middle");
  release(); await importing; await sweeping;
  b.advance(60_000); await b.seal.sweep();
  await b.tool("agt_dex", async () => { assert.equal(text(b.f("agt_dex").get("Default/Cookies")), `imported=${SECRET}`, "the imported data survived"); });
});

test("F16 (browser): ids that browserd returns are checked, not rewritten: a bad one is logged and skipped", async () => {
  const dir = dirOf(); const logs: Array<[string, string]> = [];
  const b = browser(dir, { logs });
  const seal = createBrowserSeal({
    store: b.store, async read() { return { status: 404, body: Readable.from([]) as never }; }, async put() { return { status: 200 }; }, async reset() {}, async stop() {}, async guard() {},
    async rows() { return []; }, async disk() { return ["agt+dex", "agt_ok1"]; }, log: (l, m) => { logs.push([l, m]); },
  });
  await seal.sweep({ quiet: false });
  assert.ok(logs.some(([, m]) => m === "computers.browser.bad_profile_id"));
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes("agt+") || n.includes("agt_dex")), []);
});

test("peekTar hands back every byte of a stream, the looked-at start first", async () => {
  const tar = Buffer.from(profileTar());
  const p = await peekTar(Readable.from([tar.subarray(0, 300), tar.subarray(300, 700), tar.subarray(700)]) as never);
  assert.equal(p.empty, false);
  assert.ok(tar.equals(await drain(p.bytes)));
});

test("F8 (browser container): when the Space browser's container is down and a profile is plain, the sweep starts it again and seals the profile", async () => {
  const dir = dirOf(); const folder = new Map<string, Uint8Array>([["Default/Cookies", cookie(`sid=${SECRET}`)]]);
  let running = false; const starts: string[] = []; const ctl: string[] = []; let guard: boolean | undefined;
  const api = {
    async ping() { return true; }, async imageExists() { return true; }, async networkCreate() { throw new Error("no"); }, async networkRemove() {}, async containerCreate() { return "id"; },
    async containerStart(n: string) { starts.push(n); running = true; }, async containerStop() {}, async containerRemove() {}, async containerRunning() { return running; }, async putArchive() {},
    async exec(_n: string, a: { cmd: readonly string[] }) {
      const action = String(a.cmd[1]); ctl.push(action); const body = JSON.parse(String(a.cmd[2])) as { on?: boolean };
      if (action === "status") return { exitCode: 0, stdout: '{"profiles":[]}\n', stderr: "" };
      if (action === "disk") return { exitCode: 0, stdout: `${JSON.stringify({ ids: folder.size > 0 ? ["agt_dex"] : [] })}\n`, stderr: "" };
      if (action === "reset_chrome") { folder.clear(); return { exitCode: 0, stdout: "{}\n", stderr: "" }; }
      if (action === "guard") { guard = body.on; return { exitCode: 0, stdout: "{}\n", stderr: "" }; }
      return { exitCode: 0, stdout: "{}\n", stderr: "" };
    },
  };
  const http = (async () => ({ status: 200, body: new Uint8Array() })) as unknown as DockerHttp;
  http.stream = {
    async get() { return { status: 200, body: Readable.from([Buffer.from(tarFiles([...folder].map(([p, data]) => ({ path: `chrome/${p}`, data, mode: 0o600, uid: 10001, gid: 10001, mtime: 1 }))))]) as never }; },
    async put() { return { status: 200, body: new Uint8Array() }; },
  };
  createSealedStore({ key: () => key(1), dir: path.join(dir, "browser"), kind: "sbrowser" }).setState("agt_dex", "hot");   // the daemon was up, the profile was unsealed, then the container died
  const sb = createDockerSpaceBrowser({ api: api as never, http, profileSeal: { key: () => key(1), dir }, sealSweepMs: 0, sealQuietMs: 0, sleep: async () => {} });
  assert.deepEqual(await sb.sweep(), ["agt_dex"]);
  assert.deepEqual(starts, ["vyre-sbrowser"], "the container was started to seal it");
  assert.equal(folder.size, 0); assert.equal(guard, true);
  assert.ok(fs.existsSync(path.join(dir, "browser", "agt_dex.profile")));
  assert.deepEqual(await sb.sweep(), [], "nothing is left to do, and the container is not started again for nothing");
  running = false; starts.length = 0;
  assert.deepEqual(await sb.sweep(), []); assert.deepEqual(starts, []);
});

test("F1: a profile over the cap shows in the computers health, as a finding a person can see", async () => {
  const dir = dirOf(); const e = engine(dir);
  const id = CID("aaaa0101"); e.plant(id, { "chrome/Default/Big": "x".repeat(4 * 1024 * 1024) });
  const api = { async ping() { return true; }, async imageExists() { return true; }, async networkCreate() { throw new Error("no"); }, async networkRemove() {}, async containerCreate() { return "x"; }, async containerStart() {}, async containerStop() {}, async containerRemove() {}, async containerRunning() { return false; }, async exec() { return { exitCode: 0, stdout: "{}", stderr: "" }; }, async putArchive() {} };
  const host = createDockerComputerHost({ api: api as never, http: e.http, image: "img", profileSeal: { key: () => key(1), dir, cap: 1024 * 1024 }, user: { uid: 10001, gid: 10001 } });
  assert.equal((await host.health()).unsealed, undefined);
  await host.recover();
  const h = await host.health();
  assert.equal(h.ok, true); assert.equal(h.unsealed, 1);
  assert.match(String(h.detail), /1 saved browser profile is over the size limit and not locked/);
});
