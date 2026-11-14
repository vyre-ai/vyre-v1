// Nothing in the Chats sidebar is unreachable (b-side, 14 Nov): in a Team Space and in a Personal Space a person finds an archived chat under the filter menu's Archived and opens it; and in a Team Space the 51st
// chat, past the first page, is reached by pressing "more" and opens. Real app on the export, real daemon, as a person presses.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

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

test("an archived chat, and a chat past the first page, can be found and opened from the sidebar", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  try {
    for (const kind of [undefined, "personal"] as const) {
      const tag = kind ?? "team";
      const space = await bootFreshSpace(kind);
      const web = await edge(dist, space.url);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const guard = guardCrashes(page);
      await claim(page, space.claim!, web.origin, "Olivia Owner", "olivia");
      await page.getByTestId("chats-sidebar").waitFor({ timeout: 20_000 });
      const token = await page.evaluate(
        () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
      );
      let n = 0;
      const call = async (cap: string, data: Record<string, unknown>): Promise<Any> => {
        const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
          headers: { authorization: `Bearer ${token}` },
          data: { idempotencyKey: `reach-${cap}-${++n}`, ...data },
        });
        const body = await r.json();
        assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 300)}`);
        return body.data;
      };
      const agentId = ((await call("agents.list", {})).agents as { agentId: string }[])[0]!.agentId;

      // 1. an archived chat: gone from Everything, found under Archived, and it opens
      const keep = await call("chat.start", { kind: "chat", agentIds: [agentId], title: "Kept chat" });
      await call("chat.post", { threadId: keep.thread.threadId, body: "stays" });
      const old = await call("chat.start", { kind: "chat", agentIds: [agentId], title: "Old Renewal" });
      await call("chat.post", { threadId: old.thread.threadId, body: "from last year" });
      await call("threads.archive", { threadId: old.thread.threadId });
      await page.goto(`${web.origin}/`, { waitUntil: "load" });
      const side = page.getByTestId("chats-sidebar");
      await side.waitFor({ timeout: 20_000 });
      await page.getByText("Kept chat").first().waitFor({ timeout: 20_000 });
      assert.ok(!(await side.innerText()).includes("Old Renewal"), `${tag}: an archived chat is not in Everything`);
      await page.getByTestId("filter-chats").click();
      await page.getByText("Archived", { exact: false }).last().click();
      await page.getByText("Old Renewal").first().waitFor({ timeout: 15_000 });
      assert.ok(!(await side.innerText()).includes("Kept chat"), `${tag}: Archived shows only the archived`);
      await page.getByTestId(`row-c:${old.thread.threadId}`).click();
      await page.getByTestId("conversation").waitFor({ timeout: 15_000 });
      assert.match((await page.getByTestId("conversation").getAttribute("aria-label")) ?? "", /Old Renewal/);
      await guard.check(`${tag} archived chat opens`);

      // 2. past the first page (a Team Space): the 51st chat is one press on "more" away
      if (kind === undefined) {
        const ids: string[] = [];
        for (let i = 0; i < 55; i++) {
          const c = await call("chat.start", {
            kind: "chat",
            agentIds: [agentId],
            title: `Bulk ${String(i).padStart(2, "0")}`,
          });
          await call("chat.post", { threadId: c.thread.threadId, body: `m${i}` });
          ids.push(c.thread.threadId as string);
        }
        await page.goto(`${web.origin}/`, { waitUntil: "load" });
        await page.getByTestId("chats-sidebar").waitFor({ timeout: 20_000 });
        await page.getByText("Bulk 54").first().waitFor({ timeout: 20_000 });
        const oldest = page.getByText("Bulk 00");
        assert.equal(await oldest.count(), 0, "the oldest of 55 is past the first page");
        await page.getByTestId("more-chats").click();
        for (let i = 0; i < 5 && (await oldest.count()) === 0; i++) {
          await page.waitForTimeout(500);
          const more = page.getByTestId("more-chats");
          if ((await more.count()) > 0 && (await oldest.count()) === 0) await more.click().catch(() => undefined);
        }
        // the list draws only the rows in view: scroll down until the oldest is drawn
        const list = page.getByTestId("sidebar-list");
        await list.hover();
        for (let i = 0; i < 12 && (await oldest.count()) === 0; i++) {
          await page.mouse.wheel(0, 1500);
          await page.waitForTimeout(300);
        }
        await oldest.first().waitFor({ timeout: 15_000 });
        await oldest.first().click();
        await page.getByTestId("conversation").waitFor({ timeout: 15_000 });
        assert.match((await page.getByTestId("conversation").getAttribute("aria-label")) ?? "", /Bulk 00/);
        await guard.check("team chat past the first page opens");
      }
      await ctx.close();
      await web.close?.();
      await space.stop();
    }
  } finally {
    await browser.close();
  }
});
