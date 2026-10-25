// @reads /modules/mounts/handlers/outbound-moves.ts
// @reads /modules/mounts/handlers/providers.ts
// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/projections.ts
// @reads /modules/mounts/migrations/0001_mounts_core.sql
// Outbound moves: a rename or a move made in Vyre inside a mounted folder goes out to the provider, in order, as create-then-remove; moving out deletes there, moving in creates there;
// a local folder and a GitHub mount do their own and send nothing from here. One test per provider kind.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { providerOf } from "../handlers/index.ts";
import type { MountKind, MountRec } from "../handlers/index.ts";
import { movesConsumer, pushMoves } from "../handlers/outbound-moves.ts";
import { harness, vyreErr } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

const call = (w: World, cap: keyof typeof handlers, input: Row): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, input);

/** Feed one event to the moves projection the way the host would after the commit. */
function feed(w: World, name: string, payload: Row): void {
  const fn = movesConsumer.on[name];
  assert.ok(fn, `moves handler for ${name}`);
  fn(w.db, { at: w.now(), actor: "usr_owner", payload: new TextEncoder().encode(JSON.stringify(payload)) });
}

/** The files module as pushMoves asks it: what an item is called and where it sits now. */
function withFilesGet(w: World): Ctx {
  return {
    ...w.ctx,
    call: async (cap: string, input: unknown): Promise<unknown> => {
      const i = input as Row;
      if (cap === "files.get") {
        const f = w.files.files.get(String(i["fileId"]));
        if (!f) throw vyreErr("validation.not_found", "No such file.");
        return { file: { fileId: f.id, name: f.name, folderId: f.folderId, ...(f.deleted ? { deletedAt: 1 } : {}) } };
      }
      if (cap === "files.folder.get") {
        const f = w.files.folders.get(String(i["folderId"]));
        if (!f || f.deleted) throw vyreErr("validation.not_found", "No such folder.");
        return { folder: { folderId: f.id, name: f.name, ...(f.parentId ? { parentId: f.parentId } : {}) } };
      }
      return w.ctx.call(cap, input);
    },
  };
}

function mountRec(w: World, mountId: string): MountRec {
  const r = w.mountRow(mountId);
  const opt = (k: string): string | undefined => (typeof r[k] === "string" && r[k] !== "" ? (r[k] as string) : undefined);
  const connectionId = opt("connection_id");
  const ref = opt("ref");
  return {
    id: mountId, folderId: String(r["folder_id"]), kind: String(r["kind"]) as MountKind, ...(connectionId ? { connectionId } : {}), ...(ref ? { ref } : {}),
    name: String(r["name"]), mode: "server_copy", reviewChanges: true, pullOnly: r["pull_only"] === 1,
  };
}

/** What the engine will do: the mount's items, patched in the database and in the row. */
async function push(w: World, mountId: string): Promise<{ moved: number; held: number; errors: string[] }> {
  const m = mountRec(w, mountId);
  const rows = w.items(mountId);
  const patch = (row: Row, fields: Row): void => {
    const cols = Object.keys(fields);
    w.db.run(`UPDATE mounts_item SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE mount_id = ? AND item_key = ?`, ...cols.map((c) => fields[c]), row["mount_id"], row["item_key"]);
    Object.assign(row, fields);
  };
  return pushMoves(withFilesGet(w), m, providerOf(m.kind), rows, patch);
}

async function addDrive(w: World): Promise<{ mountId: string; folderId: string }> {
  const r = await call(w, "mounts.add", { into: "fld_into", source: { kind: "google_drive", connectionId: "con_g", ref: "root_drv" }, name: "Client Drive" });
  return { mountId: String(r["mountId"]), folderId: String(r["folderId"]) };
}

const item = (w: World, mountId: string, name: string): Row => {
  const r = w.items(mountId).find((x) => x["name"] === name);
  assert.ok(r, `item ${name}`);
  return r;
};

const caps = (w: World): string[] => w.google.calls.map((c) => c.cap).filter((c) => /upload_file|create_folder|trash_file/.test(c));

function elsewhere(w: World): string {
  const made = w.files.call("files.folder.create", { parentId: "fld_into", name: "Elsewhere" }) as Row & { folder: Row };
  return String(made.folder["folderId"]);
}

test("Drive: a rename in Vyre is created under the new name and then the old file is removed; the row follows and the content version counts as sent", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  const intro = w.files.fileNamed("intro.pdf");
  w.files.call("files.rename", { fileId: intro.id, name: "intro-v2.pdf" });
  feed(w, "file.renamed", { fileId: intro.id, from: "intro.pdf", to: "intro-v2.pdf" });
  const waiting = item(w, mountId, "intro.pdf");
  assert.deepEqual([waiting["dirty"], waiting["remote_id"], waiting["name"]], [1, "f1", "intro.pdf"], "the row keeps what the provider has until the move is sent");
  assert.notEqual(w.mountRow(mountId)["stale_since"], null, "the lag clock runs while a move waits");

  w.google.calls.length = 0;
  const out = await push(w, mountId);
  assert.deepEqual(out, { moved: 1, held: 0, errors: [] });
  assert.deepEqual(caps(w), ["google.drive.upload_file", "google.drive.trash_file"], "create first, remove after");
  assert.deepEqual(w.google.uploads, [{ fileId: intro.id, name: "intro-v2.pdf", parentId: "root_drv" }]);
  assert.deepEqual(w.google.trashed, ["f1"]);
  const done = item(w, mountId, "intro-v2.pdf");
  assert.deepEqual([done["dirty"], done["remote_id"]], [0, "up1"]);
  assert.equal(done["synced_version"], done["local_version"]);
  assert.equal(w.items(mountId).some((r) => r["name"] === "intro.pdf"), false);

  const again = await push(w, mountId);
  assert.deepEqual(again, { moved: 0, held: 0, errors: [] }, "nothing is sent twice");
});

test("Drive: a move to another folder of the mount creates it there and removes the old one; folders go first and a renamed folder takes its contents with it", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  const nda = w.files.fileNamed("nda.docx");
  const contracts = w.files.folderNamed("Contracts");
  const intro = w.files.fileNamed("intro.pdf");

  // nda.docx moves up to the mounted folder, intro.pdf is renamed, and the folder Contracts is renamed, in this order
  w.files.call("files.move", { fileId: nda.id, toFolderId: folderId });
  feed(w, "file.moved", { fileId: nda.id, fromFolderId: contracts.id, toFolderId: folderId });
  w.files.call("files.rename", { fileId: intro.id, name: "hello.pdf" });
  feed(w, "file.renamed", { fileId: intro.id, from: "intro.pdf", to: "hello.pdf" });
  w.files.call("files.folder.rename", { folderId: contracts.id, name: "Agreements" });
  feed(w, "folder.renamed", { folderId: contracts.id, from: "Contracts", to: "Agreements" });

  w.google.calls.length = 0;
  const out = await push(w, mountId);
  assert.deepEqual(out, { moved: 3, held: 0, errors: [] });
  assert.deepEqual(caps(w), [
    "google.drive.create_folder", "google.drive.trash_file", // the folder first, the old one removed right after the new one exists
    "google.drive.upload_file", "google.drive.trash_file", // then the file that was renamed
  ]);
  assert.deepEqual(w.google.folders, [{ name: "Agreements", parentId: "root_drv" }]);
  assert.deepEqual(w.google.trashed, ["d1", "f1"]);
  // nda.docx lived in the folder that was just removed: it is not sent here, it is marked to be created at its new place by the normal push
  const moved = item(w, mountId, "nda.docx");
  assert.deepEqual([moved["parent_key"], moved["remote_id"], moved["dirty"]], ["root", null, 1], "nda.docx now hangs on the mounted folder and waits to be created there");
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.uploads.find((u) => u.fileId === nda.id), { fileId: nda.id, name: "nda.docx", parentId: "root_drv" });
  assert.equal(item(w, mountId, "hello.pdf")["dirty"], 0);
  assert.equal(item(w, mountId, "Agreements")["dirty"], 0);
  assert.equal(item(w, mountId, "Agreements")["remote_id"], "nf1");
});

test("Drive: the contents of a renamed folder are marked to be created under it, because removing the old folder removed them", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  const contracts = w.files.folderNamed("Contracts");
  w.files.call("files.folder.rename", { folderId: contracts.id, name: "Agreements" });
  feed(w, "folder.renamed", { folderId: contracts.id, from: "Contracts", to: "Agreements" });
  await push(w, mountId);
  const inside = item(w, mountId, "nda.docx");
  assert.deepEqual([inside["remote_id"], inside["dirty"], inside["parent_key"]], [null, 1, item(w, mountId, "Agreements")["item_key"]]);
  // the engine's normal push now creates it under the new folder
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.uploads.find((u) => u.name === "nda.docx"), { fileId: w.files.fileNamed("nda.docx").id, name: "nda.docx", parentId: "nf1" });
  assert.equal(item(w, mountId, "nda.docx")["dirty"], 0);
});

test("moving out of the mounted folder deletes there; moving into it creates there", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  const out = elsewhere(w);
  const intro = w.files.fileNamed("intro.pdf");

  // out: intro.pdf leaves the mounted folder
  w.files.call("files.move", { fileId: intro.id, toFolderId: out });
  feed(w, "file.moved", { fileId: intro.id, fromFolderId: folderId, toFolderId: out });
  const queued = item(w, mountId, "intro.pdf");
  assert.deepEqual([queued["deleted"], queued["dirty"]], [1, 1]);
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.trashed, ["f1"], "trashed at Drive by the engine's delete step");
  assert.equal(w.files.files.get(intro.id)?.deleted, false, "the Vyre file is where the person put it");
  assert.equal(w.items(mountId).some((r) => r["file_id"] === intro.id), false);

  // in: a file made elsewhere is moved into the mounted folder
  const made = (w.files.call("files.create", { folderId: out, name: "memo.txt", content: { blobId: w.files.blob("blb_memo", "memo") } }) as Row).file as Row;
  const memo = String(made["fileId"]);
  w.files.call("files.move", { fileId: memo, toFolderId: folderId });
  feed(w, "file.moved", { fileId: memo, fromFolderId: out, toFolderId: folderId });
  const adopted = w.items(mountId).find((r) => r["file_id"] === memo);
  assert.deepEqual([adopted?.["name"], adopted?.["remote_id"], adopted?.["dirty"]], ["", null, 1], "adopted without a name: the files module has it");
  const named = await push(w, mountId);
  assert.deepEqual(named, { moved: 1, held: 0, errors: [] });
  assert.equal(item(w, mountId, "memo.txt")["parent_key"], "root");
  assert.deepEqual(w.google.uploads.filter((u) => u.fileId === memo), [], "pushMoves names it; the engine's normal step creates it");
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.uploads.filter((u) => u.fileId === memo), [{ fileId: memo, name: "memo.txt", parentId: "root_drv" }]);
  assert.equal(item(w, mountId, "memo.txt")["dirty"], 0);
});

test("a folder moved out is deleted there with what is in it; a folder moved into the mount becomes one folder item", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  const out = elsewhere(w);
  const contracts = w.files.folderNamed("Contracts");
  w.files.call("files.folder.move", { folderId: contracts.id, toParentId: out });
  feed(w, "folder.moved", { folderId: contracts.id, fromParentId: folderId, toParentId: out });
  assert.deepEqual([item(w, mountId, "Contracts")["deleted"], item(w, mountId, "Contracts")["dirty"]], [1, 1]);
  await call(w, "mounts.sync_now", { mountId });
  assert.ok(w.google.trashed.includes("d1"));
  assert.equal(w.items(mountId).some((r) => r["name"] === "nda.docx"), false, "the items inside go with it");

  const made = w.files.call("files.folder.create", { parentId: out, name: "Notes" }) as Row & { folder: Row };
  const notes = String(made.folder["folderId"]);
  w.files.call("files.folder.move", { folderId: notes, toParentId: folderId });
  feed(w, "folder.moved", { folderId: notes, fromParentId: out, toParentId: folderId });
  const adopted = w.items(mountId).find((r) => r["folder_id"] === notes);
  assert.deepEqual([adopted?.["is_folder"], adopted?.["name"], adopted?.["dirty"]], [1, "", 1]);
  await push(w, mountId);
  await call(w, "mounts.sync_now", { mountId });
  assert.ok(w.google.folders.some((f) => f.name === "Notes" && f.parentId === "root_drv"));
});

test("an item that never reached the provider just follows its new name and place; one send creates it once", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  const made = (w.files.call("files.create", { folderId, name: "a.txt", content: { blobId: w.files.blob("blb_a", "a") } }) as Row).file as Row;
  const fileId = String(made["fileId"]);
  // file.created is the existing projection's: the row is made the way it makes it
  const { localChangesConsumer } = await import("../projections.ts");
  const mk = localChangesConsumer.on["file.created"];
  assert.ok(mk);
  mk(w.db, { at: w.now(), actor: "usr_owner", payload: new TextEncoder().encode(JSON.stringify({ fileId, folderId, name: "a.txt" })) });
  w.files.call("files.rename", { fileId, name: "b.txt" });
  feed(w, "file.renamed", { fileId, from: "a.txt", to: "b.txt" });
  assert.deepEqual([item(w, mountId, "b.txt")["remote_id"], item(w, mountId, "b.txt")["dirty"]], [null, 1]);
  const out = await push(w, mountId);
  assert.deepEqual(out, { moved: 0, held: 0, errors: [] }, "nothing to move: it was never there");
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.uploads, [{ fileId, name: "b.txt", parentId: "root_drv" }]);
  assert.deepEqual(w.google.trashed, []);
});

test("an edit without a rename is not a move: pushMoves leaves it for the upload step", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  const intro = w.files.fileNamed("intro.pdf");
  const { localChangesConsumer } = await import("../projections.ts");
  const edit = localChangesConsumer.on["file.version_added"];
  assert.ok(edit);
  edit(w.db, { at: w.now(), actor: "usr_owner", payload: new TextEncoder().encode(JSON.stringify({ fileId: intro.id, versionId: "ver_x", n: w.files.edit(intro.id, "edited") })) });
  w.google.calls.length = 0;
  assert.deepEqual(await push(w, mountId), { moved: 0, held: 0, errors: [] });
  assert.deepEqual(caps(w), []);
  assert.equal(item(w, mountId, "intro.pdf")["dirty"], 1, "still waiting for the upload step");
});

test("SharePoint and OneDrive: create, then remove, through the Graph capabilities", async () => {
  for (const kind of ["sharepoint", "onedrive"] as const) {
    const w = harness();
    const add = await call(w, "mounts.add", { into: "fld_into", source: { kind, connectionId: "con_m", ref: "drv1" }, name: "Library" });
    const mountId = String(add["mountId"]);
    const readme = w.files.fileNamed("readme.md");
    const before = item(w, mountId, "readme.md")["remote_id"];
    w.files.call("files.rename", { fileId: readme.id, name: "README.md" });
    feed(w, "file.renamed", { fileId: readme.id, from: "readme.md", to: "README.md" });
    w.graph.calls.length = 0;
    const out = await push(w, mountId);
    assert.deepEqual(out, { moved: 1, held: 0, errors: [] }, kind);
    assert.deepEqual(w.graph.calls.map((c) => c.cap), ["ms.drive.upload_item", "ms.drive.delete_item"], `${kind}: create first, remove after`);
    assert.deepEqual(w.graph.uploads.map((u) => [u.fileId, u.name]), [[readme.id, "README.md"]]);
    assert.deepEqual(w.graph.deleted, [before]);
    assert.equal(w.graph.calls[0]?.input["connectionId"], "con_m");
    assert.equal(w.graph.calls[0]?.input["driveId"], "drv1");
    assert.equal(item(w, mountId, "README.md")["remote_id"], "mu1");
  }
});

test("a local folder and a GitHub mount send nothing from here and keep no waiting change", async () => {
  const w = harness();
  const local = await call(w, "mounts.add", { into: "fld_into", source: { kind: "local", deviceId: "dev_mac", localPath: "/Users/maya/Contracts" } });
  const localId = String(local["mountId"]);
  await call(w, "mounts.local_report", { mountId: localId, deviceId: "dev_mac", changes: [{ path: "top.md", op: "add", blobId: w.files.blob("blb_1", "one"), mtime: 100 }] });
  const top = w.files.fileNamed("top.md");
  w.files.call("files.rename", { fileId: top.id, name: "start.md" });
  feed(w, "file.renamed", { fileId: top.id, from: "top.md", to: "start.md" });
  assert.equal(item(w, localId, "top.md")["dirty"], 0, "the device does it: nothing is marked");
  assert.equal(w.mountRow(localId)["stale_since"], null);
  w.google.calls.length = 0;
  assert.deepEqual(await push(w, localId), { moved: 0, held: 0, errors: [] });
  assert.equal(w.google.calls.length + w.graph.calls.length, 0);

  // moved out of a local mount: nothing is queued either
  const out = elsewhere(w);
  w.files.call("files.move", { fileId: top.id, toFolderId: out });
  feed(w, "file.moved", { fileId: top.id, fromFolderId: String(local["folderId"]), toFolderId: out });
  assert.equal(w.items(localId).some((r) => r["file_id"] === top.id), false, "it stops being mapped; the file stays where the person put it, nothing is queued for the device");
  assert.equal(w.mountRow(localId)["stale_since"], null);

  const gh = await call(w, "mounts.add", { into: "fld_into", source: { kind: "github", ref: "acme/site", branch: "main" } });
  const ghId = String(gh["mountId"]);
  const rec = mountRec(w, ghId);
  const rows: Row[] = [{ mount_id: ghId, item_key: "k1", remote_id: "r1", parent_key: "root", file_id: "fil_x", folder_id: null, name: "a.md", is_folder: 0, native: 0, dirty: 1, deleted: 0, conflict: 0 }];
  assert.deepEqual(await pushMoves(withFilesGet(w), rec, providerOf("github"), rows, () => { assert.fail("nothing to patch"); }), { moved: 0, held: 0, errors: [] }, "git carries the rename in a commit");
});

test("a pull-only mount marks nothing and sends nothing", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  await call(w, "mounts.update", { mountId, pullOnly: true });
  const intro = w.files.fileNamed("intro.pdf");
  w.files.call("files.rename", { fileId: intro.id, name: "x.pdf" });
  feed(w, "file.renamed", { fileId: intro.id, from: "intro.pdf", to: "x.pdf" });
  assert.equal(item(w, mountId, "intro.pdf")["dirty"], 0);
  assert.equal(w.mountRow(mountId)["stale_since"], null);
  w.google.calls.length = 0;
  assert.deepEqual(await push(w, mountId), { moved: 0, held: 0, errors: [] });
  assert.deepEqual(caps(w), []);
});

test("a move held for approval waits and goes out later; a provider failure is reported and the item is left as it was", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  const intro = w.files.fileNamed("intro.pdf");
  w.files.call("files.rename", { fileId: intro.id, name: "held.pdf" });
  feed(w, "file.renamed", { fileId: intro.id, from: "intro.pdf", to: "held.pdf" });

  w.google.holdUploads = true;
  assert.deepEqual(await push(w, mountId), { moved: 0, held: 1, errors: [] });
  assert.deepEqual([item(w, mountId, "intro.pdf")["dirty"], item(w, mountId, "intro.pdf")["remote_id"]], [1, "f1"], "nothing changed, nothing was removed");
  assert.deepEqual(w.google.trashed, []);
  w.google.holdUploads = false;

  w.google.failWith = vyreErr("provider.unavailable", "Drive is not reachable.", true);
  const failed = await push(w, mountId);
  assert.deepEqual([failed.moved, failed.held, failed.errors], [0, 0, ["Drive is not reachable."]]);
  assert.equal(item(w, mountId, "intro.pdf")["remote_id"], "f1");
  w.google.failWith = null;

  assert.deepEqual(await push(w, mountId), { moved: 1, held: 0, errors: [] });
  assert.equal(item(w, mountId, "held.pdf")["dirty"], 0);
});

test("a move waits for a parent that is not at the provider yet; a thing the files module no longer has is skipped; the mounted folder itself is not an item to move", async () => {
  const w = harness();
  const { mountId, folderId } = await addDrive(w);
  const intro = w.files.fileNamed("intro.pdf");
  // moved into a folder made in Vyre that has not been created at Drive yet
  const made = w.files.call("files.folder.create", { parentId: folderId, name: "Drafts" }) as Row & { folder: Row };
  const drafts = String(made.folder["folderId"]);
  const { localChangesConsumer } = await import("../projections.ts");
  const fc = localChangesConsumer.on["folder.created"];
  assert.ok(fc);
  fc(w.db, { at: w.now(), actor: "usr_owner", payload: new TextEncoder().encode(JSON.stringify({ folderId: drafts, parentId: folderId, name: "Drafts" })) });
  w.files.call("files.move", { fileId: intro.id, toFolderId: drafts });
  feed(w, "file.moved", { fileId: intro.id, fromFolderId: folderId, toFolderId: drafts });
  w.google.calls.length = 0;
  assert.deepEqual(await push(w, mountId), { moved: 0, held: 0, errors: [] });
  assert.deepEqual(caps(w), [], "the next pass, once Drafts exists");
  assert.equal(item(w, mountId, "intro.pdf")["dirty"], 1);

  // gone from the files module: nothing to send
  const nda = w.files.fileNamed("nda.docx");
  feed(w, "file.renamed", { fileId: nda.id, from: "nda.docx", to: "z.docx" });
  w.files.call("files.delete", { fileId: nda.id });
  w.google.calls.length = 0;
  assert.deepEqual(await push(w, mountId), { moved: 0, held: 0, errors: [] });
  assert.deepEqual(caps(w), []);

  // the mount's own folder renamed in Vyre is the mount's business (mounts.update), not an item
  const before = w.items(mountId).map((r) => [r["item_key"], r["name"], r["dirty"]]);
  feed(w, "folder.renamed", { folderId, from: "Client Drive", to: "Renamed" });
  assert.deepEqual(w.items(mountId).map((r) => [r["item_key"], r["name"], r["dirty"]]), before);
});

test("events for things that are not in a mount change nothing, and a bad payload is ignored", async () => {
  const w = harness();
  const { mountId } = await addDrive(w);
  const before = JSON.stringify(w.items(mountId));
  feed(w, "file.renamed", { fileId: "fil_unknown", from: "a", to: "b" });
  feed(w, "file.moved", { fileId: "fil_unknown", fromFolderId: "fld_a", toFolderId: "fld_b" });
  feed(w, "folder.renamed", { folderId: "fld_unknown", from: "a", to: "b" });
  feed(w, "folder.moved", { folderId: "fld_unknown", fromParentId: "fld_a", toParentId: "fld_b" });
  movesConsumer.on["file.renamed"]?.(w.db, { at: w.now(), actor: "x", payload: new TextEncoder().encode("not json") });
  assert.equal(JSON.stringify(w.items(mountId)), before);
});
