// @heavy docker
// An agent's computer, walked the way a person uses it, on a booted daemon with a REAL workspace container and a REAL Space browser (rc.29, lane w-computer, 15 Nov 2026). The walker of 15 Nov only had a
// scripted terminal and never saw it work: the Computer tab said Asleep beside a running terminal, the first typed command was not echoed, the terminal said "read-only, you do not have access" to its owner and
// stuck on "Starting". One walk in a real Chromium against the production export (VYRE_APP_DIST), with VYRE_HEAVY_DOCKER=1, VYRE_WORKSPACE_TEST_IMAGE (the agent workspace image) and VYRE_SPACE_BROWSER_IMAGE
// (the Space browser image). Pictures, dark at 1440 and light at 390, go to shots-evidence/w-computer/real. The other items of the lane are walked in the two files beside it (a file may not run past 120 s):
// agent-computer.people.walk.live.test.ts (a second person, the phone) and agent-computer.older.walk.live.test.ts (the older desktop, a server that cannot run computers).
//   1 the state words are true: Asleep before anything runs, Ready or Running once a terminal is open, Asleep again when the computer sleeps, Ready again when a terminal wakes it
//   2 the terminal is usable at once: three commands typed quickly run once each in order, a letter typed while only watching says what to press, the owner never reads "read-only, you do not have access"
//   3 the browser shows: the still picture, the live view when pressed, Take over and Give back, no viewer left behind when it closes, asleep again with "Last seen"
import test from "node:test";
import { execFile } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/w-computer/real";
fs.rmSync(DIR, { recursive: true, force: true });
const WIDE = { width: 1440, height: 900 };
const IMAGES = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const BROWSER = process.env["VYRE_SPACE_BROWSER_IMAGE"];

test(
  "an agent's computer on a real workspace and a real browser: the words are true, the terminal answers at once, the browser shows",
  { timeout: 300_000 },
  async (t) => {
    if (!IMAGES || !BROWSER) {
      t.skip("needs VYRE_HEAVY_DOCKER=1, VYRE_WORKSPACE_TEST_IMAGE and VYRE_SPACE_BROWSER_IMAGE");
      return;
    }
    const k = await world(t, { noTerminal: true, realWorkspace: true, realBrowser: BROWSER });
    if (!k) return;
    const page = k.me.page;
    const text = async (id: string): Promise<string> => (await page.getByTestId(id).innerText()).replace(/\s+/g, " ");
    try {
      await page.setViewportSize(WIDE);
      // ---- 1 before anything runs
      await k.computerTab();
      await page.getByTestId("terminals-head").waitFor({ timeout: 30_000 });
      // read at once: the pane opens the agent's terminal by itself, so the computer wakes a moment later
      const body0 = await page.getByTestId("work-list").innerText();
      const before = await text("terminals-head");
      assert.match(before, /Asleep/, `before a terminal runs the head says Asleep: ${before}`);
      await shoot(page, DIR, "asleep-before-anything-runs");
      assert.match(body0, /wakes when needed/i, "the asleep computer says it wakes when needed");

      // ---- 2 the pane opens the agent's terminal by itself (the computer wakes): the head never says Asleep once it is there, within the start budget the pane draws (9 s)
      const started = Date.now();
      let head = "";
      for (;;) {
        head = await text("terminals-head");
        if (/Ready|Running/.test(head)) break;
        assert.ok(Date.now() - started < 9000, `the computer is waking and after 9 s the head still says: ${head}`);
        await page.waitForTimeout(100);
      }
      console.log(`WALK head ${head} after ${Date.now() - started} ms`);
      await page.getByTestId("row-session-agent").waitFor({ timeout: 10_000 });
      assert.match(await text("row-session-agent"), /Running|Idle|Ready/, "the row says what the terminal is doing");
      await page.getByTestId("row-session-agent").click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 30_000 });
      head = await text("terminals-head");
      assert.match(head, /Ready|Running/, `a terminal is open and the head says: ${head}`);
      await shoot(page, DIR, "terminal-opening");
      await page.getByTestId("terminal-screen").waitFor({ timeout: 30_000 });
      assert.doesNotMatch(
        await page.getByTestId("terminal-popup").innerText(),
        /read-only|do not have access/i,
        "the owner is never told the terminal is read-only",
      );
      // watching: a letter does not type and does not take the keyboard, and the bar says what to press (the drawing, B1)
      await page.getByTestId("terminal-screen").focus();
      await page.keyboard.type("x");
      assert.match(await page.getByTestId("terminal-popup").innerText(), /Press Take over to type/);
      await page.getByTestId("terminal-take").click();
      await page.getByTestId("terminal-give").waitFor({ timeout: 15_000 });
      const screen = page.getByTestId("terminal-screen");
      await screen.focus();
      // three commands in a row, quickly: each runs once, in order
      for (const n of [1, 2, 3]) {
        await page.keyboard.type(`printf 'out-%s\\n' ${n}`);
        await page.keyboard.press("Enter");
      }
      const out = async (): Promise<string[]> =>
        (await screen.innerText())
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^out-\d$/.test(l));
      const t0 = Date.now();
      while ((await out()).length < 3 && Date.now() - t0 < 10_000) await page.waitForTimeout(150);
      assert.deepEqual(await out(), ["out-1", "out-2", "out-3"], "the three commands ran once each, in order");
      assert.ok(Date.now() - t0 < 5000, "answered at once");
      await shoot(page, DIR, "terminal-three-commands");
      await page.getByTestId("terminal-give").click();
      await page.getByTestId("terminal-popup-close").click();
      await page.getByTestId("terminal-popup").waitFor({ state: "detached", timeout: 10_000 });
      assert.match(await text("terminals-head"), /Ready|Running/);
      const g0 = Date.now();
      while (/keyboard/.test(await text("row-session-agent")) && Date.now() - g0 < 12_000)
        await page.waitForTimeout(100);
      console.log(`WALK row after give back: ${await text("row-session-agent")} after ${Date.now() - g0} ms`);
      assert.match(await text("row-session-agent"), /Running|Idle/);
      await shoot(page, DIR, "computer-tab-running");

      // ---- 2b the computer sleeps and is woken from a terminal: Asleep, then Starting in the terminal's bar, then Ready within the budget the bar draws (9 s), and the first command is answered
      await new Promise<void>((done) => execFile("docker", ["stop", "-t", "2", `vyre-ws-${k.agentId}`], () => done()));
      const slept = Date.now();
      while (!/Asleep/.test(await text("terminals-head")) && Date.now() - slept < 20_000)
        await page.waitForTimeout(250);
      assert.match(await text("terminals-head"), /Asleep/, "a computer with no container says Asleep");
      assert.match(await text("row-session-agent"), /Asleep/, "and so does the row of its terminal");
      await shoot(page, DIR, "computer-asleep-with-terminal");
      await page.getByTestId("row-session-agent").click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 30_000 });
      const woke = Date.now();
      let barText = await page.getByTestId("terminal-popup").innerText();
      const seenStarting = /Starting/.test(barText);
      if (seenStarting) await shoot(page, DIR, "terminal-starting");
      while (/Starting/.test(barText) && Date.now() - woke < 9000) {
        await page.waitForTimeout(150);
        barText = await page.getByTestId("terminal-popup").innerText();
      }
      assert.doesNotMatch(barText, /Starting/, `still Starting after ${Date.now() - woke} ms (the budget is 9 s)`);
      {
        const hw = Date.now();
        while (!/Ready|Running/.test(await text("terminals-head")) && Date.now() - hw < 9000)
          await page.waitForTimeout(150);
      }
      assert.match(
        await text("terminals-head"),
        /Ready|Running/,
        `awake again: the head says so (${await text("terminals-head")}; sheet: ${barText.replace(/\s+/g, " ").slice(0, 200)}; seen starting: ${seenStarting}; container: ${await new Promise((r) => execFile("docker", ["inspect", "-f", "{{.State.Status}}", `vyre-ws-${k.agentId}`], (_e, o) => r(o.trim())))})`,
      );
      await page.getByTestId("terminal-take").click();
      await page.getByTestId("terminal-give").waitFor({ timeout: 15_000 });
      await page.getByTestId("terminal-screen").focus();
      await page.keyboard.type("printf 'woke-%s\\n' ok");
      await page.keyboard.press("Enter");
      const w0 = Date.now();
      while (!/^woke-ok$/m.test(await screen.innerText()) && Date.now() - w0 < 9000) await page.waitForTimeout(150);
      assert.match(await screen.innerText(), /^woke-ok$/m, "the first command after waking was answered");
      await shoot(page, DIR, "terminal-after-waking");
      await page.getByTestId("terminal-give").click();
      await page.getByTestId("terminal-popup-close").click();
      await page.getByTestId("terminal-popup").waitFor({ state: "detached", timeout: 10_000 });

      // ---- 3 the browser shows: the still picture in the pane, the live view when pressed, Take over and Give back, asleep again with "Last seen"
      assert.match(await text("browser-head"), /Live/, "the browser the agent opened is live");
      const still = page.getByTestId("browser-picture");
      await still.waitFor({ timeout: 20_000 });
      let drawn = false;
      for (let i = 0; i < 80 && !drawn; i++) {
        drawn = await page.evaluate(() => {
          const layers = [...document.querySelectorAll("[data-testid^=browser-preview-]")] as HTMLElement[];
          return layers.some((e) => e instanceof HTMLImageElement && e.naturalWidth > 1);
        });
        if (!drawn) await page.waitForTimeout(250);
      }
      assert.ok(drawn, "the pane shows the browser's still picture");
      await shoot(page, DIR, "browser-still-picture");
      const viewers = async (): Promise<number> =>
        ((await k.w.owner.call("computers.browser.profiles", {})).data.profiles as Array<{ viewers: number }>)[0]
          ?.viewers ?? 0;
      const stages: string[] = [`pane ${await viewers()}`];
      const streams: string[] = [];
      page.on("response", (r) => {
        if (/\/stream/.test(r.url()))
          streams.push(`${r.status()} ${r.headers()["content-type"] ?? ""} ${r.url().slice(0, 140)}`);
      });
      page.on("requestfailed", (r) => {
        if (/\/stream/.test(r.url())) streams.push(`FAILED ${r.failure()?.errorText} ${r.url().slice(0, 140)}`);
      });
      await still.click();
      await page.getByTestId("desk").waitFor({ timeout: 15_000 });
      await page.getByTestId("browser-live-view-image").waitFor({ timeout: 30_000 });
      // the live view has its first frame: an image that has loaded, or a canvas that has been sized for the page
      const frame = (): Promise<{ tag?: string; w?: number; h?: number; nat?: number; bg?: boolean }> =>
        page.evaluate(() => {
          const el = document.querySelector("[data-testid=browser-live-view-image]") as HTMLElement | null;
          const img = el instanceof HTMLImageElement ? el : (el?.querySelector("img") as HTMLImageElement | null);
          return {
            ...(el ? { tag: el.tagName, w: el.clientWidth, h: el.clientHeight } : {}),
            ...(img ? { nat: img.naturalWidth } : {}),
            bg:
              el !== null &&
              [el, ...el.querySelectorAll("*")].some((x) => /url\(/.test(getComputedStyle(x).backgroundImage)),
          };
        });
      let f = await frame();
      const lv0 = Date.now();
      while (!(f.tag === "CANVAS" ? f.w !== 300 : (f.nat ?? 0) > 1 || f.bg === true) && Date.now() - lv0 < 15_000) {
        await page.waitForTimeout(250);
        f = await frame();
      }
      assert.ok(
        f.tag === "CANVAS" ? f.w !== 300 : (f.nat ?? 0) > 1 || f.bg === true,
        `the live view drew no frame: ${JSON.stringify(f)} ${JSON.stringify(k.me.logs.slice(-6))} ${JSON.stringify(streams)} ${await page.getByTestId("desk").innerText()}`,
      );
      stages.push(`watching ${await viewers()}`);
      await shoot(page, DIR, "browser-live-view");
      await page.getByTestId("browser-take").click();
      await page.getByTestId("browser-give").waitFor({ timeout: 20_000 });
      stages.push(`taken ${await viewers()}`);
      await shoot(page, DIR, "browser-taken-over");
      await page.getByTestId("browser-give").click();
      await page.getByTestId("browser-take").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      stages.push(`given back ${await viewers()}`);
      await page.getByTestId("desk-close").click();
      await page.getByTestId("desk").waitFor({ state: "detached", timeout: 10_000 });
      // asleep again: the pane says so, with when it was last seen. Closing the live view lets go of its stream: nobody is watching, so the browser can sleep.
      const v0 = Date.now();
      while ((await viewers()) > 0 && Date.now() - v0 < 8000) await page.waitForTimeout(250);
      assert.equal(
        await viewers(),
        0,
        `closing the live view left a viewer on the browser for ${Date.now() - v0} ms (${stages.join(", ")})`,
      );
      await k.real!.stop(k.agentId);
      const slept0 = Date.now();
      while (!/Asleep/.test(await text("browser-head")) && Date.now() - slept0 < 20_000) await page.waitForTimeout(250);
      assert.match(
        await text("browser-head"),
        /Asleep/,
        `the browser was stopped: ${JSON.stringify((await k.w.owner.call("computers.browser.profiles", {})).data)}`,
      );
      assert.match(await text("browser-caption"), /Asleep\. Last seen/, "asleep says when it was last seen");
      await shoot(page, DIR, "browser-asleep-last-seen");
      // woken from the tab: pressing the sleeping picture opens the sheet, which starts the browser and shows it live
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk").waitFor({ timeout: 15_000 });
      let g = await frame();
      const wk0 = Date.now();
      while (!(g.tag === "CANVAS" ? g.w !== 300 : (g.nat ?? 0) > 1 || g.bg === true) && Date.now() - wk0 < 30_000) {
        await page.waitForTimeout(250);
        g = await frame();
      }
      assert.ok(
        g.tag === "CANVAS" ? g.w !== 300 : (g.nat ?? 0) > 1 || g.bg === true,
        `pressing the sleeping browser did not wake it to a live view: ${JSON.stringify(g)}`,
      );
      await shoot(page, DIR, "browser-woken-from-the-tab");
      await page.getByTestId("desk-close").click();
      await page.getByTestId("desk").waitFor({ state: "detached", timeout: 10_000 });
    } finally {
      await k.close();
    }
  },
);
