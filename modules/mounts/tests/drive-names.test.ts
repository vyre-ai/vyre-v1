// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/fixtures/world.ts
// A Drive holds whatever its people named things. The names are Drive's, not Vyre's to refuse: one odd name must never stop a listing or turn the whole Drive red (13 Nov 2026, the owner's
// My Drive: four mounts "failing" that never finished one pass). Names Vyre's Files cannot hold are shown under a safe display name; the real name stays on the mount's item.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { localChangesConsumer } from "../projections.ts";
import { harness, vyreErr } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;
const call = (w: World, cap: keyof typeof handlers, input: Row): Promise<Row> =>
  (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, input);

const DRIVE = { kind: "google_drive", connectionId: "con_g", ref: "root_drv" };
const T = "2026-10-01T10:00:00.000Z";
const PDF = "application/pdf";
const FOLDER = "application/vnd.google-apps.folder";
const f = (id: string, name: string, extra: Row = {}): Row => ({
  id,
  name,
  mimeType: PDF,
  modifiedTime: T,
  size: 10,
  ...extra,
});

/** Drive lists exactly these items in My Drive (the recorded fixture pages are replaced). */
function listing(w: World, items: Row[]): void {
  w.google.listings.set("root_drv", [{ files: items }]);
  for (const it of items)
    if (it["mimeType"] === FOLDER && !w.google.listings.has(String(it["id"])))
      w.google.listings.set(String(it["id"]), [{ files: [] }]);
}

async function mount(w: World): Promise<{ mountId: string; view: () => Promise<Row>; sync: () => Promise<Row> }> {
  const added = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  const mountId = String(added["mountId"]);
  return {
    mountId,
    view: async () => (await call(w, "mounts.get", { mountId }))["mount"] as Row,
    sync: () => call(w, "mounts.sync_now", { mountId }),
  };
}

test("two Drive files with one name are both shown and told apart; neither stops the listing", async () => {
  const w = harness();
  listing(w, [
    f("a1", "Budget.pdf"),
    f("a2", "Budget.pdf", { modifiedTime: "2026-10-02T10:00:00.000Z" }),
    f("a3", "zeta.pdf"),
  ]);
  const m = await mount(w);
  assert.equal((await m.view())["state"], "idle");
  assert.equal(w.files.paths().length, 3, w.files.paths().join(", "));
  assert.ok(w.files.paths().includes("Drive/zeta.pdf"), "what comes after the pair is listed too");
});

test("a file and a folder with one name, and names that differ only by case or Unicode form, are all shown", async () => {
  const w = harness();
  listing(w, [
    f("dir1", "Plans", { mimeType: FOLDER }),
    f("a1", "Plans"),
    f("a2", "REPORT.pdf"),
    f("a3", "report.pdf"),
    f("a4", "café.pdf"),
    f("a5", "café.pdf"),
    f("a6", "tail.pdf"),
  ]);
  const m = await mount(w);
  assert.equal((await m.view())["state"], "idle");
  assert.equal(w.files.paths().length, 6, w.files.paths().join(", "));
  assert.ok(w.files.folderPaths().includes("Drive/Plans"));
});

test("names Vyre's Files refuse are shown under a safe display name, the Drive name stays on the item, and the Drive is not failing", async () => {
  const w = harness();
  listing(w, [
    f("s1", "Q3/Q4 plan.pdf"),
    f("s2", "back\\slash.pdf"),
    f("s3", "tab\tname.pdf"),
    f("s4", ".."),
    f("s5", "  "),
    f("s6", `${"x".repeat(300)}.pdf`),
    f("s7", "padded name.pdf "),
    f("s8", "after.pdf"),
  ]);
  const m = await mount(w);
  const v = await m.view();
  assert.equal(v["state"], "idle", String(v["error"]));
  assert.equal(w.files.paths().length, 8, w.files.paths().join(", "));
  assert.ok(w.files.paths().includes("Drive/after.pdf"));
  const items = w.items(m.mountId);
  assert.equal(items.find((i) => i["remote_id"] === "s1")?.["name"], "Q3/Q4 plan.pdf", "the Drive name is kept");
  for (const p of w.files.paths()) assert.ok(!/[\\\u0000-\u001f]/.test(p.replace("Drive/", "")), p);
});

test("one item that cannot be brought in is skipped and counted, the rest continue, and the Drive stays healthy", async () => {
  const w = harness();
  listing(w, [f("a1", "one.pdf"), f("a2", "two.pdf"), f("a3", "three.pdf")]);
  const real = w.files.call.bind(w.files);
  w.files.call = (cap: string, i: Row): unknown => {
    if (cap === "files.create" && i["name"] === "two.pdf") throw vyreErr("validation.bad_input", "Refused.");
    return real(cap, i);
  };
  const m = await mount(w);
  const v = await m.view();
  assert.equal(v["state"], "idle", "one refused item is not a failing Drive");
  assert.deepEqual(w.files.paths(), ["Drive/one.pdf", "Drive/three.pdf"]);
  assert.equal(v["skippedCount"], 1);
  const skipped = v["skipped"] as Row[];
  assert.equal(skipped[0]?.["name"], "two.pdf");
  assert.match(String(skipped[0]?.["reason"]), /\S/);
});

test("a Drive that cannot be reached is failing, with a sentence; a mount stuck failing with a half listing heals on its next sync", async () => {
  const w = harness();
  listing(w, [f("a1", "one.pdf"), f("a2", "two.pdf")]);
  const m = await mount(w);
  w.google.failWith = vyreErr("provider.unavailable", "Drive is down.", true);
  await m.sync();
  assert.equal((await m.view())["state"], "failing");
  w.google.failWith = null;
  // the stored state of a live Space: failing, no sync ever finished, half the listing in
  w.ctx.db.run(
    "UPDATE mounts_mount SET state = ?, last_sync_at = ?, error = ? WHERE id = ?",
    "failing",
    null,
    "That name cannot be used for a file or folder.",
    m.mountId,
  );
  listing(w, [f("a1", "one.pdf"), f("a2", "two.pdf"), f("a3", "bad/name.pdf"), f("a4", "four.pdf")]);
  await m.sync();
  const v = await m.view();
  assert.equal(v["state"], "idle", String(v["error"]));
  assert.equal(v["error"], undefined);
  assert.ok(v["lastSyncAt"] !== undefined);
  assert.equal(w.files.paths().length, 4, w.files.paths().join(", "));
});

test("a folder on a computer: a file name Files cannot hold is shown under a safe name; one change that cannot be taken in is listed and the rest of the report goes in", async () => {
  const w = harness();
  const add = await call(w, "mounts.add", {
    into: "fld_into",
    source: { kind: "local", deviceId: "dev_mac", localPath: "/Users/maya/Contracts" },
  });
  const mountId = String(add["mountId"]);
  const blob = (id: string): string => w.files.blob(id, id);
  const real = w.files.call.bind(w.files);
  w.files.call = (cap: string, i: Row): unknown => {
    if (cap === "files.create" && i["name"] === "refused.txt") throw vyreErr("validation.bad_input", "Refused.");
    return real(cap, i);
  };
  const r = await call(w, "mounts.local_report", {
    mountId,
    deviceId: "dev_mac",
    changes: [
      { path: "tab\tname.txt", op: "add", blobId: blob("b1"), mtime: 1 },
      { path: "refused.txt", op: "add", blobId: blob("b2"), mtime: 1 },
      { path: "after.txt", op: "add", blobId: blob("b3"), mtime: 1 },
    ],
  });
  assert.equal(r["applied"], 2);
  assert.deepEqual(w.files.paths(), ["Contracts/after.txt", "Contracts/tab name.txt"]);
  const v = (await call(w, "mounts.get", { mountId }))["mount"] as Row;
  assert.equal(v["state"], "idle");
  assert.equal(v["skippedCount"], 1);
  assert.equal((v["skipped"] as Row[])[0]?.["name"], "refused.txt");
});

// ---- what goes back to Drive: the display name is never written back and never compared with the source's name ----

const LONG = `${"x".repeat(300)}.pdf`;

/** A person or an agent edits the file in Vyre and the projection hears about it. */
function editInVyre(w: World, display: string, text: string, actor: string): void {
  const fileId = w.files.fileNamed(display).id;
  const fn = localChangesConsumer.on["file.version_added"];
  assert.ok(fn);
  fn(w.ctx.db as never, {
    at: w.now(),
    actor,
    payload: new TextEncoder().encode(JSON.stringify({ fileId, n: w.files.edit(fileId, text) })),
  });
}

for (const actor of ["usr_owner", "agt_helper"]) {
  test(`an edit by ${actor} of a Drive file whose real name Files cannot hold replaces it in place: same Drive id, same real name, nothing created, nothing deleted`, async () => {
    const w = harness();
    listing(w, [
      f("s1", "Q3/Q4 plan.pdf"),
      f("s2", "tab\tname.pdf"),
      f("s3", LONG),
      f("d1x", "Budget.pdf"),
      f("d2x", "Budget.pdf", { modifiedTime: "2026-10-02T10:00:00.000Z" }),
    ]);
    const added = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive", mode: "server_copy" });
    const mountId = String(added["mountId"]);
    const shown = w.files.paths().map((p) => p.replace("Drive/", ""));
    assert.equal(shown.length, 5);
    const before = w.items(mountId).map((i) => [i["remote_id"], i["name"]]);
    for (const display of shown) editInVyre(w, display, `edited ${display.slice(0, 5)}`, actor);
    await call(w, "mounts.sync_now", { mountId });
    assert.deepEqual(w.google.trashed, [], "nothing is deleted at Drive");
    assert.deepEqual(w.google.folders, [], "no folder is made");
    assert.equal(w.google.uploads.length, 5, "one write per file");
    assert.deepEqual(
      w.google.replaced.map((r) => r.remoteId).sort(),
      ["d1x", "d2x", "s1", "s2", "s3"],
      "each file is replaced in place by its Drive id",
    );
    const realNames = new Map([
      ["s1", "Q3/Q4 plan.pdf"],
      ["s2", "tab\tname.pdf"],
      ["s3", LONG],
      ["d1x", "Budget.pdf"],
      ["d2x", "Budget.pdf"],
    ]);
    // the Drive name is the Drive's: what is written back carries the real name, never the display name
    for (const u of w.google.uploads)
      assert.ok([...realNames.values()].includes(u.name), `written back as ${u.name.slice(0, 12)}`);
    assert.deepEqual(
      w.items(mountId).map((i) => [i["remote_id"], i["name"]]),
      before,
      "the items keep their Drive ids and real names",
    );
  });
}

test("a rename typed in Vyre on a file whose display name differs changes the Drive name; an edit alone never does", async () => {
  const w = harness();
  listing(w, [f("s1", "Q3/Q4 plan.pdf")]);
  const added = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive", mode: "server_copy" });
  const mountId = String(added["mountId"]);
  const fileId = w.files.fileNamed("Q3-Q4 plan.pdf").id;
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
});

test("a skipped item is asked about again on every pass: once what refused it is fixed, the next sync brings it in and the count drops", async () => {
  const w = harness();
  w.google.startToken = "tok3"; // the first pass stores a cursor, so the next is a pass over the feed of changes
  let refuse = true;
  const real = w.files.call.bind(w.files);
  w.files.call = (cap: string, i: Row): unknown => {
    if (refuse && cap === "files.create" && i["name"] === "intro.pdf")
      throw vyreErr("validation.bad_input", "Refused.");
    return real(cap, i);
  };
  const added = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  const mountId = String(added["mountId"]);
  const view = async (): Promise<Row> => (await call(w, "mounts.get", { mountId }))["mount"] as Row;
  assert.equal((await view())["skippedCount"], 1);
  assert.ok(!w.files.paths().includes("Drive/intro.pdf"));
  // another pass while it is still refused: still listed once, mount still healthy
  await call(w, "mounts.sync_now", { mountId });
  assert.equal((await view())["skippedCount"], 1);
  assert.equal((await view())["state"], "idle");
  refuse = false;
  const feedBefore = w.google.calls.filter((c) => c.cap === "google.drive.list_changes").length;
  await call(w, "mounts.sync_now", { mountId });
  assert.ok(
    w.google.calls.filter((c) => c.cap === "google.drive.list_changes").length > feedBefore,
    "this was a pass over the feed of changes, not a full listing",
  );
  const v = await view();
  assert.equal(v["skippedCount"], undefined, "the count dropped");
  assert.ok(w.files.paths().includes("Drive/intro.pdf"), "the item is in");
});
