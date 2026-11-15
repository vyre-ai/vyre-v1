// The native viewers' save path in a connected Google Drive, on a booted daemon against the stand-in Drive (nothing inside the daemon is faked): a Word file, a deck and a workbook that Drive holds are read
// whole, edited with the viewer's own models, and written back with files.write: Drive gets a NEW REVISION of the SAME file with only the edit changed; a file Drive locks is view only; an edit over a
// change made at Drive meanwhile is held.
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { MEMBER } from "../fixtures/suite/world.ts";
import { bootDriveWorld } from "./mounts.drive.live.test.ts";
import { makeDocx, makePptx, unzip, zip } from "../apps/app/tests/viewer-fixtures.ts";
import { applyRunTexts, readDocx, textRuns, writeDocx } from "../ui/src/Viewer/rich/docx.ts";
import { readPptx, setParaRuns, writePptx } from "../ui/src/Viewer/rich/pptx.ts";
import { Grid, key } from "../ui/src/Viewer/rich/grid-model.ts";
import { baseline, readBook, writeChanges } from "../ui/src/Viewer/rich/workbook-io.ts";
import type { XBook } from "../ui/src/Viewer/rich/workbook-io.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const rezip = (e: Record<string, Uint8Array>): Buffer =>
  zip(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Buffer.from(v)])));

async function book(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Budget");
  a.addRow(["Item", "Cost"]);
  a.addRow(["Paper", 12]);
  a.addRow(["Total", { formula: "SUM(B2:B2)", result: 12 }]);
  wb.addWorksheet("Notes").addRow(["keep me"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("a Word file, a deck and a workbook in a connected Drive are edited in the viewer's models and arrive at Drive as new revisions of the same files", async () => {
  const docx = makeDocx();
  const pptx = makePptx();
  const xlsx = await book();
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("vwdrive", (d) => {
    d.put({ id: "w1", name: "Plan.docx", mimeType: DOCX }, new Uint8Array(docx));
    d.put({ id: "p1", name: "Review.pptx", mimeType: PPTX }, new Uint8Array(pptx));
    d.put({ id: "x1", name: "Budget.xlsx", mimeType: XLSX }, new Uint8Array(xlsx));
  });
  try {
    const added = await mount();
    const read = async (name: string) => {
      const f = await fileNamed(added.folderId, name);
      assert.ok(f, `${name} is listed`);
      const r = await w.ok(MEMBER, "files.read", { fileId: f.fileId, as: "base64" });
      return { f, bytes: Buffer.from(r.base64, "base64") };
    };
    const write = async (fileId: string, bytes: Buffer) => {
      await w.ok(MEMBER, "files.write", {
        fileId,
        content: { base64: bytes.toString("base64") },
        reason: "Edited in the viewer",
        idempotencyKey: w.idem(),
      });
      await sync(added.mountId);
    };
    // Word
    {
      const { f, bytes } = await read("Plan.docx");
      assert.deepEqual(bytes, docx, "Vyre holds the Drive file's bytes whole");
      const m = readDocx(unzip(bytes));
      const p = m.paras[1]!;
      applyRunTexts(
        m,
        p,
        textRuns(p).map((r) => (r.text === "next quarter" ? "coming quarter" : r.text)),
      );
      await write(f.fileId, rezip(writeDocx(m)));
      assert.equal(drive.files.get("w1")!.head, 2, "a new revision of the same file");
      const after = unzip(Buffer.from(drive.files.get("w1")!.bytes));
      const was = unzip(docx);
      for (const k of Object.keys(was)) if (k !== "word/document.xml") assert.deepEqual(after[k], was[k], k);
      assert.match(new TextDecoder().decode(after["word/document.xml"]!), /coming quarter/);
    }
    // PowerPoint
    {
      const { f, bytes } = await read("Review.pptx");
      const m = readPptx(unzip(bytes));
      const s = m.slides[1]!;
      setParaRuns(s, s.shapes[1]!.paras.find((q) => q.text === "Costs stayed flat")!, ["Costs fell slightly"]);
      await write(f.fileId, rezip(writePptx(m)));
      assert.equal(drive.files.get("p1")!.head, 2);
      assert.match(
        new TextDecoder().decode(unzip(Buffer.from(drive.files.get("p1")!.bytes))["ppt/slides/slide2.xml"]!),
        /Costs fell slightly/,
      );
    }
    // Excel
    {
      const { f, bytes } = await read("Budget.xlsx");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes as never);
      const grid = new Grid(readBook(wb as unknown as XBook));
      const was = baseline(grid.book);
      grid.setCell(grid.book.sheets[0]!, 1, 1, "20");
      assert.equal(grid.book.sheets[0]!.cells.get(key(2, 1))!.v, 20);
      writeChanges(grid, wb as unknown as XBook, was);
      await write(f.fileId, Buffer.from(await wb.xlsx.writeBuffer()));
      assert.equal(drive.files.get("x1")!.head, 2);
      const re = new ExcelJS.Workbook();
      await re.xlsx.load(Buffer.from(drive.files.get("x1")!.bytes) as never);
      assert.equal(re.getWorksheet("Budget")!.getCell("B2").value, 20);
      assert.equal(re.getWorksheet("Notes")!.getCell("A1").value, "keep me");
    }
    assert.deepEqual(drive.creates, [], "no second file was made");
    const row = await w.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.state, "idle", String(row.mount.error ?? ""));
  } finally {
    await w.stop();
  }
});

test("a Word file Drive locks is view only in the viewer, and an edit over a change made at Drive meanwhile is held", async () => {
  const docx = makeDocx();
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("vwlock", (d) => {
    d.put({ id: "w1", name: "Locked.docx", mimeType: DOCX, canEdit: false }, new Uint8Array(docx));
    d.put({ id: "w2", name: "Mine.docx", mimeType: DOCX }, new Uint8Array(docx));
  });
  try {
    const added = await mount();
    const locked = await fileNamed(added.folderId, "Locked.docx");
    const mine = await fileNamed(added.folderId, "Mine.docx");
    assert.ok(locked && mine);
    const v = await w.ok(MEMBER, "files.viewer_data", { fileId: locked.fileId });
    assert.equal(v.canEdit, false, "the viewer gets no typing for a locked file");
    assert.equal(v.connected.viewOnly, true);
    await w.ok(MEMBER, "files.read", { fileId: mine.fileId, as: "base64" });
    await w.ok(MEMBER, "files.write", {
      fileId: mine.fileId,
      content: { base64: docx.toString("base64") },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    drive.elsewhere("w2", "kim's words");
    await sync(added.mountId);
    assert.equal(drive.text("w2"), "kim's words", "Drive was not overwritten");
    const opened = await w.ok(MEMBER, "mounts.open", { fileId: mine.fileId });
    assert.equal(opened.source.conflict, true, "the choice is Keep both or Use theirs");
  } finally {
    await w.stop();
  }
});

import { bookFromRows, cellWrites } from "../ui/src/Viewer/rich/workbook-io.ts";

test("a Google Sheet in a connected Drive: every tab is listed and read through the Sheets path, a cell typed in the grid reaches that tab at Google, and a viewer without edit rights is refused", async () => {
  const { w, drive, mount, fileNamed } = await bootDriveWorld("vwsheet", (d) => {
    d.put({ id: "s1", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" }, "");
    d.sheet("s1", {
      Costs: [
        ["Item", "Cost"],
        ["Paper", "12"],
        ["Ink", "30"],
      ],
      "Tax rates": [
        ["Region", "Rate"],
        ["North", "0.1"],
      ],
    });
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Budget");
    assert.ok(f, "the Sheet is listed");
    // what the viewer does on opening: list the tabs, read each one
    const { tabs } = await w.ok(MEMBER, "mounts.sheet_tabs", { fileId: f.fileId });
    assert.deepEqual(
      tabs.map((t: { title: string }) => t.title),
      ["Costs", "Tax rates"],
    );
    const sheets = [];
    for (const tab of tabs) {
      const r = await w.ok(MEMBER, "mounts.sheet_read", { fileId: f.fileId, sheet: tab.title, range: "A1:ZZ2000" });
      sheets.push(
        ...bookFromRows(
          r.values.map((row: unknown[]) => row.map((v) => String(v ?? ""))),
          tab.title,
        ).sheets,
      );
    }
    assert.equal(sheets.length, 2, "both tabs are in the grid");
    // the person types into the second tab and the first
    const grid = new Grid({ sheets });
    const was = baseline(grid.book);
    grid.setCell(grid.book.sheets[1]!, 1, 1, "0.2");
    grid.setCell(grid.book.sheets[0]!, 3, 0, "Total");
    for (const wr of cellWrites(grid, was))
      await w.ok(MEMBER, "mounts.sheet_write", {
        fileId: f.fileId,
        sheet: wr.sheet,
        range: `${"ABCDEFGH"[wr.c]}${wr.r + 1}`,
        values: [[wr.value]],
        idempotencyKey: w.idem(),
      });
    assert.deepEqual(
      drive.sheetWrites.map((x) => [x.tab, x.range, x.values[0]![0]]),
      [
        ["Costs", "Costs!A4", "Total"],
        ["Tax rates", "'Tax rates'!B2", "0.2"],
      ],
    );
    assert.equal(
      drive.sheetTabs.get("s1")!.get("Tax rates")![1]![1],
      "0.2",
      "the cell is changed at Google, in the tab it was typed in",
    );
    // someone who may not edit the Sheet at Google is refused by Google, in words
    drive.files.get("s1")!.canEdit = false;
    const refused = await w.call(MEMBER, "mounts.sheet_write", {
      fileId: f.fileId,
      sheet: "Costs",
      range: "B2",
      values: [["1"]],
      idempotencyKey: w.idem(),
    });
    assert.notEqual(refused.status, 200);
    assert.equal(drive.sheetTabs.get("s1")!.get("Costs")![1]![1], "12");
  } finally {
    await w.stop();
  }
});
