// Getting in, the desktop app and a browser on the same Space at once (rc.41), against a real Space server and the production export served as the packaged app:
//   1 the browser claims the Space and the app signs in to it by its address: two sign-ins, one in each
//   2 signing out in the browser leaves the app in the Space (its sign-in is its own), and the browser at its sign-in with the username there
//   3 signing out in the app: Your Spaces lists the Space with a press to its sign-in; the browser, signed in again, is not touched
// Needs a Chromium (CHROME_BIN) and a web export (VYRE_APP_DIST); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { browserOrSkip } from "./support/mail-browser.ts";
import { APP, DESKTOP_SHELL, PASSWORD, claimOwner, servePackaged, shoot, signOut } from "./getting-in-kit.test.ts";

test("the desktop app and a browser on one Space: each keeps its own sign-in, and signing out in one leaves the other in", async (t) => {
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
    await ctx.grantPermissions(["local-network-access"], { origin: APP });
    const errors: string[] = [];
    const web1 = await ctx.newPage();
    web1.on("pageerror", (e) => errors.push(e.message));
    await claimOwner(web1, claimOnEdge(space.claim!, web.origin), "Imran Ibarra", "imran");
    await dismissOnboarding(web1);
    const app = await ctx.newPage();
    app.on("pageerror", (e) => errors.push(e.message));
    await servePackaged(app, env.dist);
    await app.addInitScript(DESKTOP_SHELL);

    await t.test("1 the app signs in by the Space's address while the browser is in", async () => {
      await app.goto(`${APP}/`);
      await app.getByTestId("door-me").waitFor({ timeout: 30_000 });
      await app.getByTestId("door-existing").click();
      await app.getByTestId("peer-address").click();
      await app.getByTestId("space-address").fill(space.url);
      await app.getByTestId("resolve-space").click();
      await app.getByTestId("si-user").waitFor({ timeout: 15_000 });
      await app.getByTestId("si-user").fill("imran");
      await app.getByTestId("si-password").fill(PASSWORD);
      await app.getByTestId("next").click();
      await app.getByTestId("shell").waitFor({ timeout: 30_000 });
      await shoot(app, "31-app-and-browser-both-in");
    });
    await t.test("2 signed out in the browser: the app stays in, the browser is at its sign-in", async () => {
      await signOut(web1);
      assert.equal(await web1.getByTestId("si-user").inputValue(), "imran");
      await app.reload();
      await app.getByTestId("shell").waitFor({ timeout: 30_000 });
    });
    await t.test("3 signed out in the app: Your Spaces lists the Space; the browser signs in again untouched", async () => {
      await signOut(app);
      await app.getByTestId("back").click();
      await app.getByTestId("your-spaces").waitFor({ timeout: 15_000 });
      assert.match(await app.getByTestId("your-space-0").innerText(), /Fresh Co\s+Sign in/);
      await web1.getByTestId("si-password").fill(PASSWORD);
      await web1.getByTestId("next").click();
      await web1.getByTestId("shell").waitFor({ timeout: 30_000 });
      await shoot(app, "32-app-signed-out-your-spaces");
    });
    assert.deepEqual(errors, [], "no page error in the app or the browser");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
