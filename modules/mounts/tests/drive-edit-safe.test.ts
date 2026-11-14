// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/handlers/outbound-moves.ts
// @reads /modules/mounts/handlers/names.ts
// A content edit in Vyre must never trash a Drive file (14 Nov 2026, found live on rc.26): when Files shows a Drive item under a name that differs from its Drive name (the second of two
// same-named files, a plain file beside a Google Doc of the same name, a name inside a folder that itself got a suffix) the outbound path read the edit as a rename, made a NEW Drive file
// and trashed the original. Every case here edits the content only and then runs a pass: the fake Drive must hold the SAME file id with the new content, nothing created, nothing trashed.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { localChangesConsumer } from "../projections.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;
const call = (w: World, cap: keyof typeof handlers, input: Row): Promise<Row> =>
  (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, input);

const DRIVE = { kind: "google_drive", connectionId: "con_g", ref: "root_drv" };
const NATIVE = "application/vnd.google-apps.";
const FOLDER = `${NATIVE}folder`;
const PDF = "application/pdf";
const T = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-02T10:00:00.000Z";
const f = (id: string, name: string, extra: Row = {}): Row => ({
  id,
  name,
  mimeType: PDF,
  modifiedTime: T,
  size: 10,
  ...extra,
});

function listing(w: World, items: Row[], at = "root_drv"): void {
  w.google.listings.set(at, [{ files: items }]);
  for (const it of items)
    if (it["mimeType"] === FOLDER && !w.google.listings.has(String(it["id"])))
      w.google.listings.set(String(it["id"]), [{ files: [] }]);
}

async function mountDrive(w: World): Promise<string> {
  const added = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive", mode: "server_copy" });
  return String(added["mountId"]);
}

/** A person or an agent edits the file in Vyre and the projection hears about it. */
function editInVyre(w: World, display: string, text: string, actor = "usr_owner"): void {
  const fileId = w.files.fileNamed(display).id;
  const fn = localChangesConsumer.on["file.version_added"];
  assert.ok(fn);
  fn(w.ctx.db as never, {
    at: w.now(),
    actor,
    payload: new TextEncoder().encode(JSON.stringify({ fileId, n: w.files.edit(fileId, text) })),
  });
}

const remoteNames = (w: World, mountId: string): [unknown, unknown][] =>
  w
    .items(mountId)
    .filter((i) => i["is_folder"] !== 1)
    .map((i): [unknown, unknown] => [i["remote_id"], i["name"]])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

/** The one assertion every case ends with: the same Drive ids, replaced in place, nothing created, nothing trashed, the Drive names as they were. */
function assertInPlace(w: World, mountId: string, before: [unknown, unknown][], replacedIds: string[]): void {
  assert.deepEqual(w.google.trashed, [], "nothing is trashed at Drive");
  assert.deepEqual(w.google.folders, [], "no folder is made");
  assert.deepEqual(
    w.google.replaced.map((r) => r.remoteId).sort(),
    [...replacedIds].sort(),
    "each edited file is replaced in place by its Drive id",
  );
  assert.equal(w.google.uploads.length, replacedIds.length, "one write per edited file, no extra file");
  assert.deepEqual(remoteNames(w, mountId), before, "the items keep their Drive ids and Drive names");
}

for (const [who, actor] of [
  ["a person", "usr_owner"],
  ["an agent", "agt_helper"],
] as const) {
  test(`(a/b) the second of two same-named files, edited by ${who}: same Drive id, nothing created, nothing trashed`, async () => {
    const w = harness();
    listing(w, [f("d1x", "Budget.pdf"), f("d2x", "Budget.pdf", { modifiedTime: T2 })]);
    const mountId = await mountDrive(w);
    assert.ok(w.files.paths().includes("Drive/Budget (Google Drive).pdf"), w.files.paths().join(", "));
    const before = remoteNames(w, mountId);
    editInVyre(w, "Budget (Google Drive).pdf", "second, edited", actor);
    await call(w, "mounts.sync_now", { mountId });
    assertInPlace(w, mountId, before, ["d2x"]);
  });
}

test("(c) a plain file beside a Google Doc of the same name: the plain file is edited, same Drive id, nothing created, nothing trashed", async () => {
  const w = harness();
  listing(w, [f("g1", "Plan", { mimeType: `${NATIVE}document` }), f("p1", "Plan", { modifiedTime: T2 })]);
  const mountId = await mountDrive(w);
  assert.ok(w.files.paths().includes("Drive/Plan (Google Drive)"), w.files.paths().join(", "));
  const before = remoteNames(w, mountId);
  editInVyre(w, "Plan (Google Drive)", "plain, edited");
  await call(w, "mounts.sync_now", { mountId });
  assertInPlace(w, mountId, before, ["p1"]);
});

test("(c2) a Google Doc beside a plain file of the same name: an edit of the Doc sends nothing", async () => {
  const w = harness();
  listing(w, [f("p1", "Plan"), f("g1", "Plan", { mimeType: `${NATIVE}document`, modifiedTime: T2 })]);
  const mountId = await mountDrive(w);
  const before = remoteNames(w, mountId);
  editInVyre(w, "Plan (Google Drive)", "doc, edited in Vyre");
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.trashed, []);
  assert.equal(w.google.uploads.length, 0, "a native Doc is never written back");
  assert.deepEqual(remoteNames(w, mountId), before);
});

test("(d) the second of a same-named pair inside a folder that itself got a suffix: same Drive id, nothing created, nothing trashed", async () => {
  const w = harness();
  listing(w, [f("fa", "Docs", { mimeType: FOLDER }), f("fb", "Docs", { mimeType: FOLDER, modifiedTime: T2 })]);
  listing(w, [f("a1", "Budget.pdf")], "fa");
  listing(w, [f("b1", "Budget.pdf"), f("b2", "Budget.pdf", { modifiedTime: T2 })], "fb");
  const mountId = await mountDrive(w);
  assert.ok(
    w.files.paths().includes("Drive/Docs (Google Drive)/Budget (Google Drive).pdf"),
    w.files.paths().join(", "),
  );
  const before = remoteNames(w, mountId);
  editInVyre(w, "Budget (Google Drive).pdf", "inside the suffixed folder, second, edited");
  editInVyre(w, "Budget.pdf", "inside a folder, edited"); // the first one found by name: either of the first two
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.trashed, []);
  assert.deepEqual(w.google.folders, []);
  assert.equal(w.google.uploads.length, w.google.replaced.length, "every write is in place");
  assert.ok(w.google.replaced.map((r) => r.remoteId).includes("b2"));
  assert.deepEqual(remoteNames(w, mountId), before);
});

test("(g) still safe: the first of a pair, a unique file, a Drive-side rename then an edit in Vyre, a native Doc", async () => {
  const w = harness();
  listing(w, [
    f("d1x", "Budget.pdf"),
    f("d2x", "Budget.pdf", { modifiedTime: T2 }),
    f("u1", "unique.pdf"),
    f("r1", "before-rename.pdf"),
    f("g1", "Notes", { mimeType: `${NATIVE}document` }),
  ]);
  const mountId = await mountDrive(w);
  // Drive renames r1, the pass pulls it, then a person edits it in Vyre
  w.google.drop("r1");
  w.google.put("root_drv", f("r1", "after-rename.pdf", { modifiedTime: T2 }));
  await call(w, "mounts.sync_now", { mountId });
  assert.ok(w.files.paths().includes("Drive/after-rename.pdf"), w.files.paths().join(", "));
  const before = remoteNames(w, mountId);
  editInVyre(w, "Budget.pdf", "first, edited");
  editInVyre(w, "unique.pdf", "unique, edited");
  editInVyre(w, "after-rename.pdf", "renamed in Drive, edited in Vyre");
  editInVyre(w, "Notes", "doc, edited in Vyre");
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.trashed, []);
  assert.deepEqual(w.google.folders, []);
  assert.deepEqual(
    w.google.replaced.map((r) => r.remoteId).sort(),
    ["d1x", "r1", "u1"],
    "the native Doc sends nothing; the rest are replaced in place",
  );
  assert.deepEqual(remoteNames(w, mountId), before);
});

test("(h) a real rename by a person still reaches Drive as it does today: a new file at Drive under the typed name, the old one trashed (owed: that loses sharing and links)", async () => {
  const w = harness();
  listing(w, [f("u1", "unique.pdf")]);
  const mountId = await mountDrive(w);
  const fileId = w.files.fileNamed("unique.pdf").id;
  w.files.call("files.rename", { fileId, name: "Plan 2026.pdf" });
  const fn = localChangesConsumer.on["file.renamed"];
  assert.ok(fn);
  fn(w.ctx.db as never, {
    at: w.now(),
    actor: "usr_owner",
    payload: new TextEncoder().encode(JSON.stringify({ fileId, to: "Plan 2026.pdf" })),
  });
  await call(w, "mounts.sync_now", { mountId });
  assert.ok(
    w.google.uploads.some((u) => u.name === "Plan 2026.pdf"),
    "the typed name goes to Drive",
  );
  assert.deepEqual(w.google.trashed, ["u1"], "today's design: the old file is trashed after the new one is made");
});

// ---- (f) the state rc.26 left: rows with no shown_name ----

const forgetShown = (w: World, mountId: string): void => {
  for (const i of w.items(mountId))
    w.ctx.db.run(
      "UPDATE mounts_item SET shown_name = ? WHERE mount_id = ? AND item_key = ?",
      null,
      mountId,
      i["item_key"],
    );
  assert.ok(w.items(mountId).every((i) => i["shown_name"] === null));
};

test("(f) rows synced before shown_name (NULL): an edit of the second of a pair BEFORE any pass trashes nothing", async () => {
  const w = harness();
  listing(w, [f("d1x", "Budget.pdf"), f("d2x", "Budget.pdf", { modifiedTime: T2 })]);
  const mountId = await mountDrive(w);
  forgetShown(w, mountId);
  const before = remoteNames(w, mountId);
  editInVyre(w, "Budget (Google Drive).pdf", "edited before any pass");
  await call(w, "mounts.sync_now", { mountId });
  assertInPlace(w, mountId, before, ["d2x"]);
});

test("(f2) rows with NULL shown_name: a pass learns the name of every item with nothing waiting, and an edit after that is still an edit", async () => {
  const w = harness();
  listing(w, [f("d1x", "Budget.pdf"), f("d2x", "Budget.pdf", { modifiedTime: T2 })]);
  const mountId = await mountDrive(w);
  forgetShown(w, mountId);
  await call(w, "mounts.sync_now", { mountId }); // backfillShown runs here
  const shown = (): Record<string, unknown> =>
    Object.fromEntries(
      w
        .items(mountId)
        .filter((i) => i["remote_id"] === "d1x" || i["remote_id"] === "d2x")
        .map((i) => [i["remote_id"], i["shown_name"]]),
    );
  assert.deepEqual(shown(), { d1x: "Budget.pdf", d2x: "Budget (Google Drive).pdf" });
  const before = remoteNames(w, mountId);
  editInVyre(w, "Budget (Google Drive).pdf", "edited after the backfill", "agt_helper");
  await call(w, "mounts.sync_now", { mountId });
  assertInPlace(w, mountId, before, ["d2x"]);
});

test("(f3) a NULL row with an edit waiting is not learned from the edit (the change waiting must not become the name the pass gave)", async () => {
  const w = harness();
  listing(w, [f("d1x", "Budget.pdf"), f("d2x", "Budget.pdf", { modifiedTime: T2 })]);
  const mountId = await mountDrive(w);
  forgetShown(w, mountId);
  editInVyre(w, "Budget (Google Drive).pdf", "waiting");
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.trashed, []);
  assert.deepEqual(
    w.google.replaced.map((r) => r.remoteId),
    ["d2x"],
  );
});

// ---- the belt: a content edit never creates a replacement and trashes the original ----

test("belt: if the compare ever calls an edit a rename, the content edit is refused and marked, nothing is created, nothing is trashed", async () => {
  const w = harness();
  listing(w, [f("u1", "unique.pdf")]);
  const mountId = await mountDrive(w);
  // force the mismatch by hand: the item's stored shown name is not what Files holds, and the change is a content edit (no rename event)
  w.ctx.db.run(
    "UPDATE mounts_item SET shown_name = ? WHERE mount_id = ? AND remote_id = ?",
    "something else.pdf",
    mountId,
    "u1",
  );
  editInVyre(w, "unique.pdf", "edited");
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.google.trashed, [], "nothing is trashed");
  assert.equal(w.google.uploads.length, 0, "no file is created or replaced by the recreate branch");
  assert.deepEqual(w.google.folders, []);
  const item = w.items(mountId).find((i) => i["remote_id"] === "u1");
  assert.ok(item, "the item is still mapped to its Drive id");
  assert.equal(item["conflict"], 1, "the item is flagged so a person can see it needs attention");
  const mount = (await call(w, "mounts.get", { mountId }))["mount"] as Row;
  assert.equal(
    mount["error"],
    "Could not send this edit to Google Drive without replacing the original, so nothing was changed there.",
  );
});

// ---- Microsoft: the same outbound code (pushMoves) serves SharePoint and OneDrive, so the same fix covers them ----

for (const kind of ["onedrive", "sharepoint"] as const) {
  test(`(j) ${kind}: the second of two same-named files, edited in Vyre, is replaced in place, nothing is deleted at the provider`, async () => {
    const w = harness();
    w.graph.deltas.set("", {
      changed: [
        { id: "root", name: "root", folder: true },
        { id: "a1", name: "Budget.pdf", size: 10, lastModifiedDateTime: "2026-10-01T00:00:00Z", parentId: "root" },
        { id: "a2", name: "Budget.pdf", size: 10, lastModifiedDateTime: "2026-10-02T00:00:00Z", parentId: "root" },
      ],
      removed: [],
      deltaLink: "dlq",
    });
    w.graph.deltas.set("dlq", { changed: [], removed: [], deltaLink: "dlq" });
    const added = await call(w, "mounts.add", {
      into: "fld_into",
      source: { kind, connectionId: "con_m", ref: "drv1" },
      name: "Library",
      mode: "server_copy",
    });
    const mountId = String(added["mountId"]);
    const shown = w.files
      .paths()
      .filter((p) => p.startsWith("Library/"))
      .map((p) => p.replace("Library/", ""));
    assert.equal(shown.length, 2, w.files.paths().join(", "));
    const second = shown.find((n) => n !== "Budget.pdf");
    assert.ok(second, `the second of the pair has another name: ${shown.join(", ")}`);
    const before = w.items(mountId).map((i) => [i["remote_id"], i["name"]]);
    editInVyre(w, second, "second, edited");
    await call(w, "mounts.sync_now", { mountId });
    assert.deepEqual(w.graph.deleted, [], "nothing is deleted at the provider");
    assert.deepEqual(
      w.graph.replaced.map((r) => r.remoteId),
      ["a2"],
      "replaced in place by its id",
    );
    assert.deepEqual(
      w.items(mountId).map((i) => [i["remote_id"], i["name"]]),
      before,
    );
  });
}
