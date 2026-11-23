// Getting in, two tabs of one browser on one Space (rc.41), against a real Space server behind the production export:
//   1 a second tab opens straight into the Space (one saved sign-in, shared by both tabs)
//   2 signing out in the first tab: the second tab, loaded again, is at that Space's sign-in with the username already there, and Your Spaces still lists the Space
//   3 signing in again in the second tab: the first tab, loaded again, is straight in; neither tab raises a page error
// Needs a Chromium (CHROME_BIN) and a web export (VYRE_APP_DIST); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { browserOrSkip } from "./support/mail-browser.ts";
import { PASSWORD, claimOwner, shoot, signOut } from "./getting-in-kit.test.ts";

test("two tabs on one Space: signing out in one leaves the other at the sign-in with the username there, and signing in again opens both", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return;
  }
  const space = await bootFreshSpace();
  const web = await edge(env.dist, space.url);
  const browser = await env.chromium.launch({ executablePath: env.exe, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    const one = await ctx.newPage();
    one.on("pageerror", (e) => errors.push(e.message));
    await claimOwner(one, claimOnEdge(space.claim!, web.origin), "Imran Ibarra", "imran");
    await dismissOnboarding(one);
    const two = await ctx.newPage();
    two.on("pageerror", (e) => errors.push(e.message));

    await t.test("1 a second tab is straight in", async () => {
      await two.goto(`${web.origin}/`);
      await two.getByTestId("shell").waitFor({ timeout: 30_000 });
    });
    await t.test("2 signed out in the first tab: the second is at the sign-in, the Space stays listed", async () => {
      await signOut(one);
      await two.reload();
      await two.getByTestId("si-user").waitFor({ timeout: 30_000 });
      assert.equal(await two.getByTestId("si-user").inputValue(), "imran");
      assert.equal(await two.getByTestId("shell").count(), 0, "the second tab is not left signed in");
      await shoot(two, "30-two-tabs-signed-out");
      await two.getByTestId("back").click();
      await two.getByTestId("your-spaces").waitFor({ timeout: 15_000 });
      assert.match(await two.getByTestId("your-space-0").innerText(), /Fresh Co\s+Sign in/);
    });
    await t.test("3 signed in again in the second tab: the first is straight in", async () => {
      await two.getByTestId("your-space-0").click();
      await two.getByTestId("si-user").waitFor({ timeout: 15_000 });
      await two.getByTestId("si-password").fill(PASSWORD);
      await two.getByTestId("next").click();
      await two.getByTestId("shell").waitFor({ timeout: 30_000 });
      await one.goto(`${web.origin}/`);
      await one.getByTestId("shell").waitFor({ timeout: 30_000 });
    });
    assert.deepEqual(errors, [], "no page error in either tab");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
