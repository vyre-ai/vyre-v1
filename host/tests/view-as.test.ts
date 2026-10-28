import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import type { Store, StoredRecord } from "../../kernel/src/store/types.ts";
import { createViewAs } from "../src/daemon/view-as.ts";
import {registry} from "../../generated/registry.ts";

function fixture() {
  const snap = new AccessSnapshot(); let now = 1000, sourceLive = true;
  for (const id of ["admin", "target"]) snap.putPrincipal({ id, kind: "person", status: "active" });
  snap.putRole({ id: "manager", clearance: 3, perms: ["access.manage"] });
  snap.putRole({ id: "reader", clearance: 1, perms: [] });
  snap.addPrincipalRole({ holder: "admin", role: "manager" }); snap.addPrincipalRole({ holder: "target", role: "reader" });
  snap.putResource({ id: "space", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  snap.putResource({ id: "type", type: "record_type", parent_id: "space", label: 0, owner_id: null, holds: 0 });
  snap.putGrant({ id: "manage", subject_kind: "actor", subject_id: "admin", resource_type: "space", resource_id: "space", level: "view", conditions: { hiddenFields: ["region"] } });
  const rows: StoredRecord[] = ["one", "two", "three"].map((id, i) => {
    snap.putResource({ id, type: "record", parent_id: "type", label: 0, owner_id: null, holds: 0 });
    return { id, type: "type", version: 1, data: { name: id, region: i === 1 ? "us" : "eu", secret: "hidden", restricted: "classified" }, created_at: 1, updated_at: 1 };
  });
  for (const person of ["admin", "target"]) snap.putGrant({ id: person, subject_kind: "actor", subject_id: person, resource_type: "record_type", resource_id: "type", level: "view", conditions: { rowFilter: { op: "eq", field: "region", value: "eu" }, hiddenFields: person === "admin" ? ["region"] : ["secret"] } });
  snap.setFieldLabel("type", "restricted", 3);
  const store = {
    types:async()=>[], get: async (_type: string, id: string) => rows.find(row => row.id === id) ?? null,
    query: async (_type: string, spec: { page: { cursor?: string } }) => { const offset = Number(spec.page.cursor ?? 0); return { rows: rows.slice(offset, offset + 1), ...(offset + 1 < rows.length ? { next_cursor: String(offset + 1) } : {}) }; },
  } as unknown as Store;
  const ports = { space: "space", snapshot: () => snap, sourceLive: () => sourceLive, store: () => store, now: () => now };
  const preview = createViewAs(ports);
  const source = { person: "admin", sessionId: "signed-in-session", device: "device" };
  const token = preview.issue(source, "target", "trace").previewToken;
  return { snap, store, preview, token, ports, source, expire: () => { now += 600_000; }, revoke: () => { sourceLive = false; } };
}

test("preview permissions track the canonical Records read contracts",()=>{
 for(const name of ["records.get","records.query"]){const cap=registry.capabilities.find(cap=>cap.name===name);assert.ok(cap);assert.equal(cap.effects,"read");assert.equal(cap.permission,null,"If the canonical permission changes, update the closed preview facade too.");}
});

test("preview intersects real row filters, hidden fields, labels and opaque pagination", async () => {
  const f = fixture();
  const first = await (await f.preview.read(f.token, "records.query", { type: "type", limit: 1 }, "trace")).finish() as { rows: { id: string; fields: unknown }[]; next: string };
  assert.deepEqual(first.rows, [{ id: "one", type: "type", version: 1, label: 0, fields: { name: "one" }, createdAt: 1, updatedAt: 1, holds: 0 }]);
  assert.match(first.next, /^[a-f0-9]{64}$/);
  const next = await (await f.preview.read(f.token, "records.query", { type: "type", cursor: first.next }, "trace")).finish() as { rows: { id: string }[] };
  assert.deepEqual(next.rows.map(row => row.id), ["three"]);
  await assert.rejects(f.preview.read(f.token, "records.get", { type: "type", recordId: "two" }, "trace"));
  await assert.rejects(f.preview.read(f.token, "records.query", { type: "type", filter: {} }, "trace"));
});

test("preview rejects every nonallowlisted capability, expiry, restart and cross-Space use", async () => {
  const f = fixture();
  for (const cap of ["records.create", "identity.me", "audit.export", "files.read", "access.view_as", "vault.items.get", "records.aggregate"]) await assert.rejects(f.preview.read(f.token, cap, {}, "trace"));
  assert.equal(createViewAs(f.ports).resolve(f.token), null);
  assert.equal(createViewAs({ ...f.ports, space: "other" }).resolve(f.token), null);
  f.expire(); assert.equal(f.preview.resolve(f.token), null);
});

test("revocation and target permission changes after awaited reads block release", async () => {
  const f = fixture(); const pending = await f.preview.read(f.token, "records.get", { type: "type", recordId: "one" }, "trace");
  f.revoke(); await assert.rejects(pending.finish()); assert.equal(f.preview.resolve(f.token), null);
  const g = fixture(); const row = await g.preview.read(g.token, "records.get", { type: "type", recordId: "one" }, "trace");
  g.snap.putPrincipal({ id: "target", kind: "person", status: "suspended" }); await assert.rejects(row.finish());
  const h = fixture(); const read = await h.preview.read(h.token, "records.get", { type: "type", recordId: "one" }, "trace");
  h.snap.putRole({ id: "manager", clearance: 3, perms: [] }); await assert.rejects(read.finish(), "losing requester access.manage revokes preview immediately");
  const i = fixture(); const labeled = await i.preview.read(i.token, "records.get", { type: "type", recordId: "one" }, "trace");
  i.snap.putResource({ id: "one", type: "record", parent_id: "type", label: 3, owner_id: "admin", holds: 0 }); await assert.rejects(labeled.finish(), "target clearance still caps owner-visible data");
  assert.throws(() => i.preview.issue({ ...i.source, sessionId: "" }, "target", "trace"));
  assert.throws(() => i.preview.issue(i.source, "admin", "trace"));
});

test("Personal/Mine ancestry is excluded even if both people own or can read it", async () => {
  const f = fixture();
  f.snap.putResource({ id: "mine", type: "folder", parent_id: "space", label: 0, owner_id: "admin", holds: 0 });
  f.snap.putResource({ id: "type", type: "record_type", parent_id: "mine", label: 0, owner_id: "admin", holds: 0 });
  await assert.rejects(f.preview.read(f.token, "records.get", { type: "type", recordId: "one" }, "trace"));
});

test("a blocked canonical read cannot outlive source revocation", async () => {
  const f = fixture(); const row = await f.store.get("type", "one");
  let release!: (value: StoredRecord | null) => void;
  f.store.get = () => new Promise(resolve => { release = resolve; });
  const pending = f.preview.read(f.token, "records.get", { type: "type", recordId: "one" }, "trace");
  await new Promise<void>(resolve=>setImmediate(resolve));f.revoke(); release(row); await assert.rejects(pending);
});
