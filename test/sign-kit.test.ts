// The browser kit for the signing walks: a claimed Space with the owner signed in (apps/app/tests/viewers-harness.test.ts), a PDF in Files, and a second browser context with no session for the person who is asked to sign.
// Pictures go to VYRE_SIGN_SHOTS. This file is a helper (a --files entry only); the walks that use it are test/sign-send.live.test.ts and test/sign-phone.live.test.ts.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { session } from "../apps/app/tests/viewers-harness.test.ts";
import { makePdf } from "../apps/app/tests/viewer-fixtures.ts";

type Page = import("playwright-core").Page;
type Context = import("playwright-core").BrowserContext;

export type Seat = NonNullable<Awaited<ReturnType<typeof session>>>;

export const NDA = [
  [
    "MUTUAL NON-DISCLOSURE AGREEMENT",
    "",
    "Between Northwind Traders and the undersigned.",
    "",
    "1. Each party keeps the other's information private.",
  ],
  ["2. This agreement lasts two years.", "", "Signed by the parties:"],
];

export async function openSpace(
  t: { skip(m?: string): void },
  size: { width: number; height: number },
  scheme: "dark" | "light",
): Promise<
  | (Seat & {
      fileId: string;
      shotsDir: string;
      signer(size: { width: number; height: number }, scheme: "dark" | "light"): Promise<{ ctx: Context; page: Page }>;
    })
  | null
> {
  const s = await session(t, size, scheme);
  if (!s) return null;
  const f = await s.make("Northwind NDA.pdf", makePdf(NDA), "application/pdf");
  const shotsDir = process.env["VYRE_SIGN_SHOTS"] ?? "/tmp/vyre-sign-shots";
  fs.mkdirSync(shotsDir, { recursive: true });
  return Object.assign(s, {
    fileId: f.file.fileId as string,
    shotsDir,
    // a person with no account and no session: a fresh context, nothing stored, the address in the link only
    signer: async (sz: { width: number; height: number }, sc: "dark" | "light") => {
      const browser = s.ctx.browser()!;
      const phone = sz.width < 600;
      const ctx = await browser.newContext({
        viewport: sz,
        colorScheme: sc,
        deviceScaleFactor: phone ? 2 : 1,
        isMobile: phone,
        hasTouch: phone,
        acceptDownloads: true,
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => s.errors.push(`signer pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") console.log(`SIGNER console: ${m.text().slice(0, 300)}`);
      });
      page.on("requestfailed", (r) =>
        console.log(`SIGNER request failed: ${r.url().slice(-60)} ${r.failure()?.errorText}`),
      );
      page.on("response", (r) => {
        if (r.status() >= 400) console.log(`SIGNER ${r.status()} ${r.url().slice(-60)}`);
      });
      return { ctx, page };
    },
  });
}

/** The link a signer was given, as a path, read from the sent state of the sheet. */
export async function linkOf(page: Page, who: string): Promise<string> {
  const text = await page.getByTestId(`sign-link-${who}`).innerText();
  const m = text.match(/\/p\/sign\/[A-Za-z0-9_-]{43}\//);
  if (!m) throw new Error(`no link for ${who} in: ${text}`);
  return m[0];
}

/** A picture, taken once a sheet's fade-in (about 200 ms) has finished; the wait is for the picture only, nothing is asserted after it. */
export const shot = async (page: Page, dir: string, name: string): Promise<unknown> => {
  await page.waitForTimeout(450);
  return page.screenshot({ path: path.join(dir, `${name}.png`) });
};

/** Sign by typing: the name is already filled from the sender; the consent box, then Sign. */
export async function signByTyping(page: Page, name: string, before?: () => Promise<unknown>): Promise<void> {
  await page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
  await page.fill("#nm", name);
  await page.check("#consent");
  await page.locator("#signcard").scrollIntoViewIfNeeded();
  await before?.();
  await page.click("#signbtn");
  await page.getByText(`Thank you, ${name.split(" ")[0]}`).waitFor({ timeout: 30_000 });
}

/** Sign by drawing: the Draw tab, a stroke across the pad with the pointer, the consent box, Sign. `before` runs when the stroke is there (for a picture). */
export async function signByDrawing(page: Page, name: string, before?: () => Promise<unknown>): Promise<void> {
  await page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
  await page.click("#tab-draw");
  const box = (await page.locator("#drawpad").boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 0; i < 36; i++)
    await page.mouse.move(box.x + 24 + i * ((box.width - 48) / 36), box.y + box.height * 0.55 + Math.sin(i / 2.5) * 28);
  await page.mouse.up();
  await page.check("#consent");
  await page.locator("#signcard").scrollIntoViewIfNeeded();
  await before?.();
  await page.click("#signbtn");
  await page.getByText(`Thank you, ${name.split(" ")[0]}`).waitFor({ timeout: 30_000 });
}

test("the kit loads", () => undefined);
