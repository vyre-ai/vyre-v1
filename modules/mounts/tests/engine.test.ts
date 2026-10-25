// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/handlers/providers.ts
// @reads /modules/mounts/projections.ts
// @reads /modules/mounts/migrations/0001_mounts_core.sql
// The mount engine: first sync, the recorded Drive scan and change feed, the recorded Graph delta, what goes back out, device reports, git mounts, pause/resume/remove and the lag health.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { localChangesConsumer } from "../projections.ts";
import { DEVICE_OFFLINE_MS, LAG_DEGRADED_S, LAG_DOWN_S, SYNC_INTERVAL_MS } from "../handlers/index.ts";
import { NOW, harness, vyreErr } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

async function expectCode(code: string, run: () => Promise<unknown>): Promise<VyreErr> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return e;
  }
  assert.fail(`expected ${code}`);
}

const call = (w: World, cap: keyof typeof handlers, input: Row, ctx?: Ctx): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(ctx ?? w.ctx, input);

/** Feed one event to the local-changes projection the way the host would after the commit. */
function feed(w: World, name: string, payload: Row, at?: number): void {
  const fn = localChangesConsumer.on[name];
  assert.ok(fn, `consumer for ${name}`);
  fn(w.db, { at: at ?? w.now(), actor: "usr_owner", payload: new TextEncoder().encode(JSON.stringify(payload)) });
}

async function addDrive(w: World, extra: Row = {}): Promise<{ mountId: string; folderId: string; runId: string }> {
  const r = await call(w, "mounts.add", { into: "fld_into", source: { kind: "google_drive", connectionId: "con_g", ref: "root_drv" }, name: "Client Drive", ...extra });
  return { mountId: String(r["mountId"]), folderId: String(r["folderId"]), runId: String(r["runId"]) };
}

const view = async (w: World, mountId: string): Promise<Row> => (await call(w, "mounts.get", { mountId }))["mount"] as Row;
const syncNow = (w: World, mountId: string): Promise<Row> => call(w, "mounts.sync_now", { mountId });
const lastSynced = (w: World): Row => w.named("mount.synced").at(-1) as Row;
const rootOf = (w: World, mountId: string): Row => {
  const r = w.items(mountId).find((x) => x["item_key"] === "root");
  assert.ok(r, "root item");
  return r;
};
const itemFor = (w: World, mountId: string, name: string): Row => {
  const r = w.items(mountId).find((x) => x["name"] === name);
  assert.ok(r, `item ${name}`);
  return r;
};

test("migration and module state: two tables, nothing else; the first sync of a Drive mount scans the folder (paged), exports Google-native documents and sets Review changes", async () => {
  const w = harness();
  const { mountId, folderId, runId } = await addDrive(w);
  assert.match(mountId, /^mnt_[0-9a-f]+$/);
  assert.match(runId, /^run_[0-9a-f]+$/);
  assert.deepEqual(w.files.folderPaths(), ["Client Drive", "Client Drive/Contracts"]);
  assert.deepEqual(w.files.paths(), ["Client Drive/Budget", "Client Drive/Contracts/nda.docx", "Client Drive/Plan", "Client Drive/intro.pdf"]);
  assert.equal(w.files.folders.get(folderId)?.reviewChanges, true, "cloud mounts default to Review changes");
  const plan = w.files.fileNamed("Plan");
  assert.deepEqual([plan.kind, plan.mime], ["google_native", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  assert.equal(w.files.fileNamed("Budget").mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(w.files.text(plan.id), "export:g1@2026-10-02T09:00:00.000Z");
  assert.equal(w.files.text(w.files.fileNamed("intro.pdf").id), "drive:f1@2026-10-01T10:05:00.000Z");

  assert.deepEqual(w.named("folder.mounted"), [{ mountId, folderId, kind: "google_drive", by: "usr_owner" }]);
  assert.deepEqual(w.named("mount.synced"), [{ mountId, folderId, pulled: 5, pushed: 0, conflicts: 0, ms: 0 }]);
  assert.ok(w.google.calls.every((c) => c.input["connectionId"] === "con_g"), "every Google call carries the connection");
  assert.deepEqual(w.google.calls.filter((c) => c.cap === "google.drive.list_files").map((c) => [c.input["parentId"], c.input["pageToken"]]), [["root_drv", undefined], ["root_drv", "page2"], ["d1", undefined]]);
  assert.equal(w.google.calls.filter((c) => c.cap === "google.drive.export_file").length, 2);

  const m = await view(w, mountId);
  assert.deepEqual([m["state"], m["provider"], m["kind"], m["name"], m["mode"], m["reviewChanges"], m["lagSeconds"], m["pendingChanges"], m["conflicts"], m["lastSyncAt"]], ["idle", "Google Drive", "google_drive", "Client Drive", "server_copy", true, 0, 0, 0, NOW]);
  assert.equal(m["ref"], "root_drv");
  // the next sync is queued on the scheduler
  assert.deepEqual(w.scheduled.map((s) => [s.cap, s.input, s.at]), [["mounts.sync_now", { mountId }, NOW + SYNC_INTERVAL_MS]]);
  assert.equal(w.mountRow(mountId)["next_sync_at"], NOW + SYNC_INTERVAL_MS);

  // a second pass on an unchanged Drive moves nothing and downloads nothing
  const downloads = w.google.calls.filter((c) => c.cap.endsWith("download_file") || c.cap.endsWith("export_file")).length;
  const again = await syncNow(w, mountId);
  assert.match(String(again["runId"]), /^run_/);
  assert.deepEqual([lastSynced(w)["pulled"], lastSynced(w)["pushed"]], [0, 0]);
  assert.equal(w.google.calls.filter((c) => c.cap.endsWith("download_file") || c.cap.endsWith("export_file")).length, downloads);
  assert.equal(w.scheduled.length, 1, "a pass before the queued one fires does not queue another");

  // a file removed in Drive goes to Trash on the next scan
  w.google.drop("f1");
  await syncNow(w, mountId);
  assert.equal(w.files.files.get(w.files.fileNamed("Plan").id)?.deleted, false);
  assert.ok([...w.files.files.values()].find((f) => f.name === "intro.pdf")?.deleted, "intro.pdf is in Trash");
  assert.equal(lastSynced(w)["pulled"], 1);
});

test("the Drive change feed: updates, renames, removals, children before parents, items outside the folder, and the stored cursor", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  w.db.run("UPDATE mounts_mount SET cursor = ? WHERE id = ?", "tok1", mountId);
  await syncNow(w, mountId);
  assert.deepEqual(w.files.paths(), [
    "Client Drive/Agreements/Signed/deep.txt", "Client Drive/Budget", "Client Drive/Plan", "Client Drive/intro.pdf",
  ]);
  assert.equal(w.files.text(w.files.fileNamed("intro.pdf").id), "drive:f1@2026-10-05T10:00:00.000Z");
  assert.equal(w.files.text(w.files.fileNamed("Plan").id), "export:g1@2026-10-05T11:00:00.000Z");
  assert.deepEqual(w.files.writes.map((x) => x.reason), ["Synced from Google Drive", "Synced from Google Drive"]);
  assert.deepEqual(w.google.calls.filter((c) => c.cap === "google.drive.list_changes").map((c) => c.input["pageToken"]), ["tok1", "tok2"]);
  assert.equal(w.mountRow(mountId)["cursor"], "tok3");
  assert.equal(lastSynced(w)["pulled"], 6, "f1 written, Signed and deep.txt created, Plan written, Contracts renamed, nda.docx trashed");
  assert.ok(!w.items(mountId).some((r) => r["name"] === "elsewhere.txt"), "a file in a folder that is not mounted is ignored");

  // the cursor moves on; an empty feed changes nothing
  await syncNow(w, mountId);
  assert.equal(lastSynced(w)["pulled"], 0);
  assert.equal(w.mountRow(mountId)["cursor"], "tok3");
  assert.deepEqual(w.google.calls.filter((c) => c.cap === "google.drive.list_changes").map((c) => c.input["pageToken"]).slice(-1), ["tok3"]);
});

test("the Graph delta: first listing finds the root, a later delta renames, adds, removes and ignores other folders; a mounted subfolder only sees its own items", async () => {
  const w = harness();
  const add = await call(w, "mounts.add", { into: "fld_into", source: { kind: "sharepoint", connectionId: "con_m", ref: "drv1" }, name: "Policies Library" });
  const mountId = String(add["mountId"]);
  assert.deepEqual(w.files.paths(), ["Policies Library/Policies/handbook.pdf", "Policies Library/readme.md"]);
  assert.deepEqual(w.graph.calls[0]?.input, { connectionId: "con_m", driveId: "drv1" });
  assert.equal(w.mountRow(mountId)["cursor"], "dl1");
  assert.equal(rootOf(w, mountId)["remote_id"], "root", "the drive root was learned from the first listing");
  assert.equal(lastSynced(w)["pulled"], 3);
  assert.equal(w.files.folders.get(String(add["folderId"]))?.reviewChanges, true);

  await syncNow(w, mountId);
  assert.deepEqual(w.files.paths(), ["Policies Library/Policies/leave.txt", "Policies Library/README.md"]);
  assert.equal(w.graph.calls.filter((c) => c.cap === "ms.drive.delta").at(-1)?.input["deltaLink"], "dl1");
  assert.equal(w.mountRow(mountId)["cursor"], "dl2");
  assert.equal(lastSynced(w)["pulled"], 4, "renamed, rewritten, leave.txt added, handbook.pdf removed");

  // a subfolder of the library: its root is the folder item, anything outside it never appears
  const sub = await call(w, "mounts.add", { into: "fld_into", source: { kind: "sharepoint", connectionId: "con_m", ref: "drv1", path: "m1" }, name: "Policies only" });
  assert.deepEqual(w.files.paths().filter((p) => p.startsWith("Policies only/")), ["Policies only/handbook.pdf"]);
  assert.equal(rootOf(w, String(sub["mountId"]))["remote_id"], "m1");
  // OneDrive needs no library
  const od = await call(w, "mounts.add", { into: "fld_into", source: { kind: "onedrive", connectionId: "con_m" } });
  assert.equal((await view(w, String(od["mountId"])))["provider"], "OneDrive");
  assert.deepEqual(w.graph.calls.filter((c) => c.cap === "ms.drive.delta").at(-1)?.input, { connectionId: "con_m" });
  assert.equal((await view(w, String(od["mountId"])))["name"], "OneDrive");
});

test("what changes in Vyre goes out: new folders first, then files, then deletes; a held write stays queued and keeps the lag clock", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  const intro = w.files.fileNamed("intro.pdf");

  // an edit, a new folder with a file in it, a new file, and a delete
  const v = w.files.edit(intro.id, "edited in Vyre");
  feed(w, "file.version_added", { fileId: intro.id, versionId: "ver_x", n: v, by: "usr_owner" });
  const drafts = String((w.files.call("files.folder.create", { parentId: folderId, name: "Drafts" }) as Row & { folder: Row }).folder["folderId"]);
  feed(w, "folder.created", { folderId: drafts, parentId: folderId, name: "Drafts" });
  const inDrafts = String(((w.files.call("files.create", { folderId: drafts, name: "d.txt", content: { blobId: w.files.blob("blb_d", "d") } }) as Row).file as Row)["fileId"]);
  feed(w, "file.created", { fileId: inDrafts, folderId: drafts, name: "d.txt" });
  const top = String(((w.files.call("files.create", { folderId, name: "new.txt", content: { blobId: w.files.blob("blb_n", "n") } }) as Row).file as Row)["fileId"]);
  feed(w, "file.created", { fileId: top, folderId, name: "new.txt" });
  const budget = w.files.fileNamed("Budget");
  w.files.call("files.delete", { fileId: budget.id });
  feed(w, "file.deleted", { fileId: budget.id, folderId });

  w.advance(90_000);
  const waiting = await view(w, mountId);
  assert.deepEqual([waiting["pendingChanges"], waiting["lagSeconds"]], [5, 90], "five changes wait and the clock started at the first one, 90 seconds ago");

  await syncNow(w, mountId);
  assert.deepEqual(w.google.folders, [{ name: "Drafts", parentId: "root_drv" }]);
  assert.deepEqual(w.google.uploads.map((u) => [u.name, u.parentId, u.fileId]), [["intro.pdf", "root_drv", intro.id], ["d.txt", "nf1", inDrafts], ["new.txt", "root_drv", top]]);
  assert.deepEqual(w.google.trashed, ["g2"]);
  assert.deepEqual([lastSynced(w)["pushed"], lastSynced(w)["pulled"]], [5, 0]);
  const done = await view(w, mountId);
  assert.deepEqual([done["pendingChanges"], done["lagSeconds"], done["state"]], [0, 0, "idle"]);
  assert.ok(!w.items(mountId).some((r) => r["name"] === "Budget"), "the deleted item is forgotten once Drive has it");
  assert.equal(itemFor(w, mountId, "d.txt")["remote_id"], "up3", "Drive's id replaces the placeholder");
  assert.equal(itemFor(w, mountId, "d.txt")["parent_key"], itemFor(w, mountId, "Drafts")["item_key"]);

  // the next scan sees what was uploaded as already mapped: nothing to do
  await syncNow(w, mountId);
  assert.deepEqual([lastSynced(w)["pulled"], lastSynced(w)["pushed"]], [0, 0]);

  // a write held for approval waits; the pass is not a failure
  w.google.holdUploads = true;
  const nda = w.files.fileNamed("nda.docx");
  feed(w, "file.version_added", { fileId: nda.id, versionId: "ver_y", n: w.files.edit(nda.id, "held") });
  w.advance(10_000);
  await syncNow(w, mountId);
  let held = await view(w, mountId);
  assert.deepEqual([held["state"], held["pendingChanges"], held["error"]], ["idle", 1, undefined]);
  w.advance(20_000);
  held = await view(w, mountId);
  assert.equal(held["lagSeconds"], 30, "waiting on approval counts as lag");
  w.google.holdUploads = false;
  await syncNow(w, mountId);
  assert.deepEqual([(await view(w, mountId))["pendingChanges"], (await view(w, mountId))["lagSeconds"]], [0, 0]);
});

test("changed on both sides: neither copy is overwritten and the item is flagged; a pull-only mount never sends and keeps no clock", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  const intro = w.files.fileNamed("intro.pdf");
  feed(w, "file.version_added", { fileId: intro.id, versionId: "ver_x", n: w.files.edit(intro.id, "mine") });
  w.google.touch("f1", "2026-10-09T00:00:00.000Z");
  await syncNow(w, mountId);
  assert.equal(w.files.text(intro.id), "mine", "the Vyre copy is untouched");
  assert.equal(w.google.uploads.length, 0, "and nothing was uploaded over the Drive copy");
  const m = await view(w, mountId);
  assert.deepEqual([m["conflicts"], m["pendingChanges"], m["state"]], [1, 0, "idle"]);
  assert.equal(lastSynced(w)["conflicts"], 1);
  assert.equal(w.files.writes.length, 0);

  // pull only: local edits stay put
  const nda = w.files.fileNamed("nda.docx");
  const upd = await call(w, "mounts.update", { mountId, pullOnly: true });
  assert.equal((upd["mount"] as Row)["state"], "idle");
  feed(w, "file.version_added", { fileId: nda.id, versionId: "ver_y", n: w.files.edit(nda.id, "local only") });
  w.advance(60_000);
  await syncNow(w, mountId);
  assert.equal(w.google.uploads.length, 0);
  const po = await view(w, mountId);
  assert.deepEqual([po["pendingChanges"], po["lagSeconds"]], [1, 0]);
});

test("a folder name already taken is refused; a provider failure marks the mount failing and a later pass clears it", async () => {
  const w = harness();
  const pre = String((w.files.call("files.folder.create", { parentId: "fld_into", name: "Client Drive" }) as Row & { folder: Row }).folder["folderId"]);
  w.files.call("files.create", { folderId: pre, name: "intro.pdf", content: { blobId: w.files.blob("blb_pre", "old") } });
  await expectCode("validation.duplicate", () => addDrive(w));

  w.files.folders.get(pre)!.deleted = true;
  w.google.failWith = vyreErr("provider.auth_failed", "The provider rejected the key or sign-in.");
  const { mountId, folderId } = await addDrive(w);
  const bad = await view(w, mountId);
  assert.deepEqual([bad["state"], bad["error"]], ["failing", "The provider rejected the key or sign-in."]);
  assert.deepEqual(w.named("mount.failed"), [{ mountId, folderId, error: "The provider rejected the key or sign-in." }]);
  assert.equal(w.named("mount.synced").length, 0);
  w.advance(120_000);
  assert.equal((await view(w, mountId))["lagSeconds"], 120, "the lag clock started at the first failure");
  w.google.failWith = null;
  await syncNow(w, mountId);
  const ok = await view(w, mountId);
  assert.deepEqual([ok["state"], ok["error"], ok["lagSeconds"]], ["idle", undefined, 0]);
});

test("a name taken inside the mounted folder by a Vyre file keeps both: the provider's file gets the provider in brackets", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  // Drive adds a file with the name of a file that only exists in Vyre
  w.files.call("files.create", { folderId, name: "memo.txt", content: { blobId: w.files.blob("blb_memo", "mine") } });
  w.google.put("root_drv", { id: "m9", name: "memo.txt", mimeType: "text/plain", modifiedTime: "2026-10-11T00:00:00.000Z" });
  await syncNow(w, mountId);
  assert.deepEqual(w.files.paths().filter((p) => p.includes("memo")), ["Client Drive/memo (Google Drive).txt", "Client Drive/memo.txt"]);
  assert.equal(lastSynced(w)["conflicts"], 0, "conflicts count items changed on both sides, not renamed ones");
  assert.ok(w.items(mountId).some((r) => r["remote_id"] === "m9"));
});

test("the projections mark local changes once, ignore folders that are not mounted, and drop what never left Vyre", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  const intro = w.files.fileNamed("intro.pdf");
  const before = w.items(mountId).length;
  feed(w, "file.created", { fileId: "fil_elsewhere", folderId: "fld_other", name: "x.txt" });
  feed(w, "folder.created", { folderId: "fld_new", parentId: "fld_other", name: "x" });
  feed(w, "file.version_added", { fileId: "fil_unknown", versionId: "v", n: 3, by: "usr_owner" });
  assert.equal(w.items(mountId).length, before);

  // the engine's own writes (version <= synced) do not come back as local edits
  feed(w, "file.version_added", { fileId: intro.id, versionId: "v", n: 1, by: "usr_owner" });
  assert.equal(itemFor(w, mountId, "intro.pdf")["dirty"], 0);
  feed(w, "file.version_added", { fileId: intro.id, versionId: "v", n: 2, by: "agt_scout" });
  assert.equal(itemFor(w, mountId, "intro.pdf")["dirty"], 1, "an agent's edit goes out like a person's");
  feed(w, "file.version_added", { fileId: intro.id, versionId: "v", n: 2, by: "agt_scout" });
  assert.equal(w.items(mountId).filter((r) => r["name"] === "intro.pdf").length, 1);

  // replay of a create adds one item
  feed(w, "file.created", { fileId: "fil_new", folderId, name: "n.txt" });
  feed(w, "file.created", { fileId: "fil_new", folderId, name: "n.txt" });
  assert.equal(w.items(mountId).filter((r) => r["file_id"] === "fil_new").length, 1);
  assert.deepEqual([itemFor(w, mountId, "n.txt")["remote_id"], itemFor(w, mountId, "n.txt")["dirty"]], [null, 1]);
  // created and deleted before it ever went out: nothing to tell Drive
  feed(w, "file.deleted", { fileId: "fil_new", folderId });
  assert.ok(!w.items(mountId).some((r) => r["file_id"] === "fil_new"));
  // a delete of something Drive has waits to be sent
  feed(w, "file.deleted", { fileId: intro.id, folderId });
  assert.deepEqual([itemFor(w, mountId, "intro.pdf")["deleted"], itemFor(w, mountId, "intro.pdf")["dirty"]], [1, 1]);
  feed(w, "folder.deleted", { folderId: w.files.folderNamed("Contracts").id });
  assert.equal(itemFor(w, mountId, "Contracts")["deleted"], 1);
  // the mount root is never queued for delete
  feed(w, "folder.deleted", { folderId });
  assert.equal(itemFor(w, mountId, "Client Drive")["deleted"], 0);
});

test("a folder on your computer: the device reports changes, Vyre keeps the copy; folders appear as needed, replays change nothing, device wins a clash", async () => {
  const w = harness();
  const add = await call(w, "mounts.add", { into: "fld_into", source: { kind: "local", deviceId: "dev_mac", localPath: "/Users/maya/Contracts" } });
  const mountId = String(add["mountId"]);
  assert.equal(w.google.calls.length + w.graph.calls.length, 0);
  assert.equal(w.scheduled.length, 0, "a local mount has no scheduled pass");
  const m0 = await view(w, mountId);
  assert.deepEqual([m0["name"], m0["mode"], m0["reviewChanges"], m0["provider"], m0["state"], m0["fromDevice"]], ["Contracts", "server_copy", false, "Local folder", "idle", "dev_mac"]);
  await expectCode("validation.precondition_failed", () => syncNow(w, mountId));

  const report = (changes: Row[], device = "dev_mac"): Promise<Row> => call(w, "mounts.local_report", { mountId, deviceId: device, changes });
  const b = (id: string, text: string): string => w.files.blob(id, text);
  let r = await report([
    { path: "a/b/c.txt", op: "add", blobId: b("blb_1", "one"), mtime: 100 },
    { path: "top.md", op: "add", blobId: b("blb_2", "two"), mtime: 100 },
  ]);
  assert.deepEqual(r, { applied: 2, conflicts: 0 });
  assert.deepEqual(w.files.paths(), ["Contracts/a/b/c.txt", "Contracts/top.md"]);
  assert.deepEqual(w.files.folderPaths(), ["Contracts", "Contracts/a", "Contracts/a/b"]);
  assert.deepEqual(w.named("mount.synced").at(-1), { mountId, folderId: add["folderId"], pulled: 2, pushed: 0, conflicts: 0, ms: 0 });

  r = await report([{ path: "top.md", op: "modify", blobId: b("blb_3", "two!"), mtime: 100 }]);
  assert.deepEqual(r, { applied: 0, conflicts: 0 });
  r = await report([{ path: "top.md", op: "modify", blobId: b("blb_4", "two!!"), mtime: 200 }]);
  assert.deepEqual(r, { applied: 1, conflicts: 0 });
  const top = w.files.fileNamed("top.md");
  assert.deepEqual([w.files.text(top.id), top.reasons], ["two!!", ["From dev_mac"]]);

  // an edit made in Vyre and not yet seen by the device is kept as a version when the device writes over it
  feed(w, "file.version_added", { fileId: top.id, versionId: "v", n: w.files.edit(top.id, "vyre edit") });
  r = await report([{ path: "top.md", op: "modify", blobId: b("blb_5", "device edit"), mtime: 300 }]);
  assert.deepEqual(r, { applied: 1, conflicts: 1 });
  assert.equal(w.files.text(top.id), "device edit");
  assert.equal(top.version, 4, "the Vyre edit stays in the history");

  // rename a file into a new folder, then a folder with everything below it
  r = await report([{ path: "a/d/c2.txt", op: "rename", from: "a/b/c.txt", mtime: 310 }]);
  assert.deepEqual(r, { applied: 1, conflicts: 0 });
  assert.deepEqual(w.files.paths(), ["Contracts/a/d/c2.txt", "Contracts/top.md"]);
  r = await report([{ path: "z", op: "rename", from: "a", mtime: 320 }]);
  assert.deepEqual(r, { applied: 1, conflicts: 0 });
  assert.deepEqual(w.files.paths(), ["Contracts/top.md", "Contracts/z/d/c2.txt"]);
  assert.deepEqual(w.items(mountId).map((x) => x["remote_id"]).sort(), ["", "top.md", "z", "z/b", "z/d", "z/d/c2.txt"]);

  // deletes
  r = await report([{ path: "z/d/c2.txt", op: "delete", mtime: 330 }]);
  assert.deepEqual(r, { applied: 1, conflicts: 0 });
  r = await report([{ path: "z", op: "delete", mtime: 340 }, { path: "nothing/here", op: "delete", mtime: 340 }]);
  assert.deepEqual(r, { applied: 1, conflicts: 0 });
  assert.deepEqual(w.files.paths(), ["Contracts/top.md"]);
  assert.deepEqual(w.items(mountId).map((x) => x["remote_id"]).sort(), ["", "top.md"]);

  // the wrong computer, bad paths and unknown operations are refused
  await expectCode("permission.no_grant", () => report([], "dev_other"));
  await expectCode("validation.bad_input", () => report([{ path: "../x", op: "add", blobId: "b", mtime: 1 }]));
  await expectCode("validation.bad_input", () => report([{ path: "x", op: "copy", mtime: 1 }]));
  await expectCode("validation.bad_input", () => report([{ path: "ok.txt", op: "rename", mtime: 1 }]));
  assert.equal(w.named("mount.failed").length, 0, "refused requests are not failures of the mount");
  const google = await addDrive(w);
  await expectCode("validation.precondition_failed", () => call(w, "mounts.local_report", { mountId: google.mountId, deviceId: "dev_mac", changes: [] }));

  // a computer that stops reporting shows as offline; the lag health says so
  assert.equal((await view(w, mountId))["state"], "idle");
  w.advance(DEVICE_OFFLINE_MS + 1000);
  assert.equal((await view(w, mountId))["state"], "device_offline");
  const health = await call(w, "mounts.lag", {});
  assert.equal(health["state"], "degraded");
  assert.match(String(health["detail"]), /1 computer offline/);
  await report([]);
  assert.equal((await view(w, mountId))["state"], "idle");
});

test("a live-only local folder keeps no server copy: reports are acknowledged and no file is made", async () => {
  const w = harness({ settings: { "files.local_mount_default": "live_only" } });
  const add = await call(w, "mounts.add", { into: "fld_into", source: { kind: "local", deviceId: "dev_mac", localPath: "C:\\Users\\maya\\Docs" } });
  const mountId = String(add["mountId"]);
  const m = await view(w, mountId);
  assert.deepEqual([m["name"], m["mode"]], ["Docs", "live_only"], "the Space default decides when the person did not");
  const before = w.calls.length;
  const r = await call(w, "mounts.local_report", { mountId, deviceId: "dev_mac", changes: [{ path: "a.txt", op: "add", blobId: "blb_x", mtime: 1 }, { path: "b/c.txt", op: "modify", blobId: "blb_y", mtime: 2 }] });
  assert.deepEqual(r, { applied: 2, conflicts: 0 });
  assert.deepEqual(w.files.paths(), []);
  assert.equal(w.calls.length, before, "nothing was asked of the files module");
  await expectCode("validation.bad_input", () => call(w, "mounts.local_report", { mountId, deviceId: "dev_mac", changes: [{ path: "a/../b", op: "add", mtime: 1 }] }));
  assert.equal((await view(w, mountId))["state"], "idle", "a refused request does not mark the mount");
  // an explicit mode wins over the default
  const server = await call(w, "mounts.add", { into: "fld_into", source: { kind: "local", deviceId: "dev_mac", localPath: "/tmp/other" }, mode: "server_copy" });
  assert.equal((await view(w, String(server["mountId"])))["mode"], "server_copy");
});

test("a GitHub mount is a git folder: init, remote, then pulls through the git module; conflicts and failures show on the mount", async () => {
  const w = harness();
  const add = await call(w, "mounts.add", { into: "fld_into", source: { kind: "github", ref: "acme/site", branch: "main" } });
  const mountId = String(add["mountId"]);
  const folderId = String(add["folderId"]);
  assert.deepEqual(w.gitCalls.map((c) => [c.cap, c.input]), [
    ["git.init", { folderId, branch: "main" }],
    ["git.remote_add", { folderId, name: "origin", url: "https://github.com/acme/site.git" }],
    ["git.pull", { folderId, strategy: "ff_only", branch: "main" }],
  ]);
  const m = await view(w, mountId);
  assert.deepEqual([m["name"], m["provider"], m["state"], m["reviewChanges"], m["ref"]], ["site", "GitHub", "idle", true, "acme/site"]);
  assert.equal(w.files.folders.get(folderId)?.reviewChanges, true, "git folders default to Review changes");
  assert.deepEqual(w.named("mount.synced"), [{ mountId, folderId, pulled: 1, pushed: 0, conflicts: 0, ms: 0 }]);

  w.git.pull = { updated: false, sha: "b".repeat(40), conflicts: ["a.txt"] };
  await syncNow(w, mountId);
  assert.equal((await view(w, mountId))["conflicts"], 1);
  assert.deepEqual([lastSynced(w)["pulled"], lastSynced(w)["conflicts"]], [0, 1]);

  w.git.failWith = vyreErr("validation.precondition_failed", "Your branch and the remote have both moved on, so this cannot be a fast-forward.");
  w.advance(5_000);
  await syncNow(w, mountId);
  const bad = await view(w, mountId);
  assert.deepEqual([bad["state"], bad["error"]], ["failing", "Your branch and the remote have both moved on, so this cannot be a fast-forward."]);
  assert.equal(w.named("mount.failed").length, 1);
  w.git.failWith = null;
  w.git.pull = { updated: true, sha: "c".repeat(40), conflicts: [] };
  await syncNow(w, mountId);
  assert.deepEqual([(await view(w, mountId))["state"], (await view(w, mountId))["conflicts"]], ["idle", 0]);

  // the repository could not be set up: the mount exists, failing, and says why
  w.git.initFailWith = vyreErr("validation.precondition_failed", "git is not available");
  const second = await call(w, "mounts.add", { into: "fld_into", source: { kind: "github", ref: "acme/other" } });
  const broken = await view(w, String(second["mountId"]));
  assert.deepEqual([broken["state"], broken["error"], broken["name"]], ["failing", "git is not available", "other"]);
});

test("update, pause, resume and remove: options, events, Trash or keep, and the access check", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  await expectCode("validation.bad_input", () => call(w, "mounts.update", { mountId, mode: "live_only" }));
  await expectCode("validation.bad_input", () => call(w, "mounts.update", { mountId, mode: "never" }));
  const none = await call(w, "mounts.update", { mountId, mode: "server_copy", reviewChanges: true, pullOnly: false });
  assert.equal(w.named("mount.updated").length, 0, "nothing changed, nothing announced");
  assert.equal((none["mount"] as Row)["name"], "Client Drive");
  const upd = await call(w, "mounts.update", { mountId, reviewChanges: false, name: "Renamed", pullOnly: true });
  assert.deepEqual(w.named("mount.updated"), [{ mountId, folderId, fields: ["reviewChanges", "pullOnly", "name"] }]);
  assert.equal(w.files.folders.get(folderId)?.reviewChanges, false);
  assert.equal(w.files.folders.get(folderId)?.name, "Renamed");
  assert.deepEqual([(upd["mount"] as Row)["name"], (upd["mount"] as Row)["reviewChanges"]], ["Renamed", false]);

  // pause stops syncing, once; resume starts it and queues a pass
  await call(w, "mounts.pause", { mountId });
  await call(w, "mounts.pause", { mountId });
  assert.equal(w.named("mount.paused").length, 1);
  assert.equal((await view(w, mountId))["state"], "paused");
  assert.equal(w.mountRow(mountId)["next_sync_at"], null);
  await expectCode("validation.precondition_failed", () => syncNow(w, mountId));
  w.scheduled.length = 0;
  await call(w, "mounts.resume", { mountId });
  await call(w, "mounts.resume", { mountId });
  assert.equal(w.named("mount.resumed").length, 1);
  assert.equal((await view(w, mountId))["state"], "idle");
  assert.deepEqual(w.scheduled.map((s) => [s.cap, s.input]), [["mounts.sync_now", { mountId }]]);

  // nobody without manage on the folder changes or removes it
  w.levelFor.set("folder", "edit");
  await expectCode("permission.no_grant", () => call(w, "mounts.update", { mountId, name: "x" }));
  await expectCode("permission.no_grant", () => call(w, "mounts.remove", { mountId }));
  await expectCode("permission.no_grant", () => call(w, "mounts.pause", { mountId }));
  w.levelFor.delete("folder");

  // remove keeps the files as a plain folder by default
  const before = w.files.paths().length;
  assert.deepEqual(await call(w, "mounts.remove", { mountId }), { removed: true });
  assert.equal(w.files.paths().length, before);
  assert.deepEqual(w.named("mount.removed"), [{ mountId, folderId, keptCopy: true }]);
  await expectCode("validation.not_found", () => view(w, mountId));
  assert.equal(w.items(mountId).length, 0);
  assert.deepEqual((await call(w, "mounts.list", {}))["mounts"], []);

  // the same Drive folder can be mounted again, and removing without keeping the copy trashes the folder
  const again = await addDrive(w, { name: "Second" });
  await call(w, "mounts.remove", { mountId: again.mountId, keepCopy: false });
  assert.equal(w.files.folders.get(again.folderId)?.deleted, true);
  assert.deepEqual(w.named("mount.removed").at(-1), { mountId: again.mountId, folderId: again.folderId, keptCopy: false });
});

test("list and get: filter by kind, page, hide what the caller cannot open", async () => {
  const w = harness();
  const a = await addDrive(w, { name: "A" });
  w.advance(1000);
  const b = await call(w, "mounts.add", { into: "fld_into", source: { kind: "local", deviceId: "dev_1", localPath: "/x/B" } });
  w.advance(1000);
  const c = await call(w, "mounts.add", { into: "fld_into", source: { kind: "github", ref: "acme/c" } });
  const all = await call(w, "mounts.list", {});
  assert.deepEqual((all["mounts"] as Row[]).map((m) => m["kind"]), ["google_drive", "local", "github"]);
  assert.equal(all["total"], 3);
  assert.deepEqual(((await call(w, "mounts.list", { kind: "local" }))["mounts"] as Row[]).map((m) => m["mountId"]), [b["mountId"]]);
  const p1 = await call(w, "mounts.list", { limit: 2 });
  assert.equal((p1["mounts"] as Row[]).length, 2);
  assert.equal(p1["next"], "2");
  const p2 = await call(w, "mounts.list", { limit: 2, cursor: String(p1["next"]) });
  assert.deepEqual([(p2["mounts"] as Row[]).map((m) => m["mountId"]), p2["next"]], [[c["mountId"]], undefined]);
  w.hidden.add(`folder/${a.folderId}`);
  assert.deepEqual(((await call(w, "mounts.list", {}))["mounts"] as Row[]).map((m) => m["kind"]), ["local", "github"]);
  await expectCode("permission.no_grant", () => view(w, a.mountId));
  await expectCode("validation.not_found", () => view(w, "mnt_nope"));
});

test("add checks its input: kinds, what each needs, repeats, mode, repository names", async () => {
  const w = harness();
  const bad = (source: Row, more: Row = {}): Promise<unknown> => call(w, "mounts.add", { into: "fld_into", source, ...more });
  await expectCode("validation.bad_input", () => bad({ kind: "dropbox" }));
  await expectCode("validation.bad_input", () => bad({ kind: "google_drive", ref: "x" }));
  await expectCode("validation.bad_input", () => bad({ kind: "google_drive", connectionId: "c" }));
  await expectCode("validation.bad_input", () => bad({ kind: "sharepoint", connectionId: "c" }));
  await expectCode("validation.bad_input", () => bad({ kind: "onedrive" }));
  await expectCode("validation.bad_input", () => bad({ kind: "local", deviceId: "d" }));
  await expectCode("validation.bad_input", () => bad({ kind: "local", localPath: "/x" }));
  await expectCode("validation.bad_input", () => bad({ kind: "github", ref: "not a repo" }));
  await expectCode("validation.bad_input", () => bad({ kind: "github" }));
  await expectCode("validation.bad_input", () => bad({ kind: "google_drive", connectionId: "c", ref: "r" }, { mode: "live_only" }));
  await expectCode("validation.bad_input", () => bad({ kind: "local", deviceId: "d", localPath: "/x" }, { mode: "sometimes" }));
  await expectCode("validation.bad_input", () => call(w, "mounts.add", { source: { kind: "local", deviceId: "d", localPath: "/x" } }));
  assert.equal(w.files.folders.size, 1, "a refused add made no folder");
  await bad({ kind: "local", deviceId: "d", localPath: "/x" });
  await expectCode("validation.duplicate", () => bad({ kind: "local", deviceId: "d", localPath: "/x" }));
  await bad({ kind: "local", deviceId: "d2", localPath: "/y" });
  await bad({ kind: "github", ref: "acme/site" }, { reviewChanges: false });
  assert.equal(w.files.folderNamed("site").reviewChanges, false, "the person's choice beats the Space default");
});

test("lag health: healthy when idle, degraded by lag or failures, down at an hour or when every mount fails; paused mounts do not count", async () => {
  const w = harness();
  assert.deepEqual(await call(w, "mounts.lag", {}), { state: "healthy", worstLagSeconds: 0, failing: [] });
  const a = await addDrive(w, { name: "A" });
  const b = await call(w, "mounts.add", { into: "fld_into", source: { kind: "sharepoint", connectionId: "con_m", ref: "drv1" }, name: "B" });
  assert.equal((await call(w, "mounts.lag", {}))["state"], "healthy");

  w.db.run("UPDATE mounts_mount SET stale_since = ? WHERE id = ?", w.now() - (LAG_DEGRADED_S + 5) * 1000, a.mountId);
  let h = await call(w, "mounts.lag", {});
  assert.deepEqual([h["state"], h["worstLagSeconds"]], ["degraded", LAG_DEGRADED_S + 5]);
  assert.match(String(h["detail"]), /worst lag 5 minutes/);

  w.db.run("UPDATE mounts_mount SET stale_since = ? WHERE id = ?", w.now() - (LAG_DOWN_S + 1) * 1000, a.mountId);
  assert.equal((await call(w, "mounts.lag", {}))["state"], "down");
  await call(w, "mounts.pause", { mountId: a.mountId });
  assert.equal((await call(w, "mounts.lag", {}))["state"], "healthy", "a paused mount is not lagging");
  await call(w, "mounts.resume", { mountId: a.mountId });
  w.db.run("UPDATE mounts_mount SET stale_since = ? WHERE id = ?", null, a.mountId);

  w.graph.failWith = vyreErr("provider.unavailable", "The provider or connected app is down.", true);
  await syncNow(w, String(b["mountId"]));
  h = await call(w, "mounts.lag", {});
  assert.deepEqual([h["state"], h["failing"]], ["degraded", [b["mountId"]]]);
  assert.match(String(h["detail"]), /1 mount failing/);
  w.google.failWith = vyreErr("provider.unavailable", "The provider or connected app is down.", true);
  await syncNow(w, a.mountId);
  h = await call(w, "mounts.lag", {});
  assert.equal(h["state"], "down", "every active mount is failing");
  assert.match(String(h["detail"]), /2 mounts failing/);
  assert.equal(((await view(w, a.mountId))["error"]), "The provider or connected app is down.");
});
