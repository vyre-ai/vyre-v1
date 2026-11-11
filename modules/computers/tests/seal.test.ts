// A browser profile at rest (handlers/seal.ts, sbrowser/seal.ts) against scripted Engines: the sealed form opens only with the right key, computer and order; a sealed file holds no plain text; a wrong key
// fails closed and leaves everything as it was; a crash between unseal and seal is sealed at the next start before anything else reads it; a computer that never had a profile still starts; a profile made before
// sealing existed is sealed at its first sleep without losing anything; the Space browser's profiles follow the same rules.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tarFiles, untar } from "../../../sandbox/src/tar.ts";
import type { DockerHttp, DockerRequest } from "../../../sandbox/src/docker.ts";
import { createProfileSeal, createSealedStore, openBytes, sealBytes, tarEntries, UNOPENED, CHUNK } from "../handlers/seal.ts";
import { createBrowserSeal } from "../sbrowser/seal.ts";
import type { ProfileRow } from "../sbrowser/port.ts";

const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);
const big = (): Uint8Array => Uint8Array.from({ length: 2 * CHUNK + 1000 }, (_, i) => (i * 31) & 255);
const file = (p: string, text: string) => ({ path: p, data: new TextEncoder().encode(text), mode: 0o600, uid: 10001, gid: 10001, mtime: 1 });
const dirOf = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-seal-"));
const PLANTED = "PLANTED-COOKIE-7f3a91";
const profileTar = (): Uint8Array => tarFiles([file("chrome/Default/Cookies", `session=${PLANTED}`), file("chrome/Default/Login Data", `user=dana password=${PLANTED}`)]);

test("a profile opens with the same key, kind and profile, small, empty and across chunks, and the sealed bytes hold none of it", () => {
  for (const plain of [new Uint8Array(0), new TextEncoder().encode(`cookies ${PLANTED}`), big()]) {
    const sealed = sealBytes(plain, key(1), "computers", "cmt_a");
    assert.ok(Buffer.from(plain).equals(openBytes(sealed, key(1), "computers", "cmt_a")));
    assert.ok(!sealed.includes(PLANTED) && !sealed.includes("cookies"));
  }
  const tar = profileTar();
  const sealed = sealBytes(tar, key(1), "sbrowser", "agt_a");
  assert.ok(!sealed.includes(PLANTED) && !sealed.includes("Cookies") && !sealed.includes("Login Data") && !sealed.includes("chrome/"), "no readable file name or content");
});

test("a wrong key, another profile or kind, a cut file, dropped, swapped or flipped chunks are refused", () => {
  const sealed = sealBytes(big(), key(1), "computers", "cmt_a");
  const lines = sealed.toString("utf8").split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 3);
  const text = (ls: string[]): Buffer => Buffer.from(`${ls.join("\n")}\n`);
  assert.throws(() => openBytes(sealed, key(2), "computers", "cmt_a"), "wrong key");
  assert.throws(() => openBytes(sealed, key(1), "computers", "cmt_b"), "another computer");
  assert.throws(() => openBytes(sealed, key(1), "sbrowser", "cmt_a"), "another kind");
  assert.throws(() => openBytes(text(lines.slice(0, 2)), key(1), "computers", "cmt_a"), "cut after chunk 2");
  assert.throws(() => openBytes(text([lines[0]!, lines[2]!]), key(1), "computers", "cmt_a"), "a chunk dropped");
  assert.throws(() => openBytes(text([lines[1]!, lines[0]!, lines[2]!]), key(1), "computers", "cmt_a"), "chunks swapped");
  assert.throws(() => openBytes(Buffer.from("\n"), key(1), "computers", "cmt_a"), "nothing at all");
  const flipped = Buffer.from(sealed); const at = Math.floor(flipped.length / 2); flipped[at] = flipped[at] === 65 ? 66 : 65;
  assert.throws(() => openBytes(flipped, key(1), "computers", "cmt_a"), "one byte changed");
});

test("an emptied volume reads as a tar of nothing, a profile with files does not", () => {
  assert.equal(tarEntries(tarFiles([])), 0);
  assert.equal(tarEntries(new Uint8Array(1024)), 0);
  assert.equal(tarEntries(tarFiles([file("Cookies", "x"), file("marker.txt", "x")])), 2);
  assert.equal(tarEntries(tarFiles([file("Default/Cookies", "x")])), 2, "the folder and the file");
});

// ---- an agent computer's profile disk against a scripted Engine -----------------------------------------------------------------------------------------

/** An Engine with computers whose profile volume is a map of files; archive reads and writes it, the wipe helper empties it. */
function engine(dir: string) {
  const volumes = new Map<string, Map<string, Uint8Array>>();   // container name -> files under .profile-disk
  const running = new Set<string>();
  const containers = new Set<string>();
  const helpers = new Map<string, string>();                     // helper name -> computer container
  const calls: string[] = [];
  let wipeExit = 0;
  let failWipeOnce = false;
  const vol = (c: string): Map<string, Uint8Array> => { let v = volumes.get(c); if (!v) { v = new Map(); volumes.set(c, v); } return v; };
  const json = (v: unknown, status = 200) => ({ status, body: new TextEncoder().encode(JSON.stringify(v)) });
  const http: DockerHttp = async (r: DockerRequest) => {
    const m = /^\/containers\/([^/]+)\/(archive|start|wait)$/.exec(r.path);
    calls.push(`${r.method} ${r.path}`);
    if (r.method === "GET" && r.path === "/containers/json") {
      return json([...containers].map((n) => ({ State: running.has(n) ? "running" : "exited", Labels: { "vyre.computer": `cmt_${n.replace(/^vyre-comp-/, "")}` } })));
    }
    if (r.method === "POST" && r.path === "/containers/create") {
      const name = r.query?.["name"] ?? "";
      const body = r.json as { Labels?: Record<string, string>; HostConfig?: { VolumesFrom?: string[] }; Cmd?: string[] };
      assert.equal(body.Labels?.["vyre.helper"], "seal-rm", "the wipe helper carries its own label");
      assert.deepEqual(body.Cmd, ["find", "/home/agent/.profile-disk", "-mindepth", "1", "-delete"]);
      helpers.set(name, body.HostConfig!.VolumesFrom![0]!);
      return { status: 201, body: new Uint8Array() };
    }
    if (r.method === "DELETE") return { status: 204, body: new Uint8Array() };
    if (!m) return { status: 404, body: new Uint8Array() };
    const [, name, action] = m as unknown as [string, string, string];
    if (action === "archive" && r.method === "GET") {
      if (!containers.has(name)) return { status: 404, body: new Uint8Array() };
      return { status: 200, body: tarFiles([...vol(name)].map(([p, data]) => ({ path: p, data, mode: 0o600, uid: 10001, gid: 10001, mtime: 1 }))) };
    }
    if (action === "archive" && r.method === "PUT") { for (const e of untar(r.body!)) if (e.type === "file") vol(name).set(e.path, e.data); return { status: 200, body: new Uint8Array() }; }
    if (action === "start") return { status: 204, body: new Uint8Array() };
    if (action === "wait") {
      if (failWipeOnce) { failWipeOnce = false; return json({ StatusCode: 1 }); }
      if (wipeExit === 0) vol(helpers.get(name)!).clear();
      return json({ StatusCode: wipeExit });
    }
    return { status: 404, body: new Uint8Array() };
  };
  const seal = (k = key(1)) => createProfileSeal({ http, key: () => k, dir, container: (id) => `vyre-comp-${id.replace(/^cmt_/, "")}`, image: "img", user: { uid: 10001, gid: 10001 } });
  return {
    http, seal, volumes, running, containers, calls, vol,
    failWipeOnce() { failWipeOnce = true; },
    plant(id: string, files: Record<string, string>) { const n = `vyre-comp-${id.replace(/^cmt_/, "")}`; containers.add(n); for (const [p, t] of Object.entries(files)) vol(n).set(p, new TextEncoder().encode(t)); return n; },
  };
}
const planted = { "chrome/Default/Cookies": `session=${PLANTED}`, "chrome/Default/Login Data": `password=${PLANTED}` };

test("sleep seals the profile and empties the volume, wake puts back the same bytes", async () => {
  const dir = dirOf();
  const e = engine(dir);
  const name = e.plant("cmt_aaaa1111", planted);
  const s = e.seal();
  await s.unseal("cmt_aaaa1111");   // the computer's first wake: nothing sealed yet, only marked as plain
  assert.equal(s.state("cmt_aaaa1111"), "hot");
  await s.seal("cmt_aaaa1111");
  assert.equal(e.vol(name).size, 0, "the volume is empty while the computer sleeps");
  assert.equal(s.state("cmt_aaaa1111"), "sealed");
  const sealed = fs.readFileSync(path.join(dir, "cmt_aaaa1111.profile"));
  assert.ok(!sealed.includes(PLANTED) && !sealed.includes("Cookies") && !sealed.includes("Login"), "the sealed file holds nothing readable");
  assert.equal(fs.statSync(path.join(dir, "cmt_aaaa1111.profile")).mode & 0o077, 0, "private to the daemon's user");
  await s.unseal("cmt_aaaa1111");
  assert.equal(new TextDecoder().decode(e.vol(name).get("chrome/Default/Login Data")), `password=${PLANTED}`, "the wake puts the profile back");
  assert.equal(s.state("cmt_aaaa1111"), "hot");
});

test("a wrong key or a changed file fails closed: nothing is put back, the sealed file and the state stay as they were", async () => {
  const dir = dirOf();
  const e = engine(dir);
  const name = e.plant("cmt_bbbb2222", planted);
  await e.seal().seal("cmt_bbbb2222");
  const f = path.join(dir, "cmt_bbbb2222.profile");
  const before = fs.readFileSync(f);
  await assert.rejects(e.seal(key(9)).unseal("cmt_bbbb2222"), (err: Error) => err.message === UNOPENED, "another key");
  assert.equal(e.vol(name).size, 0, "nothing was put on the volume");
  assert.equal(e.seal().state("cmt_bbbb2222"), "sealed", "no state file was written");
  assert.ok(fs.readFileSync(f).equals(before), "the sealed data is untouched");
  const cut = Buffer.from(before.subarray(0, Math.floor(before.length / 2)));
  fs.writeFileSync(f, cut);
  await assert.rejects(e.seal().unseal("cmt_bbbb2222"), (err: Error) => err.message === UNOPENED, "a cut file");
  assert.ok(fs.readFileSync(f).equals(cut), "even a bad file is left as it is");
  assert.equal(e.vol(name).size, 0);
  fs.writeFileSync(f, before);
  await e.seal().unseal("cmt_bbbb2222");
  assert.equal(e.vol(name).size, 2, "the right file opens");
});

test("a crash between unseal and seal: the next start seals the plain profile before anything reads it", async () => {
  const dir = dirOf();
  const e = engine(dir);
  const name = e.plant("cmt_cccc3333", planted);
  await e.seal().seal("cmt_cccc3333");
  await e.seal().unseal("cmt_cccc3333");
  assert.equal(e.vol(name).size, 2, "woken: plain on the volume");
  // the daemon and the computer die here; a new daemon boots
  const after = e.seal();
  assert.equal(after.state("cmt_cccc3333"), "hot", "the state file says the plain profile is the truth");
  e.vol(name).set("chrome/Default/Cookies", new TextEncoder().encode(`newer=${PLANTED}`));
  assert.deepEqual(await after.recoverStopped(), ["cmt_cccc3333"]);
  assert.equal(e.vol(name).size, 0, "emptied at boot");
  await after.unseal("cmt_cccc3333");
  assert.equal(new TextDecoder().decode(e.vol(name).get("chrome/Default/Cookies")), `newer=${PLANTED}`, "the newest state was sealed, not the one before");
  // a computer that is running at boot is left alone
  e.running.add(name);
  assert.deepEqual(await e.seal().recoverStopped(), []);
  assert.equal(e.vol(name).size, 2);
});

test("a crash during the wipe: the boot finishes the wipe and never reseals a half-emptied volume over the full file", async () => {
  const dir = dirOf();
  const e = engine(dir);
  const name = e.plant("cmt_dddd4444", planted);
  e.failWipeOnce();
  await assert.rejects(e.seal().seal("cmt_dddd4444"), /not emptied/);
  assert.equal(e.seal().state("cmt_dddd4444"), "wiping", "the sealed file is complete; only the volume is left");
  e.vol(name).delete("chrome/Default/Cookies");   // the wipe had got part of the way
  assert.deepEqual(await e.seal().recoverStopped(), ["cmt_dddd4444"]);
  assert.equal(e.vol(name).size, 0);
  await e.seal().unseal("cmt_dddd4444");
  assert.equal(e.vol(name).size, 2, "the full profile comes back, both files, from the complete sealed file");
});

test("a computer that never had a profile still starts, and an empty sleep does not replace a sealed profile with nothing", async () => {
  const dir = dirOf();
  const e = engine(dir);
  const name = e.plant("cmt_eeee5555", {});
  const s = e.seal();
  await s.unseal("cmt_eeee5555");   // no sealed file: nothing to open, nothing thrown
  assert.equal(e.vol(name).size, 0);
  assert.deepEqual(await e.seal().recoverStopped(), [], "an empty volume is left alone at boot");
  await s.seal("cmt_eeee5555");
  // now a computer with a real sealed profile whose volume reads empty at the next sleep (it was woken and slept with nothing written)
  const f = e.plant("cmt_ffff6666", planted);
  await s.seal("cmt_ffff6666");
  const real = fs.readFileSync(path.join(dir, "cmt_ffff6666.profile"));
  await s.unseal("cmt_ffff6666"); e.vol(f).clear();
  await s.seal("cmt_ffff6666");
  assert.ok(fs.readFileSync(path.join(dir, "cmt_ffff6666.profile")).equals(real), "the sealed profile with data is kept");
});

test("a profile that was plain before sealing existed is sealed at its first sleep and at the next boot, without losing a sign-in", async () => {
  const dir = dirOf();
  const e = engine(dir);
  const a = e.plant("cmt_gggg7777", planted);     // never slept since the update: no file, no state
  const b = e.plant("cmt_hhhh8888", planted);     // asleep through the update: its container is stopped with a plain volume
  const s = e.seal();
  assert.equal(s.state("cmt_gggg7777"), "none");
  await s.seal("cmt_gggg7777");                    // the first sleep after the update
  assert.equal(e.vol(a).size, 0);
  await s.unseal("cmt_gggg7777");
  assert.equal(new TextDecoder().decode(e.vol(a).get("chrome/Default/Cookies")), `session=${PLANTED}`, "the sign-in survived the migration");
  assert.ok(!fs.readFileSync(path.join(dir, "cmt_gggg7777.profile")).includes(PLANTED));
  e.running.add(a);
  assert.deepEqual(await e.seal().recoverStopped(), ["cmt_hhhh8888"], "the stopped computer with a plain volume is sealed at boot, the running one is not");
  assert.equal(e.vol(b).size, 0);
  assert.equal(e.vol(a).size, 2);
});

test("a removed computer's sealed profile goes with it, the previous copy too", async () => {
  const dir = dirOf();
  const e = engine(dir);
  e.plant("cmt_iiii9999", planted);
  const s = e.seal();
  await s.seal("cmt_iiii9999"); await s.unseal("cmt_iiii9999"); await s.seal("cmt_iiii9999");
  assert.ok(fs.existsSync(path.join(dir, "cmt_iiii9999.profile.prev")), "one earlier generation is kept");
  await s.discard("cmt_iiii9999");
  assert.deepEqual(fs.readdirSync(dir), []);
});

// ---- the Space browser's profiles ----------------------------------------------------------------------------------------------------------------------

function browser(dir: string, k = key(1)) {
  const folders = new Map<string, Map<string, Uint8Array>>();   // profile -> files under chrome/
  const rows = new Map<string, ProfileRow>();
  const f = (id: string): Map<string, Uint8Array> => { let v = folders.get(id); if (!v) { v = new Map(); folders.set(id, v); } return v; };
  let clock = 1_000_000;
  const store = createSealedStore({ key: () => k, dir, kind: "sbrowser" });
  const seal = createBrowserSeal({
    store, now: () => clock, quietMs: 20_000,
    async read(id) { return f(id).size === 0 ? null : tarFiles([...f(id)].map(([p, data]) => ({ path: `chrome/${p}`, data, mode: 0o600, uid: 10001, gid: 10001, mtime: 1 }))); },
    async put(id, tar) { for (const e of untar(tar)) if (e.type === "file") f(id).set(e.path.replace(/^chrome\//, ""), e.data); },
    async reset(id) { f(id).clear(); const r = rows.get(id); if (r) r.running = false; },
    async stop(id) { const r = rows.get(id); if (r) r.running = false; },
    async rows() { return [...rows.values()]; },
    async disk() { return [...folders].filter(([, v]) => v.size > 0).map(([id]) => id); },
  });
  const row = (id: string, o: Partial<ProfileRow> = {}): void => { rows.set(id, { profileId: id, running: false, tabs: 0, busy: false, takeover: false, viewers: 0, lastActiveAt: 0, held: 0, paused: false, ...o }); };
  return { seal, store, f, row, rows, advance(ms: number) { clock += ms; }, k };
}

test("browser: an idle profile is sealed and gone from the volume, the next call puts it back; a running one and a quiet-for-seconds one are left alone", async () => {
  const dir = dirOf();
  const b = browser(dir);
  await b.seal.plain("agt_dex");                                   // first use: nothing sealed, marked plain
  b.f("agt_dex").set("Default/Cookies", new TextEncoder().encode(`sid=${PLANTED}`));
  b.row("agt_dex", { running: true, lastActiveAt: 1_000_000 });
  assert.deepEqual(await b.seal.sweep(), [], "a running browser is never sealed");
  b.rows.get("agt_dex")!.running = false;
  assert.deepEqual(await b.seal.sweep(), [], "just stopped: given a few seconds first (a viewer attaches right after a stream call)");
  b.advance(25_000);
  assert.deepEqual(await b.seal.sweep(), ["agt_dex"]);
  assert.equal(b.f("agt_dex").size, 0, "the Chrome folder is gone from the volume");
  const sealed = fs.readFileSync(b.store.file("agt_dex"));
  assert.ok(!sealed.includes(PLANTED) && !sealed.includes("Cookies"), "and the sealed file holds nothing readable");
  await b.seal.plain("agt_dex");
  assert.equal(new TextDecoder().decode(b.f("agt_dex").get("Default/Cookies")), `sid=${PLANTED}`, "the sign-in came back");
});

test("browser: a wrong key fails closed and leaves the sealed profile and the volume as they were; a browser that started over a sealed profile is stopped and emptied first", async () => {
  const dir = dirOf();
  const b = browser(dir);
  await b.seal.plain("agt_dex");
  b.f("agt_dex").set("Default/Cookies", new TextEncoder().encode(`sid=${PLANTED}`));
  b.advance(60_000);
  await b.seal.sweep();
  const sealedBefore = fs.readFileSync(b.store.file("agt_dex"));
  const wrong = browser(dir, key(7));
  await assert.rejects(wrong.seal.plain("agt_dex"), (e: Error) => e.message === UNOPENED);
  assert.ok(fs.readFileSync(b.store.file("agt_dex")).equals(sealedBefore));
  assert.equal(wrong.store.state("agt_dex"), "sealed");
  // a viewer's wake started a browser on an empty folder while the profile was sealed
  b.row("agt_dex", { running: true });
  b.f("agt_dex").set("Default/Cookies", new TextEncoder().encode("fresh=1"));
  await b.seal.plain("agt_dex");
  assert.equal(new TextDecoder().decode(b.f("agt_dex").get("Default/Cookies")), `sid=${PLANTED}`, "what was sealed is what comes back, not the empty session");
  assert.equal(b.rows.get("agt_dex")!.running, false);
});

test("browser: a crash while the profile was plain is sealed at the next start, a profile from before sealing is sealed, and the previous copy survives a bad seal", async () => {
  const dir = dirOf();
  const first = browser(dir);
  await first.seal.plain("agt_dex");          // woken: the state file says the plain profile is the truth; then the daemon dies
  const after = browser(dir);
  after.f("agt_dex").set("Default/Cookies", new TextEncoder().encode(`sid=${PLANTED}`));
  after.f("agt_old").set("Default/Cookies", new TextEncoder().encode(`legacy=${PLANTED}`));   // made before sealing existed: no file, no state
  assert.deepEqual((await after.seal.recover()).sort(), ["agt_dex", "agt_old"]);
  assert.equal(after.f("agt_dex").size + after.f("agt_old").size, 0);
  await after.seal.plain("agt_old");
  assert.equal(new TextDecoder().decode(after.f("agt_old").get("Default/Cookies")), `legacy=${PLANTED}`);
  // imported Chrome data replaces the profile: the old sealed copy is not kept
  await after.seal.imported("agt_dex");
  assert.equal(after.store.hasFile("agt_dex"), false);
  assert.equal(after.store.state("agt_dex"), "hot");
});
