// Device storage encryption (ARCH 5.10): key derivation, wrapping, rotation, engine choice, wrong-key refusal, replica profiles per device class.
// Engine doubles come from src/device/testing.ts: they enforce the keyed-file rules of SQLCipher and sqlite3mc, not byte encryption (that is spike S5 and P-PR_47b).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatHlc } from "../../lib/hlc.ts";
import {
  RECORDED_OUTCOME, REPLICA_KEY_BYTES, createReplicaKeyVault, createSealCodec, createSyncDriver, deriveReplicaKey, deviceClassOf, memoryKeyBox,
  openCipherOpfs, openDeviceReplica, openSqlCipher, rekeyCipherOpfs, rekeySqlCipher, selectEngine, slotOf, unlockSqlCipher,
} from "../src/device/index.ts";
import type { SpikeOutcome } from "../src/device/index.ts";
import { createFakeMc, createFakeSqlCipher } from "../src/device/testing.ts";
import { ReplicaError } from "../src/replica/types.ts";

const NOW = 1_700_000_000_000;
const hlc = (ms: number): string => formatHlc({ ms, counter: 1, deviceId: "dev1" });
const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-device-"));
const bytes = (n: number, fill: number): Uint8Array => new Uint8Array(n).fill(fill);
const code = (e: unknown): string => (e instanceof ReplicaError ? e.code : "other");
const refuses = async (f: () => unknown | Promise<unknown>, want: string): Promise<void> => {
  await assert.rejects(async () => { await f(); }, (e: unknown) => { assert.equal(code(e), want, e instanceof Error ? e.message : String(e)); return true; });
};

test("replicaKey is HKDF(personKey, replica || spaceId || deviceId) and differs per part", async () => {
  const person = bytes(32, 7);
  const k = await deriveReplicaKey(person, "spc_a", "dev_1");
  const want = new Uint8Array(crypto.hkdfSync("sha256", person, new Uint8Array(0), "replica\0spc_a\0dev_1", 32));
  assert.deepEqual(k, want);
  assert.equal(k.length, REPLICA_KEY_BYTES);
  assert.deepEqual(await deriveReplicaKey(person, "spc_a", "dev_1"), k);
  assert.notDeepEqual(await deriveReplicaKey(person, "spc_b", "dev_1"), k);
  assert.notDeepEqual(await deriveReplicaKey(person, "spc_a", "dev_2"), k);
  assert.notDeepEqual(await deriveReplicaKey(bytes(32, 8), "spc_a", "dev_1"), k);
  // The parts are separated: ("a","bc") is not ("ab","c").
  assert.notDeepEqual(await deriveReplicaKey(person, "a", "bc"), await deriveReplicaKey(person, "ab", "c"));
  await refuses(() => deriveReplicaKey(bytes(16, 1), "s", "d"), "bad_key");
  await refuses(() => deriveReplicaKey(person, "", "d"), "bad_key");
});

test("the wrapped key opens only with this device's wrapping key and holds no plaintext", async () => {
  const box = memoryKeyBox();
  const vault = createReplicaKeyVault(box);
  const key = await deriveReplicaKey(bytes(32, 1), "spc", "dev");
  await vault.store("spc:dev", key);
  assert.deepEqual(await vault.load("spc:dev"), key);
  assert.equal(await vault.load("spc:other"), null);
  assert.equal(await vault.has("spc:dev"), true);

  const wrap = (await box.get("wrap-key")) as { extractable: boolean; algorithm: { name: string } };
  assert.equal(wrap.extractable, false);
  assert.equal(wrap.algorithm.name, "AES-GCM");
  const blob = (await box.get("replica:spc:dev")) as { iv: Uint8Array; ct: Uint8Array };
  assert.equal(Buffer.from(blob.ct).includes(Buffer.from(key)), false);

  // another device's box (a different wrapping key) cannot open this device's blob
  const stranger = memoryKeyBox();
  const other = createReplicaKeyVault(stranger);
  await other.store("spc:other", bytes(32, 9));
  await stranger.put("replica:spc:dev", blob);
  await refuses(() => other.load("spc:dev"), "unwrap_failed");

  // the blob is bound to its slot: copied under another slot name it does not open
  await box.put("replica:spc:copy", blob);
  await refuses(() => vault.load("spc:copy"), "unwrap_failed");

  // a flipped byte fails the tag
  const bad = new Uint8Array(blob.ct);
  bad[0] = (bad[0] ?? 0) ^ 1;
  await box.put("replica:spc:dev", { v: 1, iv: blob.iv, ct: bad });
  await refuses(() => vault.load("spc:dev"), "unwrap_failed");

  // losing the wrapping key is a sign-in again, not a crash
  await box.put("replica:spc:dev", blob);
  await box.delete("wrap-key");
  await refuses(() => vault.load("spc:dev"), "unwrap_failed");
});

test("rewrap makes a new wrapping key; the old one no longer opens the blobs", async () => {
  const box = memoryKeyBox();
  const vault = createReplicaKeyVault(box);
  const a = bytes(32, 3);
  const b = bytes(32, 4);
  await vault.store("s:a", a);
  await vault.store("s:b", b);
  const oldWrap = (await box.get("wrap-key")) as Parameters<typeof crypto.subtle.decrypt>[1];
  const oldBlob = (await box.get("replica:s:a")) as { iv: Uint8Array; ct: Uint8Array };

  await vault.rewrap(["s:a", "s:b"]);
  assert.deepEqual(await vault.load("s:a"), a);
  assert.deepEqual(await vault.load("s:b"), b);
  const newWrap = await box.get("wrap-key");
  assert.notEqual(newWrap, oldWrap);
  assert.equal((newWrap as { extractable: boolean }).extractable, false);
  const newBlob = (await box.get("replica:s:a")) as { iv: Uint8Array; ct: Uint8Array };
  assert.notDeepEqual(newBlob.ct, oldBlob.ct);
  await assert.rejects(crypto.subtle.decrypt({ name: "AES-GCM", iv: newBlob.iv, additionalData: new TextEncoder().encode("vyre.replica.wrap\0s:a") }, oldWrap, newBlob.ct));
});

test("rotating a replica key re-encrypts first and stores the new key only after that succeeds", async () => {
  const vault = createReplicaKeyVault(memoryKeyBox());
  const oldKey = bytes(32, 5);
  const newKey = bytes(32, 6);
  await vault.store("s:d", oldKey);
  await assert.rejects(vault.rotate("s:d", newKey, async () => { throw new Error("disk full"); }), /disk full/);
  assert.deepEqual(await vault.load("s:d"), oldKey, "a failed rekey leaves the old key stored");

  let seen: [Uint8Array, Uint8Array] | null = null;
  await vault.rotate("s:d", newKey, async (o, n) => { seen = [new Uint8Array(o), new Uint8Array(n)]; });
  assert.deepEqual(seen, [oldKey, newKey]);
  assert.deepEqual(await vault.load("s:d"), newKey);
  await refuses(() => vault.rotate("s:none", newKey, async () => {}), "no_key");
  await refuses(() => vault.rotate("s:d", bytes(8, 1), async () => {}), "bad_key");
});

test("sign out deletes the wrapped key and, with no other slot left, the wrapping key", async () => {
  const box = memoryKeyBox();
  const vault = createReplicaKeyVault(box);
  await vault.store("s:a", bytes(32, 1));
  await vault.store("s:b", bytes(32, 2));
  await vault.wipe("s:a", { slots: ["s:a", "s:b"] });
  assert.equal(await vault.load("s:a"), null);
  assert.ok(await box.get("wrap-key"), "another slot still needs the wrapping key");
  assert.deepEqual(await vault.load("s:b"), bytes(32, 2));
  await vault.wipe("s:b", { slots: ["s:a", "s:b"] });
  assert.equal(await box.get("wrap-key"), undefined);
  await vault.store("s:c", bytes(32, 3));
  await vault.wipe("s:c", { all: true });
  assert.equal(await box.get("wrap-key"), undefined);
  assert.equal(await box.get("replica:s:c"), undefined);
});

test("SQLCipher: a wrong key, no key and a build without SQLCipher cannot read; rekey moves the file to the new key", async () => {
  const fake = createFakeSqlCipher(dir());
  const key = bytes(32, 0xa1);
  const driver = openSqlCipher({ open: fake.open, file: "r.db", key });
  driver.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
  driver.prepare("INSERT INTO t VALUES (?, ?)").run(["a", "secret"]);
  assert.equal(driver.prepare("SELECT v FROM t WHERE id = ?").get(["a"])?.v, "secret");
  driver.close();

  await refuses(() => openSqlCipher({ open: fake.open, file: "r.db", key: bytes(32, 0xb2) }), "wrong_key");
  await refuses(() => openSqlCipher({ open: fake.open, file: "r.db", key: bytes(16, 0xa1) }), "bad_key");
  const keyless = fake.open("r.db");
  assert.throws(() => keyless.prepareSync("SELECT v FROM t"), /not a database/, "a connection that never sent a key cannot read");
  keyless.closeSync();

  fake.withoutCipher = true;
  await refuses(() => openSqlCipher({ open: fake.open, file: "plain.db", key }), "no_cipher");
  fake.withoutCipher = false;

  const db = fake.open("r.db");
  unlockSqlCipher(db, key);
  const next = bytes(32, 0xc3);
  rekeySqlCipher(db, next);
  db.closeSync();
  await refuses(() => openSqlCipher({ open: fake.open, file: "r.db", key }), "wrong_key");
  const again = openSqlCipher({ open: fake.open, file: "r.db", key: next });
  assert.equal(again.prepare("SELECT v FROM t WHERE id = ?").get(["a"])?.v, "secret");
  again.close();
});

test("sqlite3mc on OPFS opens through the wrapper VFS; wrong key, no key and a stock VFS are refused", async () => {
  const fake = createFakeMc(dir());
  const key = bytes(32, 0x11);
  const open = (k: Uint8Array) => openCipherOpfs({ mod: fake.mod, vfs: "opfs-sahpool", file: "w.db", key: k });
  const d = open(key);
  d.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
  d.prepare("INSERT INTO t VALUES (?, ?)").run(["a", "secret"]);
  d.prepare("INSERT INTO t VALUES (?, ?)").run(["b", "other"]);
  assert.deepEqual(d.prepare("SELECT id FROM t ORDER BY id").all([]).map((r) => r.id), ["a", "b"]);
  d.close();

  open(key).close();
  assert.deepEqual(fake.vfsCreated, ["opfs-sahpool"], "the wrapper VFS is made once per module and name");
  await refuses(() => open(bytes(32, 0x22)), "wrong_key");
  await refuses(() => open(bytes(5, 1)), "bad_key");
  await refuses(() => openCipherOpfs({ mod: fake.mod, vfs: "opfs-sahpool", file: "../escape.db", key }), "bad_name");
  assert.throws(() => new fake.mod.oo1.DB("file:/w.db?vfs=opfs-sahpool"), /cipher VFS/, "the stock VFS cannot open a keyed file");

  const next = bytes(32, 0x33);
  const live = open(key);
  rekeyCipherOpfs(live, next);
  live.close();
  await refuses(() => open(key), "wrong_key");
  const moved = open(next);
  assert.equal(moved.prepare("SELECT v FROM t WHERE id = ?").get(["b"])?.v, "other");
  moved.close();
});

test("engine choice follows the recorded spike outcomes and falls back per REPORT.md", () => {
  assert.deepEqual(selectEngine("ios"), { engine: "sqlcipher-expo", fallback: false, reason: selectEngine("ios").reason });
  assert.equal(selectEngine("android").engine, "sqlcipher-expo");
  assert.equal(selectEngine("web").engine, "sqlite3mc-opfs");
  assert.equal(selectEngine("web").fallback, false);
  assert.equal(selectEngine("desktop-mac").engine, "sqlite3mc-opfs");
  assert.equal(selectEngine("desktop-windows").engine, "sqlite3mc-opfs");
  // Linux WebKitGTK was not run in S12: the recorded fallback is the sidecar
  const linux = selectEngine("desktop-linux");
  assert.equal(linux.engine, "sidecar-node-aes");
  assert.equal(linux.fallback, true);
  assert.match(linux.reason, /unknown/);

  const webFails: SpikeOutcome = { ...RECORDED_OUTCOME, webCipherOpfs: "fail" };
  const web = selectEngine("web", webFails);
  assert.equal(web.engine, "wa-sqlite-aes");
  assert.equal(web.fallback, true);
  assert.equal(selectEngine("desktop-mac", webFails).engine, "sidecar-node-aes");
  assert.equal(selectEngine("ios", webFails).engine, "sqlcipher-expo", "a phone never depends on the web probe");
  const shellFails: SpikeOutcome = { ...RECORDED_OUTCOME, shell: { mac: "fail", windows: "pass", linux: "pass" } };
  assert.equal(selectEngine("desktop-mac", shellFails).engine, "sidecar-node-aes");
  assert.equal(selectEngine("desktop-windows", shellFails).engine, "sqlite3mc-opfs");

  assert.equal(deviceClassOf("ios"), "phone");
  assert.equal(deviceClassOf("android"), "phone");
  assert.equal(deviceClassOf("web"), "web");
  assert.equal(deviceClassOf("desktop-mac"), "desktop");
  assert.equal(deviceClassOf("desktop-linux"), "desktop");
});

test("the fallback payload codec seals per row and refuses a wrong key or a moved payload", async () => {
  const codec = await createSealCodec(bytes(32, 1));
  const plain = new TextEncoder().encode("client note");
  const sealed = await codec.seal(plain, "row_1");
  assert.equal(Buffer.from(sealed).includes(Buffer.from(plain)), false);
  assert.deepEqual(await codec.open(sealed, "row_1"), plain);
  assert.notDeepEqual(await codec.seal(plain, "row_1"), sealed, "a fresh IV each time");
  await refuses(() => codec.open(sealed, "row_2"), "wrong_key");
  await refuses(async () => (await createSealCodec(bytes(32, 2))).open(sealed, "row_1"), "wrong_key");
  await refuses(() => codec.open(new Uint8Array(4), "row_1"), "wrong_key");
  await refuses(() => createSealCodec(bytes(8, 1)), "bad_key");
});

test("a device opens its replica: first sign-in makes and wraps the key, later opens need no personKey, sign out ends it", async () => {
  const fake = createFakeSqlCipher(dir());
  const vault = createReplicaKeyVault(memoryKeyBox());
  const base = {
    target: "ios" as const, spaceId: "spc_1", deviceId: "dev_1", vault, openers: { sqlcipher: { open: fake.open } }, registryHash: "hash-1", personId: "prs_me", clock: () => NOW,
  };
  await refuses(() => openDeviceReplica(base), "no_key");

  const first = await openDeviceReplica({ ...base, personKey: bytes(32, 9) });
  assert.equal(first.keyCreated, true);
  assert.equal(first.choice.engine, "sqlcipher-expo");
  assert.equal(first.store.deviceClass, "phone");
  assert.equal(first.store.write({ entity: "calendar", id: "cld_1", fields: { title: "Standup" }, hlc: hlc(1), actor: "usr_ada", origin: "mirror" }).applied, true);
  await first.store.flush();
  await first.store.close();
  assert.ok(await vault.has(slotOf("spc_1", "dev_1")));

  const second = await openDeviceReplica(base); // no personKey: the wrapped key is enough
  assert.equal(second.keyCreated, false);
  assert.equal(second.store.read("calendar", "cld_1")?.title, "Standup");
  await second.store.close();

  // a key from another person cannot open the same file
  const intruder = createReplicaKeyVault(memoryKeyBox());
  await refuses(() => openDeviceReplica({ ...base, vault: intruder, personKey: bytes(32, 10) }), "wrong_key");

  await vault.wipe(slotOf("spc_1", "dev_1"), { all: true });
  await refuses(() => openDeviceReplica(base), "no_key");
});

test("replica profiles hold on the encrypted engines: a phone refuses Restricted and above its ceiling, web and desktop stop at Restricted", async () => {
  const d = dir();
  const fakeSql = createFakeSqlCipher(d);
  const fakeMc = createFakeMc(d);
  const person = bytes(32, 4);
  const openers = { sqlcipher: { open: fakeSql.open }, sqlite3mc: { mod: fakeMc.mod, vfs: "opfs-sahpool" } };
  const phone = await openDeviceReplica({ target: "android", spaceId: "spc", deviceId: "p", file: "phone.db", vault: createReplicaKeyVault(memoryKeyBox()), personKey: person, openers, registryHash: "h", phoneCeiling: "internal", personId: "prs_me", clock: () => NOW });
  const web = await openDeviceReplica({ target: "web", spaceId: "spc", deviceId: "w", file: "web.db", vault: createReplicaKeyVault(memoryKeyBox()), personKey: person, openers, registryHash: "h", personId: "prs_me", clock: () => NOW });
  const mac = await openDeviceReplica({ target: "desktop-mac", spaceId: "spc2", deviceId: "m", file: "mac.db", vault: createReplicaKeyVault(memoryKeyBox()), personKey: person, openers, registryHash: "h", personId: "prs_me", clock: () => NOW });
  try {
    assert.equal(web.choice.engine, "sqlite3mc-opfs");
    assert.equal(mac.choice.engine, "sqlite3mc-opfs");
    assert.deepEqual([phone.store.deviceClass, web.store.deviceClass, mac.store.deviceClass], ["phone", "web", "desktop"]);
    const w = (id: string, label: "internal" | "confidential" | "restricted") => ({ entity: "calendar", id, fields: { title: id }, hlc: hlc(5), actor: "usr_ada", origin: "mirror" as const, label });
    assert.equal(phone.store.write(w("cld_i", "internal")).applied, true);
    assert.equal(phone.store.write(w("cld_c", "confidential")).reason, "above_label");
    assert.equal(phone.store.write(w("cld_r", "restricted")).reason, "restricted");
    for (const s of [web.store, mac.store]) {
      assert.equal(s.write(w("cld_c", "confidential")).applied, true);
      assert.equal(s.write(w("cld_r", "restricted")).reason, "restricted");
      assert.equal(s.read("calendar", "cld_r"), null);
    }
    assert.equal(phone.store.read("calendar", "cld_c"), null);
  } finally {
    await phone.store.close();
    await web.store.close();
    await mac.store.close();
  }
});

test("a fallback engine with no wiring says so instead of opening a plaintext store", async () => {
  const vault = createReplicaKeyVault(memoryKeyBox());
  const outcome: SpikeOutcome = { ...RECORDED_OUTCOME, webCipherOpfs: "fail" };
  await refuses(() => openDeviceReplica({ target: "web", spaceId: "s", deviceId: "d", vault, personKey: bytes(32, 1), openers: {}, registryHash: "h", outcome }), "engine_missing");
  await refuses(() => openDeviceReplica({ target: "ios", spaceId: "s", deviceId: "d", vault, personKey: bytes(32, 1), openers: {}, registryHash: "h" }), "engine_missing");
  assert.equal(typeof createSyncDriver, "function");
});
