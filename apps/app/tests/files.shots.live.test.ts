// Pictures of the Files fixes (F20, F21, F27) from the real app: Files with pictures drawn, the viewer on a picture and on a CSV, and Back from the viewer by the shell's own arrow. Dark desktop 1440 wide and
// light phone 390 wide. VYRE_FILES_SHOTS names the folder the pictures go into.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
/** A real 64 by 64 red PNG, built here (a 1 by 1 picture is one pixel at 100%, which reads as an empty checkerboard). */
function redPng(): string {
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([200, 30, 30], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
const PNG = redPng();

test("pictures: Files with pictures, the viewer on a picture and on a CSV, and Back, in dark on a desktop and light on a phone", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_FILES_SHOTS"] ?? "/tmp/vyre-files-shots";
  fs.mkdirSync(shots, { recursive: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD);
    await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
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
    const folderId = (await call("files.folder.create", { parentId: root, name: "Walk", idempotencyKey: "walk" }))
      .folder.folderId as string;
    const make = (name: string, content: unknown, mime: string): Promise<any> =>
      call("files.create", { folderId, name, content, mime, idempotencyKey: `w-${name}` });
    await make("logo.png", { base64: PNG }, "image/png");
    await make("badge.png", { base64: PNG }, "image/png");
    await make(
      "fees.csv",
      { text: `client,fee\n${Array.from({ length: 3000 }, (_, i) => `client ${i + 1},${i + 1}`).join("\n")}\n` },
      "text/csv",
    );
    const drawn = (): Promise<boolean> =>
      page.evaluate(() =>
        [...document.querySelectorAll("img, [data-testid]")].some(
          (e) =>
            (e instanceof HTMLImageElement &&
              e.complete &&
              e.naturalWidth > 1 &&
              e.getBoundingClientRect().width > 20) ||
            (/blob:/.test(getComputedStyle(e).backgroundImage) && e.getBoundingClientRect().width > 20),
        ),
      );
    const run = async (tag: "desktop-dark" | "phone-light", phone: boolean): Promise<void> => {
      await page.emulateMedia({ colorScheme: phone ? "light" : "dark" });
      await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      const shot = (n: string): Promise<unknown> => page.screenshot({ path: path.join(shots, `${tag}-${n}.png`) });
      await page.goto(`${web.origin}/files#subject=folder:${folderId}`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByText("fees.csv", { exact: true }).first().waitFor({ timeout: 20_000 });
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[data-testid="thumb-image"]')].some(
            (e) =>
              (e instanceof HTMLImageElement && e.complete && e.naturalWidth > 1) ||
              /blob:/.test(getComputedStyle(e).backgroundImage),
          ),
        null,
        { timeout: 20_000 },
      );
      await shot("1-files-with-pictures");
      await page.getByText("logo.png", { exact: true }).first().dblclick();
      await page.waitForFunction(() => /subject=file/.test(location.hash), null, { timeout: 10_000 });
      await page.waitForTimeout(1500);
      assert.ok(await drawn(), `${tag}: the picture is drawn in the viewer`);
      await shot("2-viewer-picture");
      const back = page.getByTestId(phone ? "mobile-back" : "nav-back").first();
      await back.click();
      await page.getByText("fees.csv", { exact: true }).first().waitFor({ timeout: 15_000 });
      await shot("3-back-to-the-list");
      await page.getByText("fees.csv", { exact: true }).first().dblclick();
      await page.getByText("client 1", { exact: false }).first().waitFor({ timeout: 30_000 });
      await shot("4-viewer-csv");
    };
    await run("desktop-dark", false);
    await run("phone-light", true);
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
