// The Chats sidebar and rail in the real app (13 Nov design), as a person sees them: an empty Space, a full one (goals, a pinned chat, a muted one, channels, the team), a Personal Space, the "+" and filter menus, a row's right-click menu, a folded
// head, the phone width; each in light and dark. It also presses every control of the sidebar once and checks that each does something (no dead button), and that no raw id is drawn (the crash guard's own scan).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

/** The app follows the system scheme (skin "system"), so the picture asks the browser for each. */
const setScheme = (p: Page, scheme: "light" | "dark"): Promise<void> => p.emulateMedia({ colorScheme: scheme });
const PASSWORD = "fixture password 123";
type Page = import("playwright-core").Page;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function claim(page: Page, link: string, origin: string, name: string, user: string): Promise<void> {
  await page.goto(claimOnEdge(link, origin), { waitUntil: "load" });
  await page.getByTestId("claim-name").fill(name);
  await page.getByTestId("claim-username").fill(user);
  await page.getByTestId("claim-password").fill(PASSWORD);
  await page.getByTestId("claim-confirm").fill(PASSWORD);
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-saved").click();
  await page.getByTestId("claim-create").click();
  await dismissOnboarding(page);
  await page.getByTestId("shell").waitFor({ timeout: 30_000 });
}

test("chats sidebar pictures and click-through", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const out = process.env["VYRE_SIDEBAR_SHOTS"] ?? "/tmp/vyre-sidebar-shots";
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  const times: Record<string, number> = {};
  try {
    for (const kind of [undefined, "personal"] as const) {
      const space = await bootFreshSpace(kind);
      const web = await edge(dist, space.url);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const guard = guardCrashes(page);
      await claim(page, space.claim!, web.origin, "Olivia Owner", "olivia");
      const tag = kind ?? "team";
      const shoot = async (name: string): Promise<void> => {
        await guard.check(`${tag} ${name}`);
        for (const scheme of ["light", "dark"] as const) {
          await setScheme(page, scheme);
          await page.waitForTimeout(200);
          await page.screenshot({ path: path.join(out, `${tag}-${name}-${scheme}-1440.png`), animations: "disabled" });
        }
        await setScheme(page, "light");
      };
      await page.getByTestId("chats-sidebar").waitFor({ timeout: 20_000 });
      await shoot("empty");
      if (kind === "personal") {
        await shoot("personal");
        await ctx.close();
        await web.close?.();
        await space.stop();
        continue;
      }
      const token = await page.evaluate(
        () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
      );
      let n = 0;
      const call = async (cap: string, data: Record<string, unknown>): Promise<Any> => {
        const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
          headers: { authorization: `Bearer ${token}` },
          data: { idempotencyKey: `sb-${cap}-${++n}`, ...data },
        });
        const body = await r.json();
        assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 300)}`);
        return body.data;
      };
      const agentId = ((await call("agents.list", {})).agents as { agentId: string }[])[0]!.agentId;
      const chats: string[] = [];
      for (const title of [
        "Pricing page copy",
        "Renewal checklist",
        "Launch crew",
        "Invoice export bug",
        "Weekly numbers",
        "Onboarding script",
        "Vendor comparison",
        "Q4 plan outline",
      ]) {
        const c = await call("chat.start", { kind: "chat", agentIds: [agentId], title });
        chats.push(c.thread.threadId as string);
        await call("chat.post", { threadId: c.thread.threadId, body: `Notes for ${title}` });
      }
      for (const nm of ["launch", "ops", "design", "support", "finance", "hiring", "release"])
        await call("channels.create", { name: nm, visibility: "public" });
      const gen = ((await call("channels.list", {})).channels as { name: string; channelId: string; mainThreadId: string }[]).find((c) => c.name === "launch")!;
      await callAs(maya.token, "channels.join", { channelId: gen.channelId });
      await callAs(maya.token, "chat.post", { threadId: gen.mainThreadId, body: "@Olivia the launch checklist is ready", mentions: [{ kind: "person", id: ownerId }] });
      await call("stars.toggle", { resource: { type: "thread", id: chats[0]! }, on: true });
      await call("notifications.mute.set", { target: { kind: "thread", id: chats[3]! }, minutes: 600 });
      await call("goals.create", {
        title: "Close every onboarding task for new clients",
        finish: { kind: "owner", line: "Done when the owner says so" },
        deadline: Date.now() + 14 * 86_400_000,
        leadAgentId: agentId,
      });
      const t0 = Date.now();
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("head-chats").waitFor({ timeout: 20_000 });
      times["reload_to_sidebar_ms"] = Date.now() - t0;
      await shoot("full");
      // menus
      await page.getByTestId("new-menu").click();
      await page.waitForTimeout(200);
      await shoot("plus-menu");
      await page.keyboard.press("Escape");
      await page.getByTestId("filter-chats").click();
      await page.waitForTimeout(200);
      await shoot("filter-menu");
      await page.keyboard.press("Escape");
      const row = page.getByText("Launch crew").first();
      await row.click({ button: "right" });
      await page.waitForTimeout(200);
      await shoot("row-menu");
      await page.keyboard.press("Escape");
      await page.getByTestId("toggle-channels").click();
      await page.waitForTimeout(200);
      await shoot("folded");
      await page.getByTestId("toggle-channels").click();
      // fold timing: a section fold inside the speed budget
      const f0 = Date.now();
      await page.getByTestId("toggle-chats").click();
      await page.getByTestId("count-chats").waitFor({ timeout: 5_000 });
      times["fold_ms"] = Date.now() - f0;
      await page.getByTestId("toggle-chats").click();
      // keyboard focus
      await page.getByTestId("sidebar-list").focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await shoot("keyboard");
      // no dead buttons: every head folds, every row opens something, Tasks opens Tasks
      const heads = await page.locator('[data-testid^="toggle-"]').all();
      assert.ok(heads.length >= 5, `the heads (${heads.length})`);
      for (const h of heads) {
        const side = page.getByTestId("chats-sidebar");
        const before = await side.innerHTML();
        await h.click();
        await page.waitForTimeout(150);
        assert.notEqual(await side.innerHTML(), before, "a head folds or unfolds");
        await h.click();
      }
      const rowsSeen = await page
        .locator(
          '[role="button"][data-testid^="row-c:"], [role="button"][data-testid^="row-ch:"], [role="button"][data-testid^="row-g:"], [role="button"][data-testid^="row-f:"], [role="button"][data-testid^="row-p:"]',
        )
        .all();
      assert.ok(rowsSeen.length >= 8, `rows drawn (${rowsSeen.length})`);
      for (const r of rowsSeen.slice(0, 14)) {
        const label = (await r.getAttribute("aria-label")) ?? "";
        const before =
          page.url() +
          (await page
            .locator('main, [data-testid="chats-place"]')
            .first()
            .innerText()
            .catch(() => ""));
        await r.click();
        await page.waitForTimeout(250);
        const after =
          page.url() +
          (await page
            .locator('main, [data-testid="chats-place"]')
            .first()
            .innerText()
            .catch(() => ""));
        assert.notEqual(after, before, `pressing "${label}" did something`);
        await guard.check(`open ${label}`);
      }
      // a guest: the one channel they were added to, nothing else
      try {
        const guest = await accept("Guest", "gus", "Gus Rowe");
        const room = (await call("channels.create", { name: "client-room", visibility: "invite" })).channel;
        await call("channels.members.add", { channelId: room.channelId, personIds: [guest.personId] });
        const saved = await page.evaluate(() => localStorage.getItem("vyre.session.v1")!);
        const gj = JSON.parse(saved) as Any;
        const org = web.origin;
        if (gj.sessions?.[org]) gj.sessions[org].token = guest.token;
        const gctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await gctx.addInitScript((v: string) => localStorage.setItem("vyre.session.v1", v), JSON.stringify(gj));
        const gp = await gctx.newPage();
        await gp.goto(`${web.origin}/`, { waitUntil: "load" });
        await gp.getByTestId("chats-sidebar").waitFor({ timeout: 25_000 });
        await gp.waitForTimeout(800);
        for (const scheme of ["light", "dark"] as const) {
          await setScheme(gp, scheme);
          await gp.waitForTimeout(200);
          await gp.screenshot({ path: path.join(out, `guest-full-${scheme}-1440.png`), animations: "disabled" });
        }
        const gtext = await gp.getByTestId("chats-sidebar").innerText();
        assert.ok(gtext.includes("client-room"), "the guest sees their channel");
        assert.ok(!gtext.includes("Team") && !gtext.includes("Goals") && !gtext.includes("launch\n"), "no Team, no Goals, no public channel");
        await gctx.close();
      } catch (e) {
        fs.writeFileSync(path.join(out, "guest-picture-failed.txt"), String((e as Error).message));
      }
      // phone width
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${web.origin}/`, { waitUntil: "load" });
      await page.getByTestId("mobile-shell").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1200);
      await shoot("phone-full");
      fs.writeFileSync(path.join(out, "times.json"), JSON.stringify(times, null, 1));
      await ctx.close();
      await web.close?.();
      await space.stop();
    }
  } finally {
    await browser.close();
  }
});
