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

test(
  "the desk through a network drop and with two watchers: nothing breaks, nothing is lost, the other window follows",
  { timeout: 300_000 },
  async (t) => {
    const k = await world(t);
    if (!k) return;
    try {
      const page = k.me.page;
      await k.computerTab();
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk-live").waitFor({ timeout: 15_000 });
      // the network drops under the open desk: the desk stays, the page does not crash, and when the network is back the live picture and the controls work again
      await page.context().setOffline(true);
      await page.waitForTimeout(3_000);
      assert.equal(await page.getByTestId("desk").count(), 1, "the desk stays while offline");
      await page.getByTestId("desk").getByText("Offline", { exact: true }).waitFor({ timeout: 5_000 });
      await shoot(page, DIR, "offline");
      await page.context().setOffline(false);
      await page.getByTestId("desk-live").waitFor({ timeout: 30_000 });
      await page.getByTestId("browser-pause").click();
      await page.getByTestId("browser-resume").waitFor({ timeout: 30_000 });
      await page.getByTestId("browser-resume").click();
      await page.getByTestId("browser-pause").waitFor({ timeout: 30_000 });
      // a second window of the same person: it sees the pause the first made, and the first sees the resume the second makes
      const b = await k.watcher();
      await b.page.getByTestId("browser-picture").click();
      await b.page.getByTestId("desk-live").waitFor({ timeout: 15_000 });
      await page.getByTestId("browser-pause").click();
      await page.getByTestId("browser-resume").waitFor({ timeout: 15_000 });
      await b.page.getByTestId("browser-resume").waitFor({ timeout: 30_000 });
      await shoot(b.page, DIR, "second-watcher-paused");
      await b.page.getByTestId("browser-resume").click();
      await b.page.getByTestId("browser-pause").waitFor({ timeout: 15_000 });
      await page.getByTestId("browser-pause").waitFor({ timeout: 30_000 });
      await k.guard.check();
    } finally {
      await k.close();
    }
  },
);

test(
  "the desk's terminal room with a real terminal: the screen is drawn by xterm.js, what is typed shows, dark and light",
  { timeout: 300_000 },
  async (t) => {
    const k = await world(t, { tmux: true });
    if (!k) return;
    try {
      const page = k.me.page;
      await page.setViewportSize({ width: 1440, height: 900 });
      await k.computerTab();
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk").waitFor({ timeout: 15_000 });
      await page.getByTestId("desk-room-term").click();
      // the person's own terminal, in the desk's rail
      await page.getByTestId("desk").getByText("Terminal 1", { exact: true }).click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
      await page.getByTestId("terminal-take").click();
      await page.getByText("You have the keyboard").waitFor({ timeout: 10_000 });
      await page.locator('[data-testid="terminal-screen"][data-renderer="xterm"]').waitFor({ timeout: 20_000 });
      await page.keyboard.type('echo "hello from xterm"; ls --color=always /', { delay: 0 });
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          /hello from xterm\n/.test(
            (document.querySelector("[data-testid=terminal-screen]") as HTMLElement | null)?.innerText ?? "",
          ),
        undefined,
        { timeout: 15_000 },
      );
      await shoot(page, DIR, "xterm");
      // a paste into xterm's own hidden box reaches the terminal through the screen's owner (the one place that sends it), once
      await page.evaluate(() => {
        const ta = document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
        if (!ta) throw new Error("no xterm textarea");
        ta.focus();
        const dt = new DataTransfer();
        dt.setData("text", "echo pasted-once-ok\n");
        ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(
        () =>
          ((document.querySelector("[data-testid=terminal-screen]") as HTMLElement | null)?.innerText ?? "").split(
            "pasted-once-ok",
          ).length >= 3,
        undefined,
        { timeout: 15_000 },
      );
      const shown = await page.evaluate(
        () => (document.querySelector("[data-testid=terminal-screen]") as HTMLElement).innerText,
      );
      assert.equal(shown.split("pasted-once-ok").length - 1, 2, "typed once: the line and its output, nothing twice");
      // a long output scrolls with the wheel (and so the trackpad): the screen sits at the end, a wheel up moves it up, a wheel down brings it back
      await page.keyboard.type("seq 1 300", { delay: 0 });
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          /\n300\n/.test(
            (document.querySelector("[data-testid=terminal-screen]") as HTMLElement | null)?.innerText ?? "",
          ),
        undefined,
        { timeout: 15_000 },
      );
      const top = (): Promise<number> =>
        page.evaluate(() => (document.querySelector("[data-testid=terminal-screen]") as HTMLElement).scrollTop);
      const box = await page.getByTestId("terminal-screen").boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      const atEnd = await top();
      await page.mouse.wheel(0, -800);
      await page.waitForTimeout(400);
      const up = await top();
      assert.ok(up < atEnd, `a wheel up scrolls the screen up (${atEnd} to ${up})`);
      await shoot(page, DIR, "xterm-scrolled");
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(400);
      assert.ok((await top()) > up, "a wheel down scrolls it back");
      await k.guard.check();
    } finally {
      await k.close();
    }
  },
);

test(
  "the send gate while a person holds the keyboard: the agent's send waits for the person and shows Allow on the desk, the person's own send goes straight through",
  { timeout: 300_000 },
  async (t) => {
    const k = await world(t, { model: true });
    if (!k) return;
    try {
      const page = k.me.page;
      const held = async (): Promise<Array<{ id: string; capName: string }>> =>
        (
          (
            (await k.w.owner.ok("gate.holds.list", { states: ["held"] })) as {
              holds?: Array<{ id: string; capName: string }>;
            }
          ).holds ?? []
        ).filter((h) => h.capName === "computers.chrome.send");
      await k.w.owner.ok("threads.set_mode", { threadId: k.threadId, mode: "auto" });
      await k.computerTab();
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk-live").waitFor({ timeout: 15_000 });
      // the person takes the keyboard
      await page.getByTestId("browser-take").click();
      await page.getByTestId("browser-give").waitFor({ timeout: 15_000 });
      // the agent tries to send: it waits, it does not go through
      await k.w.owner.ok("chat.post", {
        threadId: k.threadId,
        body: `TOOL chrome_send ${JSON.stringify({ heldId: "h-agent-1" })}`,
        mentions: [{ kind: "agent", id: k.agentId }],
      });
      const start = Date.now();
      while ((await held()).length === 0) {
        if (Date.now() - start > 40_000) {
          const msgs = JSON.stringify(
            await k.w.owner.ok("chat.messages.list", { threadId: k.threadId }).catch((e: unknown) => String(e)),
          ).slice(-1500);
          throw new Error(`the agent's send never reached the Gate: ${msgs}`);
        }
        await page.waitForTimeout(500);
      }
      assert.equal((await held()).length, 1, "one send waits");
      // the desk offers the person Allow, and the person still holds the keyboard
      await page.getByTestId("browser-allow").waitFor({ timeout: 30_000 });
      await shoot(page, DIR, "send-waits");
      // the person's own send is not held: it goes to the handler at once (which answers for a held item that does not exist), and no second hold appears
      const own = await k.w.owner.call("computers.chrome.send", { agentId: k.agentId, heldId: "h-own-1" });
      assert.notEqual(own.status, 202, `the person's own send is not held: ${JSON.stringify(own.data).slice(0, 200)}`);
      assert.equal((await held()).length, 1, "the person's send made no hold");
      // Allow while the person still holds the keyboard: the send cannot run under their hands, so it keeps waiting and the desk says so in plain words
      await page.getByTestId("browser-allow").click();
      await page
        .getByText(/controls/i)
        .first()
        .waitFor({ timeout: 15_000 });
      assert.equal((await held()).length, 1, "the send still waits while the person holds the keyboard");
      await shoot(page, DIR, "send-waits-for-you");
      // the person gives the keyboard back: now Allow sends it and the hold is decided
      await page.getByTestId("browser-give").click();
      await page.getByTestId("browser-take").waitFor({ timeout: 15_000 });
      await page.getByTestId("browser-allow").click();
      const t0 = Date.now();
      while ((await held()).length > 0) {
        if (Date.now() - t0 > 30_000) {
          await shoot(page, DIR, "send-after-allow");
          throw new Error("the hold was not decided after Allow with the keyboard given back");
        }
        await page.waitForTimeout(500);
      }
      // no crash guard here: the model stand-in answers with its own prompt, which names the agent by id (not the product)
    } finally {
      await k.close();
    }
  },
);
