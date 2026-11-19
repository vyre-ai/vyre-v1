// The agent's desk walked in the real app (lane r42-computer, owner-approved 19 Nov): the Computer tab's browser picture opens the desk full, F and Esc go back to where it was opened from, it shrinks to a small
// live picture that comes back, Pause holds the agent and Resume lets it go, Take over and Give back, and the three rooms. Pictures in dark and light under shots-evidence/computer-desk. Needs the production web export
// (VYRE_APP_DIST) and Chromium; the Space browser is the stand-in the other Computer tab walks use (the app, the capabilities and the daemon are real).
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-desk";

test(
  "the desk: full view, back, minimise and return, pause and resume, take over and give back, the rooms",
  { timeout: 300_000 },
  async (t) => {
    const k = await world(t);
    if (!k) return;
    try {
      const page = k.me.page;
      await k.computerTab();
      await page.getByTestId("browser-picture").waitFor({ timeout: 20_000 });
      // the dock: the Computer tab's own picture, nothing over the app
      assert.equal(await page.getByTestId("desk").count(), 0);
      await shoot(page, DIR, "dock");
      // press the picture: the desk grows to the full view over the dimmed app
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk").waitFor({ timeout: 10_000 });
      await page.getByTestId("desk-live").waitFor({ timeout: 10_000 });
      await shoot(page, DIR, "full");
      const box = await page.getByTestId("desk").boundingBox();
      const win = page.viewportSize();
      assert.ok(
        box && win && box.width > win.width * 0.9 && box.height > win.height * 0.9,
        `the full view fills about 95% of the window: ${JSON.stringify(box)} in ${JSON.stringify(win)}`,
      );
      // F goes back to the pane the desk was opened from; the pane's picture is there again
      await page.keyboard.press("f");
      await page
        .getByTestId("desk")
        .waitFor({ state: "detached", timeout: 10_000 })
        .catch(async (e: unknown) => {
          const where = await page.evaluate(() => {
            const m = document.querySelector(
              '[aria-modal="true"]:not([data-testid="desk"]):not([data-testid="desk-mini"]):not([aria-hidden="true"]), [role="menu"]:not([aria-hidden="true"]):not([hidden]), [role="listbox"]:not([aria-hidden="true"]):not([hidden])',
            );
            return m
              ? `${m.tagName} role=${m.getAttribute("role")} testid=${m.getAttribute("data-testid")} modal=${m.getAttribute("aria-modal")} ${m.outerHTML.slice(0, 200)}`
              : "no other modal";
          });
          throw new Error(`F did not leave the full view; the focus is on ${where}: ${String(e)}`);
        });
      await page.getByTestId("browser-picture").waitFor({ timeout: 10_000 });
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk").waitFor({ timeout: 10_000 });
      // minimise: a small live picture stays over the chat; pressing it brings the full view back; Esc then goes back to the small picture
      await page.getByTestId("desk-minimise").click();
      await page.getByTestId("desk-mini").waitFor({ timeout: 10_000 });
      assert.equal(await page.getByTestId("desk").count(), 0);
      await shoot(page, DIR, "mini");
      await page.getByTestId("desk-mini-open").click();
      await page.getByTestId("desk").waitFor({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await page.getByTestId("desk-mini").waitFor({ timeout: 10_000 });
      await page.getByTestId("desk-mini-open").click();
      await page.getByTestId("desk").waitFor({ timeout: 10_000 });
      // pause: the bar says Paused with Resume; the Space's own table holds it (the profile row says who)
      await page.getByTestId("browser-pause").click();
      await page.getByTestId("browser-resume").waitFor({ timeout: 15_000 });
      await shoot(page, DIR, "paused");
      const row = (await k.w.owner.ok("computers.browser.profiles", {})) as {
        profiles: Array<{ agentId: string; pausedBy?: string }>;
      };
      assert.ok(row.profiles.find((p) => p.agentId === k.agentId)?.pausedBy, "the Space says the browser is paused");
      await page.getByTestId("browser-resume").click();
      await page.getByTestId("browser-pause").waitFor({ timeout: 15_000 });
      // take over: the bar says you have the browser and offers Give back; keys belong to the page
      await page.getByTestId("browser-take").click();
      await page.getByTestId("browser-give").waitFor({ timeout: 15_000 });
      await shoot(page, DIR, "your-turn");
      await page.getByTestId("browser-give").click();
      await page.getByTestId("browser-take").waitFor({ timeout: 15_000 });
      // the rooms: Terminal and Files are in the same desk, same shape
      const xtermSeen: string[] = [];
      page.on("response", (r) => {
        if (/xterm/i.test(r.url())) xtermSeen.push(`${r.status()} ${r.headers()["content-type"] ?? ""} ${r.url()}`);
      });
      page.on("pageerror", (e) => xtermSeen.push(`pageerror ${String(e).slice(0, 300)}`));
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning")
          if (!/status of 422/.test(m.text())) xtermSeen.push(`console ${m.type()}: ${m.text().slice(0, 200)}`);
      });
      await page.getByTestId("desk-room-term").click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 15_000 });
      // when the room shows the full screen (not the line terminal), xterm.js has taken over from the plain screen
      if ((await page.getByTestId("terminal-screen").count()) > 0)
        await page
          .locator('[data-testid="terminal-screen"][data-renderer="xterm"]')
          .waitFor({ timeout: 15_000 })
          .catch(async (e: unknown) => {
            const seen = await page.evaluate(
              () =>
                `renderer=${document.querySelector('[data-testid="terminal-screen"]')?.getAttribute("data-renderer")} why=${document.querySelector('[data-testid="terminal-screen"]')?.getAttribute("data-renderer-why")} xterm-host=${document.querySelectorAll('[data-testid="terminal-xterm"]').length} xterm-chunk=${performance.getEntriesByType("resource").some((r) => /XTermView/.test(r.name))}`,
            );
            throw new Error(`xterm did not take over: ${seen} seen=${JSON.stringify(xtermSeen)}: ${String(e)}`);
          });
      await shoot(page, DIR, "terminal");
      assert.equal(await page.getByTestId("desk-live").count(), 0);
      await page.getByTestId("desk-room-files").click();
      await page.getByTestId("files-room").waitFor({ timeout: 15_000 });
      await shoot(page, DIR, "files");
      await page.getByTestId("desk-room-browser").click();
      await page.getByTestId("desk-live").waitFor({ timeout: 10_000 });
      await page.getByTestId("desk-close").click();
      await page.getByTestId("desk").waitFor({ state: "detached", timeout: 10_000 });
      await k.guard.check();
    } finally {
      await k.close();
    }
  },
);
