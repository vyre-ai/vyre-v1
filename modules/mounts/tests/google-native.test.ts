// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/handlers/providers.ts
// @reads /modules/mounts/handlers/native.ts
// Google-native files in a Drive mount (the rc.14 report: a Doc opened as "This file is empty"): a Doc, a Sheet, a Slides deck and a Form keep Google's own type, a Doc is exported as
// Markdown, a Sheet as CSV, Slides as PDF, and a PDF is downloaded as it is. Opening never makes a file. Drive's same-named items get free names before the call, My Drive's "root" alias is
// resolved so the change feed's parents are known, and the mount's folder carries its source.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { harness, vyreErr } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

const call = (w: World, cap: keyof typeof handlers, input: Row, ctx?: Ctx): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(ctx ?? w.ctx, input);

const DRIVE = { kind: "google_drive", connectionId: "con_g", ref: "root_drv" };
const NATIVE = "application/vnd.google-apps.";
const T = "2026-10-03T08:00:00.000Z";

/** Drive's top folder also holds a Slides deck, a Form and a Sheet called Plan, beside the recorded Doc called Plan, the Sheet Budget and intro.pdf. */
function withNatives(w: World): void {
  w.google.put("root_drv", { id: "s1", name: "Pitch", mimeType: `${NATIVE}presentation`, modifiedTime: T });
  w.google.put("root_drv", { id: "q1", name: "Intake", mimeType: `${NATIVE}form`, modifiedTime: T, webViewLink: "https://docs.google.com/forms/d/q1/edit" });
  // Drive keeps both: put() replaces by name, so the second Plan goes straight into the page
  const pages = w.google.listings.get("root_drv") ?? [];
  (pages[pages.length - 1]?.["files"] as Row[]).push({ id: "g9", name: "Plan", mimeType: `${NATIVE}spreadsheet`, modifiedTime: T });
}

const creates = (w: World): Row[] => w.calls.filter((c) => c.cap === "files.create" || c.cap === "files.folder.create").map((c) => c.input as Row);
const fileOf = (w: World, name: string): string => w.files.fileNamed(name).id;

test("a live Drive mount brings a Doc, a Sheet, Slides and a Form in with Google's own types, as placeholders, with no refused create", async () => {
  const w = harness();
  withNatives(w);
  const { mountId } = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  assert.deepEqual(w.files.paths(), ["Drive/Budget", "Drive/Contracts/nda.docx", "Drive/Intake", "Drive/Pitch", "Drive/Plan", "Drive/Plan (Google Drive)", "Drive/intro.pdf"]);
  const mime = (name: string): unknown => [w.files.fileNamed(name).kind, w.files.fileNamed(name).mime];
  assert.deepEqual(mime("Plan"), ["google_native", `${NATIVE}document`]);
  assert.deepEqual(mime("Plan (Google Drive)"), ["google_native", `${NATIVE}spreadsheet`], "a Sheet with a Doc's name takes the next free name");
  assert.deepEqual(mime("Budget"), ["google_native", `${NATIVE}spreadsheet`]);
  assert.deepEqual(mime("Pitch"), ["google_native", `${NATIVE}presentation`]);
  assert.deepEqual(mime("Intake"), ["google_native", `${NATIVE}form`]);
  assert.equal(w.files.fileNamed("intro.pdf").mime, "application/pdf");
  assert.equal(creates(w).length, w.files.files.size + w.files.folders.size - 1, "every create was made once: the free name was chosen before the call");
  assert.equal(w.google.calls.filter((c) => c.cap === "google.drive.export_file" || c.cap === "google.drive.download_file").length, 0, "nothing is fetched until it is opened");
  assert.ok(mountId);
});

test("opening exports a Doc as Markdown, a Sheet as CSV and Slides as PDF, downloads a PDF, fetches nothing for a Form, and never creates a file", async () => {
  const w = harness();
  withNatives(w);
  await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  const before = creates(w).length;
  const opened: Row[] = [];
  for (const name of ["Plan", "Budget", "Pitch", "intro.pdf", "Intake"]) opened.push(await call(w, "mounts.open", { fileId: fileOf(w, name) }));
  assert.deepEqual(opened.map((o) => o["fetched"]), [true, true, true, true, false], "a Form has no export: nothing to fetch, it opens at Google");
  assert.equal(creates(w).length, before, "opening a Drive file never creates one");
  assert.deepEqual(w.google.calls.filter((c) => c.cap === "google.drive.export_file").map((c) => [c.input["fileId"], c.input["mimeType"]]), [["g1", "text/markdown"], ["g2", "text/csv"], ["s1", "application/pdf"]]);
  assert.deepEqual(w.google.calls.filter((c) => c.cap === "google.drive.download_file").map((c) => c.input["fileId"]), ["f1"], "only the PDF has bytes of its own");
  assert.equal(w.files.text(fileOf(w, "Plan")), "export:g1@2026-10-02T09:00:00.000Z");
  assert.equal(w.files.text(fileOf(w, "Intake")), "", "the Form stays empty");
  const again = await call(w, "mounts.open", { fileId: fileOf(w, "Plan") });
  assert.equal(again["fetched"], false, "the export is cached by Drive's version");
  assert.equal(creates(w).length, before);
});

test("a Doc whose Markdown export Drive refuses is read as plain text", async () => {
  const w = harness();
  await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  const real = w.google.call.bind(w.google);
  w.google.call = (cap: string, i: Row): unknown => {
    if (cap === "google.drive.export_file" && i["mimeType"] === "text/markdown") {
      w.google.calls.push({ cap, input: i });
      throw vyreErr("provider.bad_response", "Export only supports these formats.");
    }
    return real(cap, i);
  };
  const r = await call(w, "mounts.open", { fileId: fileOf(w, "Plan") });
  assert.equal(r["fetched"], true);
  assert.deepEqual(w.google.calls.filter((c) => c.cap === "google.drive.export_file").map((c) => c.input["mimeType"]), ["text/markdown", "text/plain"]);
});

test("Drive's same-named items each get a free name, numbered past the first, and a pass with many of them does not fail", async () => {
  const w2 = harness();
  const page2 = (w2.google.listings.get("root_drv") ?? [])[1] as Row;
  for (let i = 0; i < 3; i++) (page2["files"] as Row[]).push({ id: `dup${i}`, name: "Notes", mimeType: `${NATIVE}document`, modifiedTime: T });
  const made = await call(w2, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  assert.equal(w2.mountRow(String(made["mountId"]))["state"], "idle", "the pass did not fail");
  assert.deepEqual(w2.files.paths().filter((p) => p.includes("Notes")), ["Drive/Notes", "Drive/Notes (Google Drive 2)", "Drive/Notes (Google Drive)"]);
  const refused = w2.calls.filter((c) => c.cap === "files.create").length - [...w2.files.files.values()].length;
  assert.equal(refused, 0, "no create was refused");
});

test("a name Vyre already holds that the mount has not seen costs one refused create, then the next name is taken", async () => {
  const w = harness();
  const first = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  const folderId = String(first["folderId"]);
  w.files.call("files.create", { folderId, name: "Plan (Google Drive)" });
  w.google.put("root_drv", { id: "g7", name: "Pitch", mimeType: `${NATIVE}presentation`, modifiedTime: T });
  const pages = w.google.listings.get("root_drv") ?? [];
  (pages[pages.length - 1]?.["files"] as Row[]).push({ id: "g8", name: "Plan", mimeType: `${NATIVE}spreadsheet`, modifiedTime: T });
  w.calls.length = 0;
  await call(w, "mounts.sync_now", { mountId: String(first["mountId"]) });
  assert.deepEqual(w.calls.filter((c) => c.cap === "files.create").map((c) => (c.input as Row)["name"]), ["Pitch", "Plan (Google Drive)", "Plan (Google Drive 2)"]);
  assert.equal(w.mountRow(String(first["mountId"]))["state"], "idle");
});

test("My Drive is mounted by its real id, so a change at its top is applied, not read as a move out; an older mount on the alias scans once more", async () => {
  const w = harness();
  w.google.startToken = "tok1";
  const { mountId } = await call(w, "mounts.add", { into: "fld_into", source: { ...DRIVE, ref: "root" }, name: "My Drive" });
  const root = w.items(String(mountId)).find((r) => r["parent_key"] === null);
  assert.equal(root?.["remote_id"], "root_drv", "the alias is resolved to My Drive's id");
  assert.deepEqual(w.files.paths().filter((p) => p.endsWith("intro.pdf")), ["My Drive/intro.pdf"]);
  // the feed names intro.pdf's parent by its real id: it stays and is marked changed
  await call(w, "mounts.sync_now", { mountId });
  assert.deepEqual(w.files.paths().filter((p) => p.endsWith("intro.pdf")), ["My Drive/intro.pdf"], "a change at the top of My Drive is not a move out");

  // a mount made before the alias was resolved: its root still says "root" and it has a cursor; the next pass scans again and maps the real id
  const old = w.items(String(mountId)).find((r) => r["parent_key"] === null) as Row;
  w.db.run("UPDATE mounts_item SET remote_id = ? WHERE mount_id = ? AND item_key = ?", "root", mountId, old["item_key"]);
  w.google.calls.length = 0;
  await call(w, "mounts.sync_now", { mountId });
  assert.ok(w.google.calls.some((c) => c.cap === "google.drive.list_files"), "the pass scanned");
  assert.equal(w.items(String(mountId)).find((r) => r["parent_key"] === null)?.["remote_id"], "root_drv");
});

test("the mount's folder carries its source, and a kept copy loses it when the mount goes", async () => {
  const w = harness();
  const { mountId, folderId } = await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  assert.deepEqual(w.files.folders.get(String(folderId))?.source, { mountId, provider: "Google Drive" });
  await call(w, "mounts.remove", { mountId, keepCopy: true });
  assert.equal(w.files.folders.get(String(folderId))?.source, null);
});

test("Open in names the Google app: Docs, Sheets and Slides by type, a Form as Google Forms", async () => {
  const w = harness();
  withNatives(w);
  w.google.decorate("f1", { webViewLink: "https://drive.google.com/file/d/f1/view" });
  await call(w, "mounts.add", { into: "fld_into", source: DRIVE, name: "Drive" });
  const openIn = async (name: string): Promise<unknown> => ((await call(w, "mounts.file_link", { fileId: fileOf(w, name) }))["link"] as Row | undefined)?.["openIn"];
  assert.equal(await openIn("Plan"), "Google Docs");
  assert.equal(await openIn("Budget"), "Google Sheets");
  assert.equal(await openIn("Pitch"), "Google Slides");
  assert.equal(await openIn("Intake"), "Google Forms");
  assert.equal(await openIn("intro.pdf"), "Google Drive");
});
