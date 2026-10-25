// @reads /modules/mounts/handlers/providers.ts
// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/projections.ts
// Mount providers: what each one asks of the google, microsoft, github and git modules, how their answers become items, browse mapping, and agents working in a mounted folder like in any other.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { exportMimeFor, providerOf } from "../handlers/index.ts";
import type { MountRec } from "../handlers/index.ts";
import { localChangesConsumer } from "../projections.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

async function expectCode(code: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return;
  }
  assert.fail(`expected ${code}`);
}

const call = (w: World, cap: keyof typeof handlers, input: Row, ctx?: Ctx): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(ctx ?? w.ctx, input);

const mount = (o: Partial<MountRec> & Pick<MountRec, "kind">): MountRec => ({ id: "mnt_x", folderId: "fld_x", name: "X", mode: "server_copy", reviewChanges: true, pullOnly: false, ...o });

function feed(w: World, name: string, payload: Row, actor = "usr_owner"): void {
  const fn = localChangesConsumer.on[name];
  assert.ok(fn);
  fn(w.db, { at: w.now(), actor, payload: new TextEncoder().encode(JSON.stringify(payload)) });
}

test("Google-native documents are exported as the nearest open format", () => {
  assert.equal(exportMimeFor("application/vnd.google-apps.document"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(exportMimeFor("application/vnd.google-apps.spreadsheet"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(exportMimeFor("application/vnd.google-apps.presentation"), "application/pdf");
  assert.equal(exportMimeFor("application/vnd.google-apps.drawing"), "application/pdf");
});

test("Drive: a scan lists every folder (paged) and tags folders, natives and parents; a feed read follows the page tokens and returns the new start token", async () => {
  const w = harness();
  const drive = providerOf("google_drive");
  const m = mount({ kind: "google_drive", connectionId: "con_g", ref: "root_drv" });
  assert.ok(drive.pull);
  const scan = await drive.pull(w.ctx, m);
  assert.equal(scan.full, true);
  assert.equal(scan.cursor, undefined, "no capability returns a start token, so a scan leaves the cursor empty");
  assert.deepEqual(scan.items.map((i) => [i.id, i.parentId, i.isFolder, i.native === true, i.version, i.size]), [
    ["d1", "root_drv", true, false, "2026-10-01T10:00:00.000Z", undefined],
    ["f1", "root_drv", false, false, "2026-10-01T10:05:00.000Z", 2048],
    ["g1", "root_drv", false, true, "2026-10-02T09:00:00.000Z", undefined],
    ["g2", "root_drv", false, true, "2026-10-02T09:30:00.000Z", undefined],
    ["f2", "d1", false, false, "2026-10-03T08:00:00.000Z", 5120],
  ]);

  const feedBatch = await drive.pull(w.ctx, { ...m, cursor: "tok1" });
  assert.deepEqual([feedBatch.full, feedBatch.cursor, feedBatch.removed], [false, "tok3", ["f2"]]);
  assert.deepEqual(feedBatch.items.map((i) => [i.id, i.parentId]), [["f1", "root_drv"], ["n2", "n1"], ["n1", "d1"], ["zz", "outside_folder"], ["g1", "root_drv"], ["d1", "root_drv"]]);
  const idle = await drive.pull(w.ctx, { ...m, cursor: "tok3" });
  assert.deepEqual([idle.items, idle.removed, idle.cursor], [[], [], "tok3"]);
  await expectCode("provider.bad_response", () => {
    assert.ok(drive.pull);
    return drive.pull(w.ctx, { ...m, cursor: "expired" });
  });
});

test("Drive: download, export, upload, new folder and delete use the connection and the ids the module expects", async () => {
  const w = harness();
  const drive = providerOf("google_drive");
  const m = mount({ kind: "google_drive", connectionId: "con_g", ref: "root_drv" });
  assert.ok(drive.download && drive.upload && drive.createFolder && drive.remove);
  const plain = await drive.download(w.ctx, m, { remoteId: "f1", name: "intro.pdf", mime: "application/pdf" });
  assert.deepEqual([plain.size, plain.mime], [10, "application/octet-stream"]);
  const doc = await drive.download(w.ctx, m, { remoteId: "g1", name: "Plan", mime: "application/vnd.google-apps.document", native: true });
  assert.equal(doc.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const sheet = await drive.download(w.ctx, m, { remoteId: "g2", name: "Budget", mime: "application/vnd.google-apps.spreadsheet", native: true });
  assert.equal(sheet.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.deepEqual(w.google.calls.map((c) => [c.cap, c.input]), [
    ["google.drive.download_file", { connectionId: "con_g", fileId: "f1" }],
    ["google.drive.export_file", { connectionId: "con_g", fileId: "g1", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
    ["google.drive.export_file", { connectionId: "con_g", fileId: "g2", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
  ]);
  w.google.calls.length = 0;
  const folder = await drive.createFolder(w.ctx, m, { name: "Drafts", parentRemote: "root_drv" });
  const up = await drive.upload(w.ctx, m, { fileId: "fil_1", name: "a.txt", parentRemote: folder.remoteId });
  await drive.remove(w.ctx, m, up.remoteId, false);
  assert.deepEqual(w.google.calls.map((c) => [c.cap, c.input]), [
    ["google.drive.create_folder", { connectionId: "con_g", name: "Drafts", parentId: "root_drv" }],
    ["google.drive.upload_file", { connectionId: "con_g", name: "a.txt", parentId: "nf1", fileId: "fil_1" }],
    ["google.drive.trash_file", { connectionId: "con_g", fileId: "up2" }],
  ]);
  assert.match(String(up.version), /^2026-10-10T/);
});

test("Drive browse: names, folders and the next page; a name search is quoted for the Drive query language", async () => {
  const w = harness();
  const first = await call(w, "mounts.browse", { kind: "google_drive", connectionId: "con_g", parent: "root_drv", limit: 50 });
  assert.deepEqual(first, {
    items: [{ ref: "d1", name: "Contracts", isFolder: true }, { ref: "f1", name: "intro.pdf", isFolder: false }],
    next: "page2",
  });
  assert.deepEqual(w.google.calls[0]?.input, { connectionId: "con_g", parentId: "root_drv", pageSize: 50 });
  const second = await call(w, "mounts.browse", { kind: "google_drive", connectionId: "con_g", parent: "root_drv", cursor: "page2" });
  assert.deepEqual((second["items"] as Row[]).map((i) => i["name"]), ["Plan", "Budget"]);
  assert.equal(second["next"], undefined);
  await call(w, "mounts.browse", { kind: "google_drive", connectionId: "con_g", q: "O'Brien \\ Co" });
  assert.equal(w.google.calls.at(-1)?.input["q"], "name contains 'O\\'Brien \\\\ Co'");
  await expectCode("validation.bad_input", () => call(w, "mounts.browse", { kind: "google_drive" }));
  await expectCode("validation.bad_input", () => call(w, "mounts.browse", { kind: "box", connectionId: "c" }));
  assert.equal(w.google.calls.length, 3, "a refused browse asks the provider nothing");
});

test("Graph: the delta names the root, a subfolder mount reads its own items, a stored link resumes, uploads and deletes carry the drive", async () => {
  const w = harness();
  const graph = providerOf("sharepoint");
  assert.ok(graph.pull && graph.download && graph.upload && graph.createFolder && graph.remove);
  const whole = await graph.pull(w.ctx, mount({ kind: "sharepoint", connectionId: "con_m", ref: "drv1" }));
  assert.deepEqual([whole.full, whole.cursor, whole.rootId, whole.removed], [true, "dl1", "root", []]);
  assert.deepEqual(whole.items.map((i) => [i.id, i.parentId, i.isFolder]), [["root", undefined, true], ["m1", "root", true], ["m2", "m1", false], ["m3", "root", false]]);
  const sub = await graph.pull(w.ctx, mount({ kind: "sharepoint", connectionId: "con_m", ref: "drv1", path: "m1" }));
  assert.equal(sub.rootId, "m1", "a mounted folder is its own root");
  const next = await graph.pull(w.ctx, mount({ kind: "sharepoint", connectionId: "con_m", ref: "drv1", cursor: "dl1" }));
  assert.deepEqual([next.full, next.cursor, next.removed, next.rootId], [false, "dl2", ["m2"], undefined]);
  assert.deepEqual(w.graph.calls.map((c) => c.input["deltaLink"]), [undefined, undefined, "dl1"]);

  w.graph.calls.length = 0;
  const m = mount({ kind: "sharepoint", connectionId: "con_m", ref: "drv1" });
  await graph.download(w.ctx, m, { remoteId: "m2", name: "handbook.pdf" });
  const made = await graph.createFolder(w.ctx, m, { name: "New", parentRemote: "m1" });
  const sent = await graph.upload(w.ctx, m, { fileId: "fil_9", name: "n.txt", parentRemote: made.remoteId });
  await graph.remove(w.ctx, m, sent.remoteId, false);
  assert.deepEqual(w.graph.calls.map((c) => [c.cap, c.input]), [
    ["ms.drive.download_item", { connectionId: "con_m", driveId: "drv1", itemId: "m2" }],
    ["ms.drive.create_folder", { connectionId: "con_m", driveId: "drv1", parentId: "m1", name: "New" }],
    ["ms.drive.upload_item", { connectionId: "con_m", driveId: "drv1", folderId: made.remoteId, name: "n.txt", fileId: "fil_9" }],
    ["ms.drive.delete_item", { connectionId: "con_m", driveId: "drv1", itemId: "mu1" }],
  ]);
  assert.equal(sent.version, "2026-10-10T00:00:00Z");
});

test("Graph browse: a drive and a folder inside it are one parent string; a search filters names; OneDrive has no drive id", async () => {
  const w = harness();
  const top = await call(w, "mounts.browse", { kind: "sharepoint", connectionId: "con_m", parent: "drv1" });
  assert.deepEqual(top, {
    items: [{ ref: "drv1:i1", name: "Shared Documents", isFolder: true }, { ref: "drv1:i2", name: "notes.txt", isFolder: false }],
    next: "s2",
  });
  assert.deepEqual(w.graph.calls[0]?.input, { connectionId: "con_m", driveId: "drv1" });
  const inside = await call(w, "mounts.browse", { kind: "sharepoint", connectionId: "con_m", parent: "drv1:folderX", q: "NOTES", cursor: "s2" });
  assert.deepEqual((inside["items"] as Row[]).map((i) => i["name"]), ["notes.txt"]);
  assert.deepEqual(w.graph.calls[1]?.input, { connectionId: "con_m", driveId: "drv1", folderId: "folderX", skipToken: "s2" });
  const own = await call(w, "mounts.browse", { kind: "onedrive", connectionId: "con_m" });
  assert.deepEqual((own["items"] as Row[]).map((i) => i["ref"]), ["i1", "i2"]);
  assert.deepEqual(w.graph.calls[2]?.input, { connectionId: "con_m" });
});

test("GitHub and local browse: repositories the App can reach (private ones marked), and nothing from a computer the server cannot see", async () => {
  const w = harness();
  const repos = await call(w, "mounts.browse", { kind: "github", q: "ac", limit: 10 });
  assert.deepEqual(repos, {
    items: [
      { ref: "acme/site", name: "acme/site", isFolder: true, path: "https://github.com/acme/site", shared: true },
      { ref: "acme/secret", name: "acme/secret", isFolder: true, path: "https://github.com/acme/secret", shared: false },
    ],
    next: "r2",
  });
  assert.deepEqual(w.calls.find((c) => c.cap === "github.repos.list")?.input, { query: "ac", limit: 10 });
  assert.deepEqual(await call(w, "mounts.browse", { kind: "local" }), { items: [] });
  const local = providerOf("local");
  assert.deepEqual([local.pushes, local.pull, providerOf("github").pushes, providerOf("github").pull], [false, undefined, false, undefined], "device and git folders sync through other paths");
  assert.deepEqual([providerOf("google_drive").pushes, providerOf("sharepoint").pushes, providerOf("onedrive").label], [true, true, "OneDrive"]);
});

test("agents work in a mounted folder like in any folder: an agent can mount, sync and list, and its edits go out like a person's", async () => {
  const w = harness({ principal: { kind: "agent", id: "agt_scout" } });
  const added = await call(w, "mounts.add", { into: "fld_into", source: { kind: "google_drive", connectionId: "con_g", ref: "root_drv" }, name: "Shared" });
  const mountId = String(added["mountId"]);
  const folderId = String(added["folderId"]);
  assert.equal(w.mountRow(mountId)["owner"], "agt_scout");
  assert.equal(w.files.folders.get(folderId)?.reviewChanges, true, "agent writes into a cloud mount are staged for review like anywhere");
  assert.deepEqual(w.files.paths(), ["Shared/Budget", "Shared/Contracts/nda.docx", "Shared/Plan", "Shared/intro.pdf"]);

  // the folder is a normal folder: the agent writes and creates in it, the projections see those events
  const intro = w.files.fileNamed("intro.pdf");
  feed(w, "file.version_added", { fileId: intro.id, versionId: "ver_a", n: w.files.edit(intro.id, "agent edit"), by: "agt_scout" }, "agt_scout");
  const made = (w.files.call("files.create", { folderId, name: "agent-notes.md", content: { blobId: w.files.blob("blb_an", "notes") } }) as Row).file as Row;
  feed(w, "file.created", { fileId: made["fileId"], folderId, name: "agent-notes.md", by: "agt_scout" }, "agt_scout");
  const waiting = ((await call(w, "mounts.get", { mountId }))["mount"] as Row)["pendingChanges"];
  assert.equal(waiting, 2);
  assert.equal(((await call(w, "mounts.list", {}))["mounts"] as Row[]).length, 1);

  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.uploads.map((u) => [u.name, u.fileId]), [["intro.pdf", intro.id], ["agent-notes.md", String(made["fileId"])]]);
  assert.equal(((await call(w, "mounts.get", { mountId }))["mount"] as Row)["pendingChanges"], 0);

  // a person's sync of the same mount behaves the same; an agent without manage on the folder cannot change the mount
  const person = w.as({ kind: "person", id: "usr_maya" });
  await call(w, "mounts.sync_now", { mountId }, person);
  assert.equal(w.named("mount.synced").length, 3);
  w.levelFor.set("folder", "edit");
  await expectCode("permission.no_grant", () => call(w, "mounts.pause", { mountId }));
  await expectCode("permission.no_grant", () => call(w, "mounts.remove", { mountId }));
  await call(w, "mounts.sync_now", { mountId });
  assert.equal(w.named("mount.synced").length, 4, "syncing needs no manage level");
});
