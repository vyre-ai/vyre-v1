// The browser session the viewer walks share: a claimed fresh Space, a signed-in Chromium page at a size, the capability door as the owner, a folder, a way to make files (over the direct-write size through
// a one-time upload address), and pictures into VYRE_VIEWER_SHOTS.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeDocx, makePdf, makePptx, reportPages, unzip } from "./viewer-fixtures.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";

export async function session(
  t: { skip(m?: string): void },
  size = { width: 1440, height: 900 },
  colorScheme?: "dark" | "light",
) {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required");
    return null;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    ...(colorScheme ? { colorScheme } : {}),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`BROWSER ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/v1\//.test(r.url()))
      void r
        .text()
        .then((b) => console.log(`HTTP ${r.status()} ${r.url().replace(/^.*\/v1\//, "")} ${b.slice(0, 300)}`))
        .catch(() => undefined);
  });
  page.on("requestfailed", (r) => console.log(`REQFAIL ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
  await page.getByTestId("claim-name").fill("Olivia Owner");
  await page.getByTestId("claim-username").fill("olivia");
  await page.getByTestId("claim-password").fill(PASSWORD);
  await page.getByTestId("claim-confirm").fill(PASSWORD);
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-create").click();
  await dismissOnboarding(page);
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
  );
  const call = async (cap: string, data: unknown): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    });
    const body = await r.json();
    assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body)}`);
    return body.data;
  };
  const root = JSON.stringify(await call("files.tree", {})).match(/"(fld_[a-z0-9]+)"/)![1]!;
  const folderId = (await call("files.folder.create", { parentId: root, name: "Viewers", idempotencyKey: "vw" })).folder
    .folderId as string;
  const shots = process.env["VYRE_VIEWER_SHOTS"] ?? "/tmp/vyre-viewer-shots";
  fs.mkdirSync(shots, { recursive: true });
  return {
    page,
    ctx,
    call,
    web,
    folderId,
    errors,
    shot: (n: string) => page.screenshot({ path: path.join(shots, `${n}.png`) }),
    make: async (name: string, bytes: Buffer, mime: string): Promise<any> => {
      let content: unknown = { base64: bytes.toString("base64") };
      if (bytes.length > 190 * 1024) {
        // over the direct-write size: the bytes go to a one-time upload address first
        const slot = await call("files.upload_url", { size: bytes.length, mime });
        const r = await ctx.request.put(`${web.origin}${slot.url}`, {
          headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
          data: bytes,
        });
        assert.ok(r.ok(), `upload ${r.status()}`);
        content = { blobId: slot.blobId };
      }
      return call("files.create", { folderId, name, content, mime, idempotencyKey: `m-${name}` });
    },
    open: async (name: string): Promise<void> => {
      await page.goto(`${web.origin}/files`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByText("Viewers", { exact: true }).first().dblclick();
      await page.getByText(name, { exact: true }).first().waitFor({ timeout: 20_000 });
      await page.getByText(name, { exact: true }).first().dblclick();
    },
    close: async (): Promise<void> => {
      await browser.close();
      web.close();
      await space.stop();
    },
  };
}

test("harness: the sample files the viewer walks open are real files", () => {
  assert.equal(makePdf(reportPages(3)).subarray(0, 5).toString(), "%PDF-");
  assert.ok(unzip(makeDocx())["word/document.xml"]);
  assert.ok(unzip(makePptx())["ppt/slides/slide1.xml"]);
});
