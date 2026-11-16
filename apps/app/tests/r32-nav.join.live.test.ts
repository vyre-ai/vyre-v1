// @tsx
// Lane r32-nav, items 4 and 5 (phone, 390 wide, light). A member has no Console door in Settings; after a second person joins by an invite link, Back goes to the Space's first screen, never to the join page or out of the app.
import test from "node:test";
import assert from "node:assert/strict";
import { dismissOnboarding } from "./real-app-harness.test.ts";
import { bootNav } from "./r32-nav-kit.test.ts";
import type { Pg } from "./r32-nav-kit.test.ts";

const screens = (page: Pg): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="screen-"]')].map((e) => e.getAttribute("data-testid")).join(","),
  );

test("phone: a member has no Console door in Settings, and Back after joining by a link goes to the first screen", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-light-390" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, say, shot, api } = k;
  try {
    const roles = (await api("access.roles.list", {})) as { roles: { id: string; name: string }[] };
    const role = roles.roles.find((r) => r.name === "Member")!;
    const made = (await api("members.invites.create", { role: role.id })) as { link: string };
    const link = new URL(made.link);
    const p2 = await k.second();
    const trail: string[] = [];
    p2.on("framenavigated", (f) => {
      if (f === p2.mainFrame()) trail.push(new URL(f.url()).pathname);
    });
    await p2.goto(k.origin + link.pathname + link.hash);
    await p2.getByTestId("step-accept").waitFor({ timeout: 20_000 });
    await p2.getByTestId("web").click();
    await p2.getByTestId("first").fill("New");
    await p2.getByTestId("last").fill("Member");
    await p2.getByTestId("next").click();
    await p2.getByTestId("username").fill("newmember");
    await p2.getByTestId("password").fill("fixture member password123");
    await p2.getByTestId("confirm").fill("fixture member password123");
    await p2.getByTestId("next").click();
    await p2.getByTestId("next").click();
    await p2.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await dismissOnboarding(p2);
    await p2.waitForTimeout(1500);
    say(`after join: ${p2.url()} screens ${await screens(p2)} trail ${trail.join(" > ")}`);
    await p2.screenshot({
      path: `${process.env["VYRE_NAV_SHOTS"] ?? "/tmp/vyre-nav-shots"}/phone-light-390/join-landed.png`,
    });
    const first = await screens(p2);
    say(`history length after join: ${await p2.evaluate(() => history.length)}`);
    // the person moves about, then presses Back until it stops moving: never the join page, never out of the app
    await p2.getByTestId("tab-you").click();
    await p2.waitForTimeout(500);
    await p2.getByText("Settings", { exact: true }).first().click();
    await p2.waitForTimeout(800);
    const route: string[] = [];
    for (let i = 0; i < 6; i++) {
      route.push(`${new URL(p2.url()).pathname}${new URL(p2.url()).hash} [${await screens(p2)}]`);
      await p2.goBack().catch(() => undefined);
      await p2.waitForTimeout(900);
    }
    route.push(`${p2.url()} [${await screens(p2)}]`);
    say(`Back route: ${route.join("  <-  ")}`);
    assert.ok(!route.some((r) => /\/join/.test(r)), "Back never returns to the join page");
    assert.ok(!route.some((r) => r.startsWith("about:blank")), "Back never leaves the app");
    assert.ok(route.at(-1)!.includes(first.split(",")[0]!), "Back ends on the Space's first screen");
    // the member's Settings has no Console door
    await p2.getByTestId("tab-you").click();
    await p2.getByText("Settings", { exact: true }).first().click();
    await p2.getByTestId("settings-search").waitFor({ timeout: 15_000 });
    assert.equal(await p2.getByTestId("row-open-console").count(), 0, "a member has no Console door");
    await p2.screenshot({
      path: `${process.env["VYRE_NAV_SHOTS"] ?? "/tmp/vyre-nav-shots"}/phone-light-390/settings-member.png`,
    });
    void shot;
    void page;
  } finally {
    await k.close();
  }
});
