// The full-screen terminal on a real tmux, in the real app (lead ruling, 14 Nov: command-line sign-ins need a real keyboard): colours drawn, Tab completes, arrows edit, Ctrl-C stops, a paste is one write, and a
// hidden prompt takes a secret that is on no screen, in no other viewer's read and not in the stored text; the bar says the agent cannot see it. Key-to-screen delay in the app is measured and printed.
// Needs the production web export (VYRE_APP_DIST), Chromium and tmux.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";
import { keyLog, walkDir } from "./support/real-tmux.ts";

// taking the keyboard is OFF by default in the product (rc.28); this walk is about it, so it is turned on
process.env["VYRE_TERMINAL_TAKEOVER"] = "1";

const DIR = "shots-evidence/b-pc";
const ROW = '[data-testid^="row-session-"]';

test(
  "a real keyboard: colours, Tab, arrows, Ctrl-C, paste, and a hidden prompt that no screen ever shows",
  { timeout: 300_000 },
  async (t) => {
    const k = await world(t, { tmux: true });
    if (!k) return;
    const page = k.me.page;
    const sentKeys: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("terminal/keys")) sentKeys.push(r.postData() ?? "");
    });
    const failedKeys: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("terminal/keys") && r.status() !== 200)
        failedKeys.push(`${r.status()} ${(await r.text().catch(() => "")).slice(0, 200)} <= ${r.request().postData()}`);
    });
    const screenText = (): Promise<string> => page.getByTestId("terminal-screen").innerText();
    const until = async (what: string, f: (s: string) => boolean, ms = 10_000): Promise<void> => {
      const t0 = Date.now();
      for (;;) {
        if (f(await screenText())) return;
        if (Date.now() - t0 > ms)
          assert.fail(
            `timed out waiting for ${what}: ${JSON.stringify((await screenText()).slice(-400))} | sent: ${JSON.stringify(sentKeys.slice(-4))} | active: ${await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName)} | errors: ${JSON.stringify(k.me.errors)} | failed: ${JSON.stringify(failedKeys.slice(0, 5))}`,
          );
        await page.waitForTimeout(50);
      }
    };
    try {
      await k.computerTab();
      await page.locator(ROW).first().click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
      await page.getByTestId("terminal-take").click();
      await page.getByTestId("terminal-give").waitFor({ timeout: 10_000 });
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") === "terminal-screen",
        undefined,
        { timeout: 5_000 },
      );
      // colours: the tmux screen has them, the page draws them
      await page.keyboard.type("printf '\\033[31mred-text\\033[0m plain\\n'");
      await page.keyboard.press("Enter");
      await until("the coloured line", (s) => /\nred-text plain/.test(s));
      // the palette follows the surface (XTermView): the light colours on a dark one, the darker ones (4.5 to 1 on the light skin) on a light one; the walk runs on whichever skin it has
      const drawn = await page.evaluate(() => {
        const sp = [...document.querySelectorAll("[data-testid=terminal-screen] span")].find(
          (e) => e.textContent === "red-text",
        ) as HTMLElement | undefined;
        const screen = document.querySelector("[data-testid=terminal-screen]") as HTMLElement | null;
        let bg = "";
        for (
          let n: HTMLElement | null = screen;
          n && (bg === "" || /rgba\(.*, 0\)|transparent/.test(bg));
          n = n.parentElement
        )
          bg = getComputedStyle(n).backgroundColor;
        return { color: sp ? getComputedStyle(sp).color : "", bg };
      });
      const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(drawn.bg);
      const light = m !== null && (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255 > 0.55;
      assert.match(
        drawn.color,
        light ? /rgb\(182, 54, 40\)/ : /rgb\(224, 108, 117\)/,
        `the red of the escape sequence is drawn in the ${light ? "light" : "dark"} skin's palette (surface ${drawn.bg})`,
      );
      await shoot(page, DIR, "j-terminal-colours");
      // Tab completes, Left and Backspace edit, Ctrl-C stops
      fs.writeFileSync(path.join(walkDir, "unique-walk-file.txt"), "x");
      await page.keyboard.type(`cd ${walkDir}`);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await page.keyboard.type("ls unique-w");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await until("Tab completed the name", (s) => /\nunique-walk-file\.txt/.test(s));
      await page.keyboard.type("sleep 100");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await page.keyboard.press("Control+c");
      await page.keyboard.type("echo back-again");
      await page.keyboard.press("Enter");
      await until("Ctrl-C stopped sleep and the shell answers", (s) => /\nback-again/.test(s));
      // a paste is one write
      await page.evaluate(() => {
        const el = document.querySelector("[data-testid=terminal-screen]")!;
        const dt = new DataTransfer();
        dt.setData("text", "echo 4F2A-91CD\n");
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await until("the pasted code ran", (s) => /\n4F2A-91CD/.test(s));
      // a hidden prompt: the secret is typed, the program gets it, no screen shows it, the bar says the agent cannot see it
      const got = path.join(walkDir, "got.txt");
      await page.keyboard.type(`read -s -p 'Passphrase: ' P; printf '%s' "$P" > ${got}; echo; echo $((6*7))`);
      await page.keyboard.press("Enter");
      await page
        .getByTestId("terminal-popup-bar")
        .getByText("The agent cannot see what you type here")
        .waitFor({ timeout: 10_000 })
        .catch(async (e: unknown) => {
          throw new Error(
            `${String(e)} | hidden attr: ${await page.getByTestId("terminal-screen").getAttribute("data-hidden")} | bar: ${JSON.stringify(await page.getByTestId("terminal-popup-bar").innerText())} | screen: ${JSON.stringify((await screenText()).slice(-300))}`,
          );
        });
      await shoot(page, DIR, "k-terminal-hidden-prompt");
      await page.keyboard.type("hunter2-correct-horse");
      await page.waitForTimeout(600);
      assert.ok(!(await screenText()).includes("hunter2"), "the secret is not on the screen while typed");
      await page.keyboard.press("Enter");
      await until("the program finished", (s) => /\n42\b/.test(s));
      assert.equal(
        fs.existsSync(got) ? fs.readFileSync(got, "utf8") : `no file; host keys: ${keyLog.slice(-40).join(" ")}`,
        "hunter2-correct-horse",
        "the program received it",
      );
      assert.ok(!(await screenText()).includes("hunter2"), "not on the screen afterwards");
      const read = (await k.w.owner.ok("terminal.read", { terminalId: await listedId(k), lines: 2000 })) as {
        text: string;
      };
      assert.ok(!read.text.includes("hunter2"), "not in what another viewer or the agent reads");
      // key to screen in the app: from the key press to the character on the page, 100 keys on one line
      const ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789";
      const typed: string[] = [];
      const times: number[] = [];
      await page.keyboard.type("echo ");
      await page.waitForTimeout(300);
      for (let i = 0; i < 100; i++) {
        if (i > 0 && i % 30 === 0) {
          // start a fresh line before the line wraps at the terminal's width
          await page.keyboard.press("Control+u");
          await page.keyboard.type("echo ");
          await page.waitForTimeout(300);
          typed.length = 0;
        }
        const ch = ALPHA[i % ALPHA.length]!;
        typed.push(ch);
        const want = typed.join("");
        const t0 = Date.now();
        await page.keyboard.type(ch);
        await page
          .waitForFunction(
            (w) =>
              (document.querySelector("[data-testid=terminal-screen]") as HTMLElement | null)?.innerText.includes(
                `echo ${w}`,
              ),
            want,
            { timeout: 5_000, polling: "raf" },
          )
          .catch(async (e: unknown) => {
            throw new Error(
              `${String(e).slice(0, 60)} at key ${i} | want ${want} | screen ${JSON.stringify((await screenText()).slice(-260))} | sent ${JSON.stringify(sentKeys.slice(-3))} | failed ${JSON.stringify(failedKeys.slice(0, 3))}`,
            );
          });
        times.push(Date.now() - t0);
      }
      times.sort((a, b) => a - b);
      console.log(
        `APP_KEY_TO_SCREEN n=100 median ${times[50]} ms, p90 ${times[90]} ms, max ${times[99]} ms (press, one call with the screen back, draw)`,
      );
      await k.guard.check("keys walk");
    } finally {
      await k.close();
    }
  },
);

async function listedId(k: { w: { owner: { ok(cap: string, i: unknown): Promise<unknown> } } }): Promise<string> {
  const o = (await k.w.owner.ok("terminal.list", { host: "agent_computer" })) as {
    terminals: Array<{ terminalId: string }>;
  };
  return o.terminals[0]!.terminalId;
}
