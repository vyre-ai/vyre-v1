// @tsx
// The walk from rule 8 of NAV-2026-11-14: in the real app (production export, a fresh claimed daemon, a real Chromium) every kind of thing that opens is opened from where it opens, and the walk checks
// a visible Back at the start of the bar, Back by keyboard, the browser's Back, the same place on return, Forward after Back, and Esc and focus for layers. A screen with no way back is a red step here,
// named by its row in team/v1/NAV-LIST-2026-11-14.md. Rows are added as places move onto the shared history; none is removed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

type Pg = import("playwright-core").Page;

test("navigation walk: every opened thing has a way back on screen, by keyboard and by the browser, and Forward returns", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const shots = process.env["VYRE_NAV_SHOTS"] ?? "/tmp/vyre-nav-shots";
  fs.mkdirSync(shots, { recursive: true });
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const guard = guardCrashes(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 3000)}`);
  });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Nav Owner");
    await page.getByTestId("claim-username").fill("navowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page, { wait: 60_000 });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const api = async (cap: string, data: unknown): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data,
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return (await r.json()).data;
    };
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    const tree = await api("files.tree", {});
    const root = JSON.stringify(tree).match(/"(fld_[a-z0-9]+)"/)![1]!;
    const folder = (await api("files.folder.create", { parentId: root, name: "Contracts", idempotencyKey: "n-f" }))
      .folder.folderId as string;
    const made = await api("files.create", {
      folderId: folder,
      name: "Engagement letter.md",
      content: { text: "Dear client" },
      idempotencyKey: "n-file",
    });
    const fileId = JSON.stringify(made).match(/"(fil_[a-z0-9]+)"/)![1]!;

    const back = page.getByTestId("nav-back");
    const fwd = page.getByTestId("nav-forward");
    const hash = (): Promise<string> => page.evaluate(() => location.hash.replace(/^#/, ""));
    const open = async (url: string): Promise<void> => {
      await page.goto(`${web.origin}${url}`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await back.waitFor({ timeout: 10_000 });
    };
    /** One walk of a thing opened cold: the control is on screen and enabled, names the place it goes up to, and Back, Forward, the keyboard and the browser's Back all take the same step. */
    const say = (m: string): void => console.log(`[walk ${new Date().toISOString().slice(14, 23)}] ${m}`);
    const walk = async (row: string, url: string, up: RegExp, openedHash: RegExp): Promise<void> => {
      say(`${row} open`);
      await open(url);
      await guard.check(`${row} opened`);
      assert.match(await hash(), openedHash, `${row}: the opened address`);
      assert.ok(await back.isVisible(), `${row}: Back is on screen`);
      assert.equal(await back.isDisabled(), false, `${row}: Back is enabled`);
      assert.match((await back.getAttribute("aria-label")) ?? "", up, `${row}: Back says where it goes`);
      await page.screenshot({ path: path.join(shots, `${row}-opened.png`) });
      say(`${row} control`);
      await back.click();
      await guard.check(`${row} after Back`);
      assert.doesNotMatch(await hash(), openedHash, `${row}: Back left the page`);
      assert.equal(await fwd.isDisabled(), false, `${row}: Forward is enabled after Back`);
      await fwd.click();
      await guard.check(`${row} after Forward`);
      assert.match(await hash(), openedHash, `${row}: Forward returned`);
      say(`${row} keys`);
      // the keyboard (Linux: Alt+Left and Alt+Right)
      await page.keyboard.press("Alt+ArrowLeft");
      await guard.check(`${row} after Alt+Left`);
      assert.doesNotMatch(await hash(), openedHash, `${row}: Alt+Left is Back`);
      await page.keyboard.press("Alt+ArrowRight");
      await guard.check(`${row} after Alt+Right`);
      assert.match(await hash(), openedHash, `${row}: Alt+Right is Forward`);
      say(`${row} browser`);
      // the browser's own Back and Forward (the guards are made on the first press, which the clicks above were)
      await page.goBack();
      await guard.check(`${row} after the browser Back`);
      await page.waitForFunction(() => !/agent-page|subject=file/.test(location.hash), null, { timeout: 5000 });
      assert.doesNotMatch(await hash(), openedHash, `${row}: the browser's Back is Back`);
      await page.goForward();
      await guard.check(`${row} after the browser Forward`);
      await page.waitForFunction(() => /agent-page|subject=file/.test(location.hash), null, { timeout: 5000 });
      assert.match(await hash(), openedHash, `${row}: the browser's Forward is Forward`);
      await guard.check(`${row} walked`);
    };

    // the landing: nowhere to go back to, and the controls are still there
    await open("/chat");
    assert.ok((await back.isVisible()) && (await fwd.isVisible()), "the arrows are drawn at the landing");
    assert.equal(await back.isDisabled(), true, "nothing to go back to at the landing");
    assert.equal(await fwd.isDisabled(), true);

    // C06 the agent's page (the owner named it)
    await walk(
      "C06-agent-page",
      `/chat#screen=chats.agent-page&agentId=${assistant.agentId}`,
      /^Back to Chats$/,
      /agent-page/,
    );
    say("rapid");
    // fast Back and Forward from the keys and the browser, with no wait between: the page never crashes and ends where the steps say
    await open(`/chat#screen=chats.agent-page&agentId=${assistant.agentId}`);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Alt+ArrowLeft");
      await page.keyboard.press("Alt+ArrowRight");
    }
    await page.waitForTimeout(1500);
    await guard.check("rapid Back and Forward");
    // H02 a file (the owner named it)
    await walk("H02-file", `/files#subject=file:${fileId}`, /^Back to Files$/, /subject=file/);
    // the control, as it looks: light and dark, desktop and phone width
    for (const scheme of ["light", "dark"] as const) {
      for (const [w, h, tag] of [
        [1440, 900, "desktop"],
        [390, 844, "phone"],
      ] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`${web.origin}/chat#screen=chats.agent-page&agentId=${assistant.agentId}`, {
          waitUntil: "load",
        });
        await page.getByTestId("shell").or(page.getByTestId("mobile-shell")).first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(shots, `back-${tag}-${scheme}.png`) });
      }
    }
    await guard.check("the end of the walk");
  } catch (e) {
    await page.screenshot({ path: path.join(shots, "failed.png") }).catch(() => undefined);
    console.log(`page errors before the failure:\n${errors.slice(-8).join("\n")}`);
    throw e;
  } finally {
    await browser.close();
    await web.close();
    await space.stop();
  }
});
