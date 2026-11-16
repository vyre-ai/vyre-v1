// The owner's fault F96 (16 Nov 2026): "scroll doesnt work in edit mode". Every editor mode of the Files viewer scrolls with the wheel on a desktop and on a phone: a Markdown file, a Word file, a workbook and a deck.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";
import { makeDocx, makePptx, unzip, zip } from "./viewer-fixtures.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const longDocx = (): Buffer => {
  const parts = unzip(makeDocx());
  const entries: Record<string, string | Buffer> = {};
  for (const [k, v] of Object.entries(parts)) entries[k] = Buffer.from(v);
  const xml = Buffer.from(parts["word/document.xml"] ?? new Uint8Array()).toString("utf8");
  const many = Array.from(
    { length: 160 },
    (_, i) => `<w:p><w:r><w:t>Paragraph ${i + 1} of a long plan, with words to fill the line.</w:t></w:r></w:p>`,
  ).join("");
  entries["word/document.xml"] = xml.includes("<w:sectPr")
    ? xml.replace("<w:sectPr", `${many}<w:sectPr`)
    : xml.replace("</w:body>", `${many}</w:body>`);
  return zip(entries);
};

const longBook = async (): Promise<Buffer> => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const b = wb.addWorksheet("Applicants");
  for (let r = 0; r < 300; r++) b.addRow(Array.from({ length: 12 }, (_, c) => `r${r + 1}c${c + 1}`));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

/** The sample deck with 30 slides (the highlights slide again and again): long enough that its edit view has more to show than the screen holds. */
const longPptx = (): Buffer => {
  const parts = unzip(makePptx());
  const entries: Record<string, string | Buffer> = {};
  for (const [k, v] of Object.entries(parts)) entries[k] = Buffer.from(v);
  const text = (k: string): string => Buffer.from(parts[k] ?? new Uint8Array()).toString("utf8");
  const N = 30;
  const ids = Array.from({ length: N }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("");
  entries["ppt/presentation.xml"] = text("ppt/presentation.xml").replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${ids}</p:sldIdLst>`,
  );
  const rels = Array.from(
    { length: N },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("");
  entries["ppt/_rels/presentation.xml.rels"] = text("ppt/_rels/presentation.xml.rels").replace(
    /(<Relationships[^>]*>)[\s\S]*(<\/Relationships>)/,
    `$1${rels}$2`,
  );
  for (let i = 4; i <= N; i++) entries[`ppt/slides/slide${i}.xml`] = text("ppt/slides/slide2.xml");
  return zip(entries);
};

const MD = `# Long note\n\n${Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of a long note.`).join("\n\n")}\n`;

async function moved(page: import("playwright-core").Page): Promise<string[]> {
  return page.evaluate(() =>
    ([...document.querySelectorAll("*")] as HTMLElement[])
      .filter((e) => e.scrollTop > 0 && e.scrollHeight > e.clientHeight + 20)
      .map((e) => `${e.tagName}[${e.getAttribute("data-testid") ?? ""}]=${e.scrollTop}`),
  );
}

for (const [label, size] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`every editor mode scrolls on a ${label}: Markdown, Word, workbook, a 30 slide deck`, async (t) => {
    const s = await session(t, size);
    if (!s) return;
    const { page } = s;
    try {
      const made: Record<string, string> = {};
      made["md"] = (await s.make("note.md", Buffer.from(MD), "text/markdown")).file.fileId;
      made["docx"] = (await s.make("plan.docx", longDocx(), DOCX)).file.fileId;
      made["xlsx"] = (await s.make("book.xlsx", await longBook(), XLSX)).file.fileId;
      made["pptx"] = (await s.make("deck.pptx", longPptx(), PPTX)).file.fileId;
      const cases: Array<[string, string, string, string]> = [
        ["note.md", "file-md-editor", "md", "vw-markdown"],
        ["plan.docx", "vww", "docx", "vww"],
        ["book.xlsx", "vwg", "xlsx", "vwg"],
        ["deck.pptx", "vws", "pptx", "vws"],
      ];
      for (const [, root, tag, before] of cases) {
        await page.goto(`${s.web.origin}/files#subject=file:${made[tag]}`, { waitUntil: "load" });
        await page.getByTestId(before).waitFor({ timeout: 40_000 });
        await page.getByTestId("vw-mode-edit").click();
        await page.getByTestId(root).waitFor({ timeout: 40_000 });
        await page.waitForTimeout(900);
        const box = (await page.getByTestId(root).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(500);
        const m = await moved(page);
        console.log(`EDIT-SCROLL ${label} ${tag}`, JSON.stringify(m));
        // every one of the four has more than the screen holds, so every one must move
        assert.ok(m.length > 0, `${tag} edit scrolls on a ${label} (${JSON.stringify(m)})`);
        await s.shot(`owner-F96-edit-${tag}-${label}`);
        await page
          .getByTestId("vw-mode-edit")
          .click()
          .catch(() => undefined);
      }
    } finally {
      await s.close();
    }
  });
}
