// The live browser view against the real Space browser in Docker (box run: VYRE_HEAVY_DOCKER=1 and VYRE_SPACE_BROWSER_IMAGE=<a built space-browser image>; no CI job builds that image for a walk, so this one is not in
// shots.yml and skips elsewhere). Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-tab-bugs";

// The same, against the real Space browser in Docker (VYRE_HEAVY_DOCKER=1 and VYRE_SPACE_BROWSER_IMAGE; the page the agent has open changes every 40 ms). Watching is the MJPEG stream through the daemon;
// after Take over the frames come on the WebSocket. Whatever draws them, the box keeps its size, the picture is never blank between two frames, and a canvas that draws them is never cleared:
// setting a canvas's size clears it, so it may be sized once, for the page.
test(
  "on the real Space browser: watching and in control, the picture is never blank between frames and the box never changes size",
  { timeout: 110_000 },
  async (t) => {
    const image = process.env["VYRE_SPACE_BROWSER_IMAGE"];
    if (process.env["VYRE_HEAVY_DOCKER"] !== "1" || !image) {
      t.skip("needs VYRE_HEAVY_DOCKER=1 and VYRE_SPACE_BROWSER_IMAGE");
      return;
    }
    const k = await world(t, { realBrowser: image });
    if (!k) return;
    try {
      // count what is drawn on canvases from the start of the page
      await k.me.page.addInitScript(() => {
        const w = window as unknown as { __cv: { draws: number; resizes: number } };
        w.__cv = { draws: 0, resizes: 0 };
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...a: unknown[]) {
          w.__cv.draws++;
          return (draw as (...x: unknown[]) => void).apply(this, a);
        };
        const sent: string[] = [];
        (w as unknown as { __sent: string[] }).__sent = sent;
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (d: unknown) {
          if (typeof d === "string") sent.push(d);
          return (send as (x: unknown) => void).call(this, d);
        };
        const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
        Object.defineProperty(HTMLCanvasElement.prototype, "width", {
          configurable: true,
          get() {
            return width.get!.call(this);
          },
          set(v: number) {
            w.__cv.resizes++;
            width.set!.call(this, v);
          },
        });
      });
      await k.computerTab();
      await k.me.page.getByTestId("browser-live-view-image").waitFor({ timeout: 30_000 });
      const sample = (ms: number) =>
        k.me.page.evaluate(async (span) => {
          const out: Array<{ pic: string | null; w: number; h: number }> = [];
          const t0 = Date.now();
          while (Date.now() - t0 < span) {
            const el = document.querySelector("[data-testid=browser-live-view-image]") as HTMLElement | null;
            const tag = el?.querySelector("img") as HTMLImageElement | null;
            const bg = el ? /url\("?([^")]+)"?\)/.exec(getComputedStyle(el).backgroundImage)?.[1] : undefined;
            const box = (
              document.querySelector("[data-testid=browser-live]") as HTMLElement | null
            )?.getBoundingClientRect();
            // a canvas is the picture itself: it is there, and it is blank only while it has never been drawn on (its size is still the default)
            const picture =
              el instanceof HTMLCanvasElement ? (el.width !== 300 ? "canvas" : "") : tag?.currentSrc || bg || "";
            out.push({ pic: picture || null, w: Math.round(box?.width ?? 0), h: Math.round(box?.height ?? 0) });
            await new Promise((r) => setTimeout(r, 25));
          }
          return out;
        }, ms);
      const summary = (log: Array<{ pic: string | null; w: number; h: number }>) => {
        let blanksAfterFirst = 0,
          changes = 0,
          seen = false,
          last: string | null = null;
        for (const x of log) {
          if (x.pic === null) {
            if (seen) blanksAfterFirst++;
          } else {
            seen = true;
            if (last !== null && x.pic !== last) changes++;
            last = x.pic;
          }
        }
        return { samples: log.length, blanksAfterFirst, changes, sizes: [...new Set(log.map((x) => `${x.w}x${x.h}`))] };
      };
      const counts = () =>
        k.me.page.evaluate(() => (window as unknown as { __cv: { draws: number; resizes: number } }).__cv);
      const watching = summary(await sample(8_000));
      await shoot(k.me.page, `${DIR}/b3-real`, "watching");
      await k.me.page.getByTestId("browser-picture").click();
      await k.me.page.getByTestId("browser-popup").waitFor({ timeout: 10_000 });
      await k.me.page.getByTestId("browser-take").click();
      await k.me.page.getByTestId("browser-give").waitFor({ timeout: 20_000 });
      const before = await counts();
      const inControl = summary(await sample(8_000));
      const after = await counts();
      await shoot(k.me.page, `${DIR}/b3-real`, "in-control");
      const drawn = { draws: after.draws - before.draws, resizes: after.resizes - before.resizes };
      assert.equal(
        watching.blanksAfterFirst,
        0,
        `watching: blank in ${watching.blanksAfterFirst} of ${watching.samples} samples`,
      );
      assert.equal(
        inControl.blanksAfterFirst,
        0,
        `in control: blank in ${inControl.blanksAfterFirst} of ${inControl.samples} samples`,
      );
      assert.equal(watching.sizes.length, 1, `watching: the box changed size ${watching.sizes}`);
      assert.equal(inControl.sizes.length, 1, `in control: the box changed size ${inControl.sizes}`);
      assert.ok(drawn.draws >= 30, `in control the page's frames are painted on a canvas (${drawn.draws} in 8 s)`);
      // a press on the canvas reaches the page where it was pressed: the centre of the page, and a point a quarter of the way in, whatever bars the box leaves around the picture
      const geometry = await k.me.page.evaluate(() => {
        const r = (
          document.querySelector("[data-testid=browser-live-view-image]") as HTMLElement
        ).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const kScale = Math.min(geometry.w / 1280, geometry.h / 800);
      const ox = geometry.x + (geometry.w - 1280 * kScale) / 2,
        oy = geometry.y + (geometry.h - 800 * kScale) / 2;
      for (const [fx, fy] of [
        [0.5, 0.5],
        [0.25, 0.25],
        [0.8, 0.6],
      ] as const) {
        await k.me.page.evaluate(() => {
          (window as unknown as { __sent: string[] }).__sent.length = 0;
        });
        await k.me.page.mouse.click(ox + fx * 1280 * kScale, oy + fy * 800 * kScale);
        const moves = await k.me.page.evaluate(() =>
          (window as unknown as { __sent: string[] }).__sent
            .map((m) => JSON.parse(m) as { t: string; x?: number; y?: number })
            .filter((m) => m.t === "move"),
        );
        assert.equal(moves.length, 1, "one move per press");
        const downs = await k.me.page.evaluate(() =>
          (window as unknown as { __sent: string[] }).__sent
            .map((m) => JSON.parse(m) as { t: string; n?: number })
            .filter((m) => m.t === "down"),
        );
        assert.deepEqual(
          downs.map((d) => d.n),
          [1],
          "the left button, as browserd numbers it (1)",
        );
        assert.ok(
          Math.abs(moves[0]!.x! - fx * 1280) <= 3 && Math.abs(moves[0]!.y! - fy * 800) <= 3,
          `a press at ${fx},${fy} of the page sent ${JSON.stringify(moves[0])}`,
        );
      }
      // keys and the wheel reach the page too: a click in its input, then typing, then scrolling over the picture
      const page = (expression: string) =>
        k
          .real!.tool({
            profileId: k.agentId,
            tool: "chrome_eval",
            args: { expression },
            timeoutMs: 30_000,
            by: "person",
          })
          .then((r) => (r as { result?: unknown }).result);
      await k.me.page.mouse.click(ox + 200 * kScale, oy + 120 * kScale); // inside the page's input (x 100..400, y 100..140)
      await k.me.page.keyboard.type("hi there");
      let typed = "";
      for (let i = 0; i < 40 && typed !== "hi there"; i++) {
        typed = String(await page("document.getElementById('t').value"));
        if (typed !== "hi there") await new Promise((r) => setTimeout(r, 100));
      }
      const diag = {
        typed,
        active: String(
          await page("document.activeElement && (document.activeElement.id || document.activeElement.tagName)"),
        ),
        sent: await k.me.page.evaluate(() => (window as unknown as { __sent: string[] }).__sent.slice(-12)),
      };
      assert.equal(
        typed,
        "hi there",
        `the keys typed in control mode reached the page's input ${JSON.stringify(diag)}`,
      );
      await k.me.page.mouse.move(ox + 640 * kScale, oy + 500 * kScale);
      await k.me.page.mouse.wheel(0, 600);
      let scrolled = 0;
      for (let i = 0; i < 40 && scrolled <= 0; i++) {
        scrolled = Number(await page("window.scrollY"));
        if (scrolled <= 0) await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(scrolled > 0, `the wheel over the picture scrolled the page (scrollY ${scrolled})`);
      // leaving the view: Tab goes out of it (and is not sent), then Shift+Tab reaches Give back, and Enter on it hands control back without the page ever receiving that Enter
      await k.me.page.evaluate(() => {
        (window as unknown as { __sent: string[] }).__sent.length = 0;
      });
      await k.me.page.keyboard.press("Tab");
      const onView = await k.me.page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") === "browser-live-view",
      );
      assert.equal(onView, false, "Tab leaves the live view");
      for (let i = 0; i < 14; i++) {
        if (await k.me.page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "browser-give"))
          break;
        await k.me.page.keyboard.press("Shift+Tab");
      }
      assert.equal(
        await k.me.page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
        "browser-give",
        "Give back has the focus",
      );
      await k.me.page.keyboard.press("Enter");
      await k.me.page.getByTestId("browser-take").waitFor({ timeout: 20_000 });
      const keysSent = await k.me.page.evaluate(() =>
        (window as unknown as { __sent: string[] }).__sent
          .map((m) => JSON.parse(m) as { t: string; name?: string })
          .filter((m) => m.t === "type" || (m.t === "key" && m.name !== "Shift")),
      ); // Shift itself, pressed to go backwards while the view still has the focus, is a modifier on its own: harmless to the page
      assert.deepEqual(
        keysSent,
        [],
        `no Enter, text or other key reached the page while leaving: ${JSON.stringify(keysSent)}`,
      );
      assert.ok(drawn.resizes <= 1, `the canvas was sized ${drawn.resizes} times: each one clears it`);
    } finally {
      await k.close();
    }
  },
);
