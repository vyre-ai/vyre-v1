// Pictures of the Computer tab as built, from the real app (b-pc, 14 Nov 2026): the pane, the browser full screen (watching, in control, starting), the terminal full screen, an asleep browser, at 1440 wide and
// at phone width, light and dark. They are looked at beside the prototype's pictures (team/v1/prototypes/shots-pc-13nov). Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import { shoot, SIZES } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/b-pc";
const ROW = '[data-testid^="row-session-"]';
const WIDE = { width: 1440, height: 900 };

test("pictures of every state built", { timeout: 420_000 }, async (t) => {
  const k = await world(t);
  if (!k) return;
  const page = k.me.page;
  try {
    await page.setViewportSize(WIDE);
    await k.computerTab();
    await page.locator(ROW).first().waitFor({ timeout: 20_000 });
    await page.getByTestId("browser-picture").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await shoot(page, DIR, "a-pane-lived-in");
    // the browser full screen: watching, in control
    await page.getByTestId("browser-picture").click();
    await page.getByTestId("browser-popup").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await shoot(page, DIR, "b-browser-watching");
    await page.getByTestId("browser-take").click();
    await page.getByTestId("browser-give").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await shoot(page, DIR, "c-browser-in-control");
    await page.getByTestId("browser-give").click();
    await page.getByTestId("browser-take").waitFor({ timeout: 20_000 });
    await page.getByTestId("browser-popup-close").click();
    // the terminal full screen
    await page.locator(ROW).first().click();
    await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
    await page.getByTestId("terminal-tab").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await shoot(page, DIR, "d-terminal");
    await page.keyboard.press("Escape");
    // a sleeping browser: the pane, then the sheet starting
    const row = k.browserd.rows.get(k.agentId)!;
    k.browserd.rows.set(k.agentId, { ...row, running: false });
    await page.getByText("Asleep", { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await shoot(page, DIR, "e-pane-browser-asleep");
    await page.getByTestId("browser-picture").click();
    await page.getByTestId("browser-popup").waitFor({ timeout: 10_000 });
    await shoot(page, DIR, "f-browser-starting");
    await page.getByTestId("browser-popup-close").click();
    // phone width: the chat, then its pane's Computer tab, then both sheets
    await page.setViewportSize(SIZES.phone);
    await page.waitForTimeout(800);
    await page.getByTestId("pane-button").click().catch(() => undefined);
    await page.getByTestId("tab-computer").click({ timeout: 15_000 }).catch(() => undefined);
    await page.getByTestId("browser-picture").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await shoot(page, DIR, "g-phone-pane");
    await page.getByTestId("browser-picture").click();
    await page.getByTestId("browser-popup").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shoot(page, DIR, "h-phone-browser");
    await page.getByTestId("browser-popup-close").click();
    await page.locator(ROW).first().click();
    await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
    await page.getByTestId("terminal-tab").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await shoot(page, DIR, "i-phone-terminal");
    await k.guard.check("pictures");
  } finally {
    await k.close();
  }
});
