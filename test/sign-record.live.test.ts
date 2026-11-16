// Send for signature from a record: the record's Files tab lists its PDF with a Sign control, the same sheet opens with the record named, and after Send the signature request is a related item on the record with
// its state (Waiting for Imran). Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { openSpace, shot } from "./sign-kit.test.ts";
import { makePdf } from "../apps/app/tests/viewer-fixtures.ts";
import { NDA } from "./sign-kit.test.ts";

test("sign: a record's Files tab sends its PDF for signature and shows the request as a related item", async (t) => {
  const s = await openSpace(t, { width: 1440, height: 900 }, "dark");
  if (!s) return;
  try {
    const { page } = s;
    const rec = (
      await s.call("records.create", { type: "company", fields: { name: "Northwind" }, idempotencyKey: "sign-rec" })
    ).record as { id: string };
    const folder = (await s.call("projects.files_folder", { type: "company", recordId: rec.id })).folderId as string;
    await s.call("files.create", {
      folderId: folder,
      name: "Northwind services agreement.pdf",
      content: { base64: makePdf(NDA).toString("base64") },
      mime: "application/pdf",
      idempotencyKey: "sign-rec-file",
    });
    await page.goto(`${s.web.origin}/records#subject=record:${rec.id}&type=company`, { waitUntil: "load" });
    // the Files tab sits behind the pane's More tabs at this width
    await page.getByLabel("More tabs").click({ timeout: 40_000 });
    await page.getByText("Files", { exact: true }).last().click();
    const row = page.locator('[data-testid^="sign-file-"]').first();
    await row.waitFor({ timeout: 30_000 });
    await shot(page, s.shotsDir, "record-files-before-dark");
    await row.click();
    await page.getByTestId("sign-sheet").waitFor({ timeout: 10_000 });
    await page.getByTestId("sign-name-0").fill("Imran Ibarra");
    await page.getByTestId("sign-email-0").fill("imran@northwind.example");
    await page.getByTestId("sign-send").click();
    await page.getByTestId("sign-sheet-sent").waitFor({ timeout: 30_000 });
    await page.getByTestId("sign-done").click();
    // the request is now a related item on the record, with its state: on the Files tab, and in the Everything feed
    await page.getByText("Waiting for Imran").first().waitFor({ timeout: 30_000 });
    await shot(page, s.shotsDir, "record-envelope-dark");
    await page.getByText("Everything", { exact: true }).locator("visible=true").first().click();
    await page.getByText("Signature", { exact: true }).first().waitFor({ timeout: 20_000 });
    assert.ok((await page.getByTestId("pane-everything").innerText()).includes("Northwind services agreement.pdf"));
    await shot(page, s.shotsDir, "record-everything-dark");
    // the command palette reaches the same sheet: the action, the PDF, the sheet
    await page.keyboard.press("Control+k");
    await page.keyboard.type(">signature");
    await page.getByText("Send a file for signature").first().click();
    await page.getByTestId("sign-picker").waitFor({ timeout: 10_000 });
    await page.getByTestId("sign-picker-search").fill("agreement");
    await shot(page, s.shotsDir, "palette-picker-dark");
    await page.locator('[data-testid="sign-picker-list"] >> text=Northwind services agreement.pdf').first().click();
    await page.getByTestId("sign-sheet").waitFor({ timeout: 10_000 });
    assert.match(await page.getByTestId("sign-file").innerText(), /Northwind services agreement\.pdf/);
    await page.getByTestId("sign-cancel").click();
    await page.getByTestId("sign-sheet").waitFor({ state: "detached", timeout: 10_000 });
    // the same on a phone, light: the pane opens from the Details control, Files is behind More tabs
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${s.web.origin}/records#subject=record:${rec.id}&type=company`, { waitUntil: "load" });
    await page.getByLabel("Details").first().click({ timeout: 40_000 });
    await page.getByLabel("More tabs").click({ timeout: 20_000 });
    await page.getByText("Files", { exact: true }).locator("visible=true").last().click();
    await page.getByText("Waiting for Imran").first().waitFor({ timeout: 30_000 });
    await shot(page, s.shotsDir, "record-envelope-light-phone");
    // Cancel request, from the file it was sent from: the status says Cancelled and the link stops working
    const asked = await s.call("esign.list", { recordId: rec.id });
    const sentFile = asked.envelopes[0].fileId as string;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${s.web.origin}/files#subject=file:${sentFile}`, { waitUntil: "load" });
    await page.getByTestId("vw-more").click({ timeout: 40_000 });
    await page.getByText("Cancel signature request").click();
    await page.getByText("Cancelled", { exact: true }).first().waitFor({ timeout: 20_000 });
    assert.equal((await s.call("esign.status", { envelopeId: asked.envelopes[0].envelopeId })).status, "cancelled");
    await shot(page, s.shotsDir, "file-cancelled-dark");
    const listed = await s.call("esign.list", { recordId: rec.id });
    assert.equal(listed.envelopes.length, 1, "the request is tied to the record");
    assert.deepEqual(
      s.errors.filter((e) => !/net::ERR|favicon/i.test(e)),
      [],
      "no page errors",
    );
  } finally {
    await s.close();
  }
});
