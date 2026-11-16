// The owner's two faults (16 Nov 2026), second half: in Edit a table is a table of cells (Tab, Enter, the cell menu, a pasted block), and in View a wide table keeps its first column and header row in view. Same 42 row, 11 column table file.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";

const COLS = Array.from({ length: 11 }, (_, i) => `Column ${i + 1}`);
const ROWS = Array.from(
  { length: 42 },
  (_, r) => `| ${COLS.map((_c, c) => `Applicant ${r + 1} value ${c + 1} with some words`).join(" | ")} |`,
);
const MD = `# Applicants\n\nA short paragraph above the table.\n\n| ${COLS.join(" | ")} |\n| ${COLS.map(() => "---").join(" | ")} |\n${ROWS.join("\n")}\n\nA closing paragraph.\n`;

test("in Edit a table is a table of cells: Tab goes across, Enter goes down, the cell's menu adds a row, a block of cells pastes in, and the table grows to the pane", async (t) => {
  const s = await session(t, { width: 1600, height: 900 });
  if (!s) return;
  const { page } = s;
  page.on("pageerror", (e) => console.log("PAGEERR", e.message.slice(0, 400)));
  try {
    const f = await s.make("applicants.md", Buffer.from(MD), "text/markdown");
    await page.goto(`${s.web.origin}/files#subject=file:${f.file.fileId}`, { waitUntil: "load" });
    await page.getByText("A short paragraph above the table.").waitFor({ timeout: 30_000 });
    await page.getByTestId("vw-mode-edit").click();
    await page.getByTestId("md-table").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    const shape = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="md-table"]') as HTMLElement;
      const para = [...document.querySelectorAll(".vyre-md p")].find((p) =>
        /short paragraph/.test(p.textContent ?? ""),
      ) as HTMLElement;
      return {
        rows: t.querySelectorAll("tr").length,
        cols: t.querySelectorAll("tr:first-child th").length,
        table: t.getBoundingClientRect().width,
        para: para.getBoundingClientRect().width,
        raw: document.querySelectorAll("pre.vyre-raw").length,
      };
    });
    console.log("edit table", JSON.stringify(shape));
    assert.equal(shape.raw, 0, "no raw pipes");
    assert.equal(shape.rows, 43);
    assert.equal(shape.cols, 11);
    await s.shot("owner-F96-edit-table");
    const at = async () =>
      page.evaluate(() => {
        const n = getSelection()?.anchorNode as Node | null;
        const td = (n && (n.nodeType === 1 ? (n as Element) : n.parentElement))?.closest(
          "td,th",
        ) as HTMLTableCellElement | null;
        return td ? { r: (td.parentElement as HTMLTableRowElement).rowIndex, c: td.cellIndex } : null;
      });
    await page.locator('[data-testid="md-table"] tbody tr:nth-child(3) td:nth-child(2)').click();
    const a = await at();
    await page.keyboard.press("Tab");
    const b = await at();
    assert.deepEqual([b?.r, b?.c], [a!.r, a!.c + 1], "Tab goes across");
    await page.keyboard.press("Enter");
    const c = await at();
    assert.deepEqual([c?.r, c?.c], [a!.r + 1, a!.c + 1], "Enter goes down");
    // the menu
    await page.getByTestId("md-table-menu-btn").first().dispatchEvent("mousedown");
    await page.getByTestId("md-table-act-row-below").waitFor();
    await s.shot("owner-F96-edit-table-menu");
    await page.getByTestId("md-table-act-row-below").click();
    assert.equal(await page.locator('[data-testid="md-table"] tr').count(), 44, "a row added");
    // a block of cells from a sheet
    await page.locator('[data-testid="md-table"] tbody tr:nth-child(6) td:nth-child(2)').click();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "p1\tp2\tp3\nq1\tq2\tq3");
      (document.querySelector('[data-testid="md-table"]')!.closest(".ProseMirror") as HTMLElement).dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(300);
    const pasted = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-testid="md-table"] td')].filter((d) =>
          /^\u22EF?(p|q)[123]$/.test(d.textContent ?? ""),
        ).length,
    );
    if (pasted !== 6) {
      const where = await page.evaluate(() =>
        [...document.querySelectorAll("td")]
          .filter((d) => /p1|q1/.test(d.textContent ?? ""))
          .map((d) => (d.textContent ?? "").slice(0, 60)),
      );
      console.log("PASTE-DEBUG", JSON.stringify(where));
    }
    assert.equal(pasted, 6, "six cells pasted");
    await s.shot("owner-F96-edit-table-pasted");
    // wide: the table is wider than the 720 px text when the pane is wide
    assert.ok(
      shape.table > shape.para + 100,
      `the table (${shape.table}) is wider than the text (${shape.para}) in Edit`,
    );
  } finally {
    await s.close();
  }
});

test("in View a wide table that scrolls sideways keeps its first column in view, and its header row stays while it scrolls down", async (t) => {
  const s = await session(t, { width: 900, height: 700 });
  if (!s) return;
  const { page } = s;
  try {
    const f = await s.make("applicants.md", Buffer.from(MD), "text/markdown");
    await page.goto(`${s.web.origin}/files#subject=file:${f.file.fileId}`, { waitUntil: "load" });
    await page.getByText("A short paragraph above the table.").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    const m = await page.evaluate(async () => {
      const sc = document.querySelector('[data-testid^="table-scroll-"]') as HTMLElement;
      const first = () =>
        (document.querySelector('[data-testid$="-0-0"][data-testid^="cell-"]') as HTMLElement).getBoundingClientRect()
          .left;
      const head = () => (document.querySelector('[data-testid^="thead-"]') as HTMLElement).getBoundingClientRect().top;
      const before = { left: first(), top: head(), scrollW: sc.scrollWidth, clientW: sc.clientWidth };
      sc.scrollLeft = 400;
      sc.scrollTop = 300;
      await new Promise((r) => setTimeout(r, 200));
      return {
        before,
        afterLeft: first(),
        afterTop: head(),
        scrolledX: sc.scrollLeft,
        scrolledY: sc.scrollTop,
        scrollTopHead: sc.getBoundingClientRect().top,
      };
    });
    console.log("STICKY", JSON.stringify(m));
    assert.ok(m.before.scrollW > m.before.clientW, "the table scrolls sideways at this width");
    assert.ok(m.scrolledX > 0, "it scrolled");
    assert.ok(Math.abs(m.afterLeft - m.before.left) < 2, "the first column stays where it was");
    assert.ok(
      m.afterTop >= m.scrollTopHead - 2 && m.afterTop <= m.scrollTopHead + 40,
      "the header row stays at the top of the table while its rows scroll",
    );
    await s.shot("owner-F95-sticky-scrolled");
  } finally {
    await s.close();
  }
});
