// Shared by kinds-b.panes.live.test.ts and kinds-b.refused.live.test.ts (13 Nov 2026): the Space, the owner who claimed it and the API door, and Maya joined as a member. One walk per file keeps each under the 120 s cap.
import assert from "node:assert/strict";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { claimOnEdge, dismissOnboarding } from "./real-app-harness.test.ts";

export const PASSWORD = "fixture password 123";
export type Call = (cap: string, data: unknown) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function claimOwner(
  browser: Browser,
  origin: string,
  claim: string,
): Promise<{ owner: BrowserContext; page: Page; call: Call }> {
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await owner.newPage();
  await page.goto(claimOnEdge(claim, origin), { waitUntil: "load" });
  await page.getByTestId("claim-name").fill("Olivia Owner");
  await page.getByTestId("claim-username").fill("olivia");
  await page.getByTestId("claim-password").fill(PASSWORD);
  await page.getByTestId("claim-confirm").fill(PASSWORD);
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-saved").click();
  await page.getByTestId("claim-create").click();
  await dismissOnboarding(page);
  await page.getByTestId("shell").waitFor({ timeout: 30_000 });
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
  );
  const call: Call = async (cap, data) => {
    const r = await owner.request.post(`${origin}/v1/${cap.replaceAll(".", "/")}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    });
    const body = await r.json();
    assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 400)}`);
    return body.data;
  };
  return { owner, page, call };
}

/** Maya joins through the real join screens as a member. */
export async function joinMaya(browser: Browser, origin: string, call: Call): Promise<{ maya: Page; mayaId: string }> {
  const roles = (await call("access.roles.list", {})).roles as { id: string; name: string }[];
  const inv = await call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    idempotencyKey: "kb-inv-maya",
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const maya = await ctx.newPage();
  const link = new URL(inv.link);
  await maya.goto(origin + link.pathname + link.hash);
  await maya.getByTestId("step-accept").waitFor({ timeout: 20_000 });
  await maya.getByTestId("web").click();
  await maya.getByTestId("first").fill("Maya");
  await maya.getByTestId("last").fill("Lin");
  await maya.getByTestId("next").click();
  await maya.getByTestId("username").fill("maya");
  await maya.getByTestId("password").fill(PASSWORD);
  await maya.getByTestId("confirm").fill(PASSWORD);
  await maya.getByTestId("next").click();
  await maya.getByTestId("device").fill("Maya's browser");
  await maya.getByTestId("next").click();
  await maya.getByTestId("ai-none").click();
  await maya.getByTestId("next").click();
  await dismissOnboarding(maya);
  const mayaId = await maya.evaluate(
    () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].personId as string,
  );
  return { maya, mayaId };
}

/** A guest of one channel joins through the join screens from the link threads.invite_guest made. */
export async function joinGuest(browser: Browser, origin: string, link: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guest = await ctx.newPage();
  const u = new URL(link);
  await guest.goto(origin + u.pathname + u.hash);
  await guest.getByTestId("step-accept").waitFor({ timeout: 20_000 });
  await guest.getByTestId("web").click();
  await guest.getByTestId("first").fill("Gus");
  await guest.getByTestId("last").fill("Guest");
  await guest.getByTestId("next").click();
  await guest.getByTestId("username").fill("gus");
  await guest.getByTestId("password").fill(PASSWORD);
  await guest.getByTestId("confirm").fill(PASSWORD);
  await guest.getByTestId("next").click();
  await guest.getByTestId("device").fill("Gus's browser");
  await guest.getByTestId("next").click();
  await guest.getByTestId("ai-none").click();
  await guest.getByTestId("next").click();
  await dismissOnboarding(guest);
  return guest;
}
