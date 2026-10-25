// P-L1_05: the client purge (ARCH 5.7) on a real replica file: every table, the FTS index, saved and open documents, the file cache and the outbox go; the keychain and the local folder go with them;
// the outbox survives as a Rejected archive only for a person who is still active. Also: hide frames take a row's documents and files with them, and the three purge signals act once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatHlc } from "../../../lib/hlc.ts";
import { createNodeDriver, openReplica } from "../../../sync/src/replica/index.ts";
import type { ReplicaStore, SqlDriver } from "../../../sync/src/replica/index.ts";
import { PurgeError, applyHides, createPurgeClient, docPrefix, purgeReplica, replicaTables } from "../../../sync/src/purge/index.ts";
import type { OpenDocs, PurgeStatus } from "../../../sync/src/purge/index.ts";

const ENT = "note_board";
const ACTOR = "usr_ada";
const NOW = 1_760_000_000_000;
const hl = (n: number): string => formatHlc({ ms: NOW + n, counter: 0, deviceId: "dev1" });

function scratch(): string {
  return path.join(os.tmpdir(), `vyre-purge-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}.db`);
}
function wipe(file: string): void {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
}

interface Dev { file: string; driver: SqlDriver; store: ReplicaStore }
function open(file = scratch()): Dev {
  const driver = createNodeDriver(file);
  const store = openReplica({ driver, deviceClass: "desktop", registryHash: "h1", personId: ACTOR, clock: () => NOW });
  return { file, driver, store };
}
const count = (d: SqlDriver, table: string): number => Number(d.prepare(`SELECT count(*) AS n FROM "${table}"`).get([])?.n ?? 0);

/** A replica holding what a working device holds: rows with search entries, a queued edit, saved documents, a cached file, a conflict and an old Rejected entry. */
function working(): Dev {
  const d = open();
  d.store.write({ entity: ENT, id: "n1", fields: { title: "Alpha plan", body: "one" }, hlc: hl(1), actor: ACTOR, origin: "mirror", seq: 1 });
  d.store.write({ entity: ENT, id: "n2", fields: { title: "Beta plan", body: "two" }, hlc: hl(2), actor: ACTOR, origin: "mirror", seq: 2, starred: true });
  d.store.write({
    entity: ENT, id: "n1", fields: { title: "Alpha plan edited" }, hlc: hl(3), actor: ACTOR,
    op: { opId: "op_1", traceId: "0123456789abcdef0123456789abcdef", cap: "records.update", v: 1, input: JSON.stringify({ fields: { title: "Alpha plan edited" } }), baseSeq: "{}" },
  });
  d.store.putBlob("blob_a", new Uint8Array([1, 2, 3]));
  const doc = d.driver.prepare("INSERT INTO doc_local (doc, state, sv, dirty) VALUES (?, ?, ?, ?)");
  doc.run([docPrefix(ENT, "n1"), new Uint8Array([1]), new Uint8Array([2]), 1]);
  doc.run([`${docPrefix(ENT, "n1")}:body`, new Uint8Array([3]), new Uint8Array([4]), 0]);
  d.driver.prepare("INSERT INTO conflicts_local (id, entity, row_id, field, ours, theirs, base, state, plain_choice, summary, at) VALUES ('c1', ?, 'n1', 'title', 'a', 'b', 'c', 'open', 0, '', 1)").run([ENT]);
  d.driver.prepare("INSERT INTO rejected (op_id, error, copy_out, at) VALUES ('op_old', '{\"code\":\"permission.no_grant\"}', '{}', 1)").run([]);
  return d;
}

interface Spy { keychain: number; folder: number; closedAll: number; statuses: PurgeStatus[] }
function spies(over: { keychain?: () => void } = {}): { spy: Spy; ports: { keychain: { removeAll(): void }; folder: { wipe(): void }; docs: OpenDocs; status(s: PurgeStatus): void } } {
  const spy: Spy = { keychain: 0, folder: 0, closedAll: 0, statuses: [] };
  return {
    spy,
    ports: {
      keychain: { removeAll() { spy.keychain += 1; over.keychain?.(); } },
      folder: { wipe() { spy.folder += 1; } },
      docs: { closeFor() {}, closeAll() { spy.closedAll += 1; } },
      status: (s) => { spy.statuses.push(s); },
    },
  };
}

test("purge for an active person: all replica data is gone after a reopen, unsent edits wait in Rejected, keychain and folder are cleared", async () => {
  const d = working();
  assert.equal(d.store.pendingCount(), 1);
  const { spy, ports } = spies();
  const report = await purgeReplica({ driver: d.driver, store: d.store, reason: "revoked", epoch: 3, personActive: true, now: () => NOW, ...ports });
  assert.equal(report.archived, 1);
  assert.equal(report.keychain && report.folder && report.docsClosed, true);
  assert.deepEqual([spy.keychain, spy.folder, spy.closedAll], [1, 1, 1]);
  assert.deepEqual(spy.statuses.map((s) => s.state), ["purging", "purged"]);
  assert.throws(() => d.store.read(ENT, "n1"), /closed/, "the closed store cannot answer from its read cache");

  const back = open(d.file);
  assert.equal(back.store.upgraded, false);
  for (const t of replicaTables()) if (t !== "rejected") assert.equal(count(back.driver, t), 0, `${t} is empty`);
  assert.equal(back.store.read(ENT, "n1"), null);
  assert.equal(back.store.readFts(ENT, "n1"), null);
  assert.equal(back.store.getBlob("blob_a"), null);
  assert.equal(back.store.pendingCount(), 0);
  assert.equal(back.store.getState("registry_hash"), "h1", "the schema stamp stays so the file reopens");
  assert.equal(back.store.getState("purged_epoch"), "3");
  assert.equal(back.store.getState("needs_snapshot"), "1", "a person who signs in again takes a snapshot");
  const kept = back.driver.prepare("SELECT op_id, error, copy_out FROM rejected ORDER BY op_id").all([]);
  assert.deepEqual(kept.map((r) => r["op_id"]), ["op_1", "op_old"], "the old entry and the unsent edit");
  const archived = kept[0]!;
  assert.equal((JSON.parse(String(archived["error"])) as { code: string }).code, "sync.purged");
  const copy = JSON.parse(String(archived["copy_out"])) as { cap: string; id: string; input: string };
  assert.equal(copy.cap, "records.update");
  assert.match(copy.input, /Alpha plan edited/, "the person can copy their words out");
  await back.store.close();
  wipe(d.file);
});

test("purge for a person who is no longer active deletes the outbox and the Rejected list too", async () => {
  const d = working();
  const { ports } = spies();
  const report = await purgeReplica({ driver: d.driver, store: d.store, reason: "leave", epoch: 4, personActive: false, ...ports });
  assert.equal(report.archived, null);
  const back = open(d.file);
  for (const t of replicaTables()) assert.equal(count(back.driver, t), 0, `${t} is empty`);
  assert.equal(back.store.getState("purged_epoch"), "4");
  await back.store.close();
  wipe(d.file);
});

test("a step that fails does not stop the others, and the failure is reported", async () => {
  const d = working();
  const { spy, ports } = spies({ keychain: () => { throw new Error("keychain locked"); } });
  await assert.rejects(
    purgeReplica({ driver: d.driver, store: d.store, reason: "revoked", epoch: 5, personActive: true, ...ports }),
    (e: unknown) => e instanceof PurgeError && e.code === "purge_incomplete" && e.report.errors.some((m) => /keychain locked/.test(m)) && e.report.keychain === false,
  );
  assert.equal(spy.folder, 1, "the folder was still wiped");
  assert.deepEqual(spy.statuses.map((s) => s.state), ["purging", "failed"]);
  const back = open(d.file);
  assert.equal(count(back.driver, `rt_${ENT}`), 0, "and the replica was still emptied");
  await back.store.close();
  wipe(d.file);
});

test("the three signals (hello, pull reset, live frame) purge once per epoch; an old epoch and other frames do nothing; leaving takes the same path", async () => {
  const d = open();
  d.store.write({ entity: ENT, id: "n1", fields: { title: "Alpha" }, hlc: hl(1), actor: ACTOR, origin: "mirror", seq: 1 });
  const { spy, ports } = spies();
  const asked: string[] = [];
  const c = createPurgeClient({
    purge: { driver: d.driver, keychain: ports.keychain, folder: ports.folder, docs: ports.docs, status: ports.status },
    personActive: (reason) => { asked.push(reason); return true; },
    currentEpoch: () => 4,
  });
  assert.equal(c.purged(), false);
  assert.equal(await c.onFrame({ t: "hb", seq: 1 }), null);
  assert.equal(await c.onHello({ mode: "live", epoch: 9 }), null);
  assert.equal(await c.onPull({ epoch: 9 }), null);
  assert.equal(await c.onFrame({ t: "purge", epoch: 3 }), null, "an epoch below the device's own is stale");
  const [a, b] = await Promise.all([c.onFrame({ t: "purge", epoch: 5 }), c.onPull({ reset: "purge", epoch: 5 })]);
  assert.ok(a && b);
  assert.equal(a, b, "the second signal gets the first purge's report");
  assert.equal(spy.keychain, 1);
  assert.deepEqual(asked, ["revoked"]);
  assert.equal(c.purged(), true);
  assert.equal(count(d.driver, `rt_${ENT}`), 0);
  assert.equal(await c.onHello({ mode: "purge", epoch: 5 }), null, "already purged for this epoch");
  const next = await c.onHello({ mode: "purge", epoch: 6 });
  assert.equal(next?.epoch, 6);
  const left = await c.leave(7);
  assert.equal(left.reason, "leave");
  assert.deepEqual(asked, ["revoked", "revoked", "leave"]);
  assert.equal(spy.folder, 3);
  d.driver.close();
});

test("hide frames take a row's saved documents, open documents and listed files with them, and leave a row whose id only starts the same", async () => {
  const d = open();
  for (const [i, id] of ["n1", "n10"].entries()) d.store.write({ entity: ENT, id, fields: { title: `Row ${id}` }, hlc: hl(i + 1), actor: ACTOR, origin: "mirror", seq: i + 1 });
  const doc = d.driver.prepare("INSERT INTO doc_local (doc, state, sv, dirty) VALUES (?, ?, ?, ?)");
  for (const id of ["n1", "n10"]) { doc.run([docPrefix(ENT, id), new Uint8Array([1]), new Uint8Array([2]), 0]); doc.run([`${docPrefix(ENT, id)}:body`, new Uint8Array([3]), new Uint8Array([4]), 0]); }
  d.store.putBlob("file_n1", new Uint8Array([9]));
  d.store.putBlob("file_n10", new Uint8Array([8]));
  const closed: string[] = [];
  const docs: OpenDocs = { closeFor: (e, id) => { closed.push(`${e}/${id}`); }, closeAll() {} };
  const report = await applyHides(d.store, [{ entity: ENT, id: "n1", seq: 10 }], { driver: d.driver, docs, blobHashes: (_e, row) => [`file_${String(row["id"])}`] });
  assert.deepEqual(report, { dropped: 1, recorded: 0, docs: 1, blobs: 1 });
  assert.deepEqual(closed, [`${ENT}/n1`]);
  assert.equal(d.store.read(ENT, "n1"), null);
  assert.equal(d.store.readFts(ENT, "n1"), null);
  assert.equal(d.store.getBlob("file_n1"), null);
  assert.deepEqual(Array.from(d.store.getBlob("file_n10") ?? []), [8]);
  assert.deepEqual(d.driver.prepare("SELECT doc FROM doc_local ORDER BY doc").all([]).map((r) => r["doc"]), [docPrefix(ENT, "n10"), `${docPrefix(ENT, "n10")}:body`]);
  assert.notEqual(d.store.read(ENT, "n10"), null);
  assert.deepEqual(await applyHides(d.store, [], { driver: d.driver }), { dropped: 0, recorded: 0, docs: 0, blobs: 0 });
  await d.store.close();
});

// P-L1_05 final run: this file shows its own ok line (purge.client.test.ts) in the run on the last commit.
