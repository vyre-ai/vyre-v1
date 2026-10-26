// P-SEC_07 on the host side: the backup source the daemon builds (host/src/seams/backup.ts) answers owner() from the access layer, and with no owner it answers the empty string, which no principal
// equals, so every full export refuses, the person who would otherwise own the Space included. Lives in test/ because host may not import modules/ (boundaries.json).
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createBackupHost } from "../host/src/seams/backup.ts";
import { world } from "../modules/backup/fixtures/world.ts";
import { configureBackup, handlers } from "../modules/backup/handlers/index.ts";

afterEach(() => configureBackup(null));

const hostSeam = (owner) => createBackupHost({
  root: "/nonexistent", space: "spc_core", log: { currentHead: async () => ({ seq: 0, hash: "" }), read: async () => [] },
  owner, system: async () => ({}), vault: { secret: async () => "", signRs256: async () => "" }, blobs: { put: async () => "blb_x" }, fetch: async () => ({ status: 500, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) }),
});
const sourceWith = (w, owner) => Object.create(w.space, { owner: { value: hostSeam(owner).source.owner } });
const exportStart = (ctx) => handlers["backup.export_start"](ctx, {});

test("the host source answers the owner from the access layer", async () => {
  assert.equal(await hostSeam(() => "usr_owner").source.owner(), "usr_owner");
});

test("with an owner, the owner's export runs", async () => {
  const w = world();
  configureBackup({ ...w.drivers, source: sourceWith(w, () => "usr_owner") });
  const out = await exportStart(w.ctx);
  assert.ok(out.runId);
  assert.equal(w.saved.length, 1);
});

test("with no owner, backup.export_start refuses and saves nothing", async () => {
  const w = world();
  configureBackup({ ...w.drivers, source: sourceWith(w, () => null) });
  assert.equal(await hostSeam(() => null).source.owner(), "", "no owner is the empty string");
  await assert.rejects(() => exportStart(w.ctx), (e) => e.error?.code === "permission.no_grant");
  assert.deepEqual(w.saved, []);
});
