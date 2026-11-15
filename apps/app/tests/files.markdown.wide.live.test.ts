// The owner's two faults (16 Nov 2026): a wide table in a Markdown file uses the free width of the pane (text keeps its reading width), and Edit mode scrolls. A 42 row, 11 column table file in the real app.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";

const COLS = Array.from({ length: 11 }, (_, i) => `Column ${i + 1}`);
const ROWS = Array.from(
  { length: 42 },
  (_, r) => `| ${COLS.map((_c, c) => `Applicant ${r + 1} value ${c + 1} with some words`).join(" | ")} |`,
);
const MD = `# Applicants\n\nA short paragraph above the table.\n\n| ${COLS.join(" | ")} |\n| ${COLS.map(() => "---").join(" | ")} |\n${ROWS.join("\n")}\n\nA closing paragraph.\n`;

test("a wide table grows to the pane while text keeps its column; Edit scrolls and shows the table readably", async (t) => {
  const s = await session(t, { width: 1600, height: 900 });
  if (!s) return;
  const { page } = s;
  try {
    const f = await s.make("applicants.md", Buffer.from(MD), "text/markdown");
    await page.goto(`${s.web.origin}/files#subject=file:${f.file.fileId}`, { waitUntil: "load" });
    await page.getByText("A short paragraph above the table.").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await s.shot("owner-F95-before-or-after-view");
    const m = await page.evaluate(() => {
      const para = [...document.querySelectorAll("*")].find(
        (e) => e.children.length === 0 && e.textContent === "A short paragraph above the table.",
      ) as HTMLElement;
      const tbl = document.querySelector('[data-testid^="table-scroll-"]') as HTMLElement | null;
      const wrap = tbl?.closest('[role="table"]') as HTMLElement | null;
      const pane = document.querySelector('[data-testid="viewer"]') as HTMLElement;
      return {
        para: para.getBoundingClientRect().width,
        table: (wrap ?? tbl)?.getBoundingClientRect().width ?? 0,
        pane: pane.getBoundingClientRect().width,
      };
    });
    console.log("F95 widths", JSON.stringify(m));
    assert.ok(
      m.table > 880 + 40,
      `the table (${m.table}px) grows past the reading column when the pane (${m.pane}px) is wide`,
    );
    assert.ok(m.table <= m.pane, "and stays inside the pane");
    // Edit
    await page.getByTestId("vw-mode-edit").click();
    await page.getByTestId("file-md-editor").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await s.shot("owner-F96-edit-before-or-after");
    const owner = await page.evaluate(() => {
      const ed = document.querySelector('[data-testid="file-md-editor"]') as HTMLElement;
      const chain: string[] = [];
      for (let e: HTMLElement | null = ed; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (/(auto|scroll)/.test(cs.overflowY) || e.scrollHeight > e.clientHeight + 5)
          chain.push(
            `${e.tagName}[${e.getAttribute("data-testid") ?? ""}] oy=${cs.overflowY} sh=${e.scrollHeight} ch=${e.clientHeight}`,
          );
      }
      const inner = [...ed.querySelectorAll("*")]
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 5)
        .map(
          (e) =>
            `${e.tagName}.${(e as HTMLElement).className.toString().slice(0, 30)} sh=${e.scrollHeight} ch=${e.clientHeight}`,
        );
      return { chain, inner };
    });
    console.log("F96 scroll owners", JSON.stringify(owner));
    const box = (await page.getByTestId("file-md-editor").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(400);
    const moved: string[] = await page.evaluate(() => {
      const els = [...document.querySelectorAll("*")] as HTMLElement[];
      return els
        .filter((e) => e.scrollTop > 0)
        .map((e) => `${e.tagName}[${e.getAttribute("data-testid") ?? ""}] ${e.scrollTop}`);
    });
    console.log("F96 moved", JSON.stringify(moved));
    assert.ok(
      moved.some((x) => x.includes("vw-doc-editor")),
      `the wheel scrolls the editor in Edit (${moved.join(", ")})`,
    );
    await s.shot("owner-F96-edit-scrolled");
    const raw = await page.evaluate(() => {
      const r = document.querySelector("pre.vyre-raw, .vyre-raw") as HTMLElement | null;
      if (!r) return null;
      const cs = getComputedStyle(r);
      return {
        font: cs.fontFamily.slice(0, 40),
        ox: cs.overflowX,
        sw: r.scrollWidth,
        cw: r.clientWidth,
        white: cs.whiteSpace,
      };
    });
    console.log("F96 raw table", JSON.stringify(raw));
    assert.ok(
      raw && raw.ox === "auto" && raw.white === "pre",
      "the table in Edit is a monospace block that scrolls sideways, not wrapped text",
    );
  } finally {
    await s.close();
  }
});

test("Edit scrolls on a phone too", async (t) => {
  const s = await session(t, { width: 390, height: 844 });
  if (!s) return;
  const { page } = s;
  try {
    const f = await s.make("applicants.md", Buffer.from(MD), "text/markdown");
    await page.goto(`${s.web.origin}/files#subject=file:${f.file.fileId}`, { waitUntil: "load" });
    await page.getByText("A short paragraph above the table.").waitFor({ timeout: 30_000 });
    await s.shot("owner-F95-phone-view");
    await page.getByTestId("vw-mode-edit").click();
    await page.getByTestId("file-md-editor").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const pb = (await page.getByTestId("vw-doc-editor").boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(400);
    const top = await page.evaluate(
      () => (document.querySelector('[data-testid="vw-doc-editor"]') as HTMLElement).scrollTop,
    );
    assert.ok(top > 0, `scrollTop changes in Edit on a phone (${top})`);
    await s.shot("owner-F96-phone-edit-scrolled");
  } finally {
    await s.close();
  }
});
