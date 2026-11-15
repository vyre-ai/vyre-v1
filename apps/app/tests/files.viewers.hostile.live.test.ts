// The hostile half of the native viewers walk (split from files.viewers.live.test.ts so each file stays inside its 120 s cap on a busy box): a javascript: link is plain text, a picture on another site is not fetched, a zip bomb is refused in one sentence, a workbook the editor would change is read only.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";
import { makeDocx, unzip, zip, zipOfZeros } from "./viewer-fixtures.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("hostile files in the real app: a javascript: link is plain text, a picture on another site is not fetched, a zip bomb is refused in one sentence, a workbook with sparklines is read only", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page } = s;
  try {
    const files = unzip(makeDocx());
    const rels = new TextDecoder().decode(files["word/_rels/document.xml.rels"]!);
    const doc = new TextDecoder().decode(files["word/document.xml"]!);
    const evil = {
      ...files,
      "word/_rels/document.xml.rels": new TextEncoder().encode(
        rels.replace(
          "</Relationships>",
          '<Relationship Id="rIdJ" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/><Relationship Id="rIdP" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://tracker.example/pixel.png" TargetMode="External"/></Relationships>',
        ),
      ),
      "word/document.xml": new TextEncoder().encode(
        doc
          .replace(
            "<w:body>",
            '<w:body><w:p><w:hyperlink r:id="rIdJ"><w:r><w:t>click me</w:t></w:r></w:hyperlink></w:p>',
          )
          .replace('<a:blip r:embed="rId8"/>', '<a:blip r:link="rIdP"/>'),
      ),
    };
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await s.make(
      "hostile.docx",
      Buffer.from(zip(Object.fromEntries(Object.entries(evil).map(([k, v]) => [k, Buffer.from(v)])))),
      DOCX,
    );
    await s.open("hostile.docx");
    await page.getByTestId("vww").waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('a[href^="javascript"]').count(), 0, "no javascript: address reaches the page");
    assert.equal((await page.getByText("click me").count()) >= 1, true, "its words are still shown");
    assert.equal(await page.getByTestId("vww-ext-img").count(), 1, "the linked picture is a placeholder");
    assert.equal(
      requests.some((u) => /tracker\.example/.test(u)),
      false,
      "nothing was fetched from another site",
    );
    // a 1 GiB bomb
    await s.make("bomb.docx", zipOfZeros(1 << 30), DOCX);
    await s.open("bomb.docx");
    await page
      .getByText("This file unpacks to more than 300 MB, so it is not opened here. Open it in its own app.")
      .waitFor({ timeout: 30_000 });
    // a workbook with sparklines (an extension a save would drop) is read only, with the reason
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("A").addRow([1, 2]);
    const x = unzip(Buffer.from(await wb.xlsx.writeBuffer()));
    const sheet = new TextDecoder()
      .decode(x["xl/worksheets/sheet1.xml"]!)
      .replace("</worksheet>", '<extLst><ext uri="{x}"/></extLst></worksheet>');
    await s.make(
      "spark.xlsx",
      Buffer.from(
        zip(
          Object.fromEntries(
            Object.entries({ ...x, "xl/worksheets/sheet1.xml": new TextEncoder().encode(sheet) }).map(([k, v]) => [
              k,
              Buffer.from(v),
            ]),
          ),
        ),
      ),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    await s.open("spark.xlsx");
    await page.getByTestId("vwg").waitFor({ timeout: 30_000 });
    await page
      .getByTestId("vw-mode-edit")
      .click()
      .catch(() => undefined);
    await page.getByTestId("vwg-cell-0-0").click();
    assert.match(
      await page.getByTestId("vwg").innerText(),
      /This workbook has extensions such as sparklines or conditional formats that a save here would drop or change\./,
    );
  } finally {
    await s.close();
  }
});
