// Pictures for typing into an agent's terminal (15 Nov, rc.29), from the real app: the full-screen terminal with Take over, while you type (the line that says who is typing and that watchers see it), given back,
// and a second person's view while someone types. Dark desktop 1440 wide and light phone 390 wide. Needs the production web export (VYRE_APP_DIST), Chromium and tmux.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = process.env["SHOTS_DIR"] ?? "shots-evidence/b-pc2";
const ROW = '[data-testid^="row-session-"]';

test("pictures: take over, typing, given back; desktop and phone", { timeout: 300_000 }, async (t) => {
  const k = await world(t, { tmux: true });
  if (!k) return;
  const page = k.me.page;
  const bar = page.getByTestId("terminal-popup-bar");
  const rename = (files: string[], to: string): void => files.forEach((f) => fs.renameSync(f, f.replace("-desktop.png", to)));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await k.computerTab();
    await page.locator(ROW).first().click();
    await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
    await bar.getByText("Nobody is typing").waitFor({ timeout: 10_000 });
    await shoot(page, DIR, "a-take-over");
    await page.getByTestId("terminal-take").click();
    await bar.getByText("You have the keyboard").waitFor({ timeout: 10_000 });
    await page.keyboard.type("echo one", { delay: 0 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => /\none\n/.test((document.querySelector("[data-testid=terminal-screen]") as HTMLElement | null)?.innerText ?? ""),
      undefined,
      { timeout: 10_000 },
    );
    await shoot(page, DIR, "b-typing");
    await page.getByTestId("terminal-give").click();
    await bar.getByText("Press Take over, or Return, to type.").waitFor({ timeout: 10_000 });
    await shoot(page, DIR, "c-given-back");
    // phone width: the same three
    await page.keyboard.press("Escape");
    await page.getByTestId("terminal-popup").waitFor({ state: "hidden", timeout: 10_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.getByTestId("pane-button").click().catch(() => undefined);
    await page.getByTestId("tab-computer").or(page.getByTestId("tab-computer-selected")).first().click({ timeout: 15_000 }).catch(() => undefined);
    await page.locator(ROW).first().click({ timeout: 15_000 });
    await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
    await page.getByTestId("terminal-take").waitFor({ timeout: 10_000 });
    await shoot(page, DIR, "d-phone-take-over").then((f) => rename(f, "-phone.png"));
    await page.getByTestId("terminal-take").click();
    await bar.getByText("You have the keyboard").waitFor({ timeout: 10_000 });
    await page.keyboard.type("echo two", { delay: 0 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    await shoot(page, DIR, "e-phone-typing").then((f) => rename(f, "-phone.png"));
    await page.getByTestId("terminal-give").click();
    await page.getByTestId("terminal-take").waitFor({ timeout: 10_000 });
    await shoot(page, DIR, "f-phone-given-back").then((f) => rename(f, "-phone.png"));
    assert.ok(fs.readdirSync(DIR).length >= 6);
    await k.guard.check("keys-once pictures");
  } finally {
    await k.close();
  }
});
