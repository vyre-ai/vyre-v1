// @tsx
// A tap goes where it says on the phone Files tab (390 wide): one tap on a folder opens it, one tap on a file opens it. It used to only select the row (opening was a double tap, which a phone does not have).
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";

const SCREENS = `[...document.querySelectorAll('[data-testid^="screen-"]')].map((e) => e.getAttribute("data-testid")).join(",")`;

test("phone Files: one tap opens a folder, one tap opens a file; a long press selects", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-files-tap" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api } = k;
  try {
    const tree = await api("files.tree", {});
    const root = (tree.roots as { key: string; folderId: string | null }[]).find((r) => r.key === "personal")!;
    const sub = await api("files.folder.create", {
      parentId: root.folderId,
      name: "Contracts",
      idempotencyKey: "f41-folder",
    });
    await api("files.create", {
      folderId: root.folderId,
      name: "Welcome note.md",
      content: { text: "Welcome to the firm" },
    });
    await api("files.create", {
      folderId: sub.folder.folderId,
      name: "Inside note.md",
      content: { text: "Inside the folder" },
    });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("tab-files").click();
    const screen = (): Promise<string> =>
      page.evaluate(
        `(document.querySelector('[data-testid^="screen-"]') || { innerText: "" }).innerText`,
      ) as Promise<string>;
    await page.locator('[data-testid^="row-line:folder"]').first().waitFor({ timeout: 20_000 });
    await page.locator('[data-testid^="row-line:folder"]').first().click();
    await page.waitForFunction(
      `(document.querySelector('[data-testid^="screen-"]') || { innerText: "" }).innerText.includes("Inside note")`,
      null,
      {
        timeout: 10_000,
      },
    );
    assert.ok(!(await screen()).includes("Welcome note"), "the folder's own list, not the one above");
    // the folder opened; start again at the top for the file
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("tab-files").click();
    await page.locator('[data-testid^="row-line:file"]').first().waitFor({ timeout: 20_000 });
    await page.locator('[data-testid^="row-line:file"]').first().click();
    const opened = page.locator('[data-testid^="screen-file:"]');
    await opened.waitFor({ timeout: 10_000 });
    await page.waitForFunction(
      `(document.querySelector('[data-testid^="screen-file:"]') || { innerText: "" }).innerText.includes("Welcome to the firm")`,
      null,
      { timeout: 10_000 },
    );

    // a long press selects a row (and opens its menu); then a tap adds or removes rows instead of opening; with nothing selected a tap opens
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("tab-files").click();
    const files = page.locator(
      '[data-testid^="row-line:file"]:not([data-testid$="-leading"]):not([data-testid$="-trailing"])',
    );
    await files.first().waitFor({ timeout: 20_000 });
    const cdp = await page.context().newCDPSession(page);
    const box = (await files.first().boundingBox())!;
    const at = { x: Math.round(box.x + 80), y: Math.round(box.y + box.height / 2) };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
    await page.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(
      `document.querySelector('[data-testid^="row-line:file"]').getAttribute("aria-selected") === "true"`,
      null,
      { timeout: 10_000 },
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const stay = (await page.evaluate(SCREENS)) as string;
    // a tap on the selected row while one is selected un-selects it (nothing opens)
    await files.first().click();
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(SCREENS), stay, "a tap with a selection does not open anything");
    assert.equal(
      await files.first().getAttribute("aria-selected"),
      "false",
      "the tap took the row out of the selection",
    );
  } finally {
    await k.close();
  }
});
