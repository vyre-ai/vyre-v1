// Getting in, in the desktop app (rc.41), against a real Space server and the production export served as the packaged app. What a person does, in order:
//   1 Sign in: one box takes a bare name and shows the address it means      2 a Space on Vyre's relay opens in the browser, by the app, and is kept in Your Spaces
//   3 a wrong name is said under the box                                      4 their own Space by its address: sign in, into the shell
//   5 Sign Out: the Space stays in Your Spaces; opening Vyre again shows it   6 one press: its sign-in with the username already there, and in
//   7 opening Vyre again goes straight into the Space used last
// Needs a Chromium (CHROME_BIN) and a web export (VYRE_APP_DIST); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { browserOrSkip } from "./support/mail-browser.ts";
import {
  APP,
  DESKTOP_SHELL,
  PASSWORD,
  claimOwner,
  handedToBrowser,
  servePackaged,
  shoot,
  signOut,
  vyreName,
} from "./getting-in-kit.test.ts";

test("the desktop app: one address box, a relay Space opened in the browser by the app, Your Spaces with one press to enter", async (t) => {
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
    // the owner's account, made the way a person makes it: the claim link, on the Space's own web address
    const owner = await ctx.newPage();
    await claimOwner(owner, claimOnEdge(space.claim!, web.origin), "Imran Ibarra", "imran");
    await dismissOnboarding(owner);
    await owner.close();

    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await servePackaged(page, env.dist);
    await page.addInitScript(DESKTOP_SHELL);
    await vyreName(page, "lakeside", "Lakeside", () => "held");
    await vyreName(page, "northwnd", "", () => "free");

    await t.test("1 Sign in: the one box takes a bare name and shows the address it means", async () => {
      await page.goto(`${APP}/`);
      await page.getByTestId("door-me").waitFor({ timeout: 30_000 });
      await page.getByTestId("door-existing").click();
      await page.getByTestId("peer-address").click();
      await page.getByTestId("space-address").fill("lakeside");
      await page.getByTestId("space-hint").waitFor();
      assert.equal(await page.getByTestId("space-hint").innerText(), "lakeside.vyre.run");
      await shoot(page, "01-box-name");
    });

    await t.test(
      "2 a Space on Vyre's relay: the app opens it in the browser itself and keeps it in Your Spaces",
      async () => {
        await page.getByTestId("resolve-space").click();
        await page.getByTestId("step-in-browser").waitFor({ timeout: 15_000 });
        assert.deepEqual(await handedToBrowser(page), ["https://lakeside.vyre.run/chat"]);
        assert.match(await page.getByTestId("step-in-browser").innerText(), /Lakeside is open in your browser/);
        assert.equal(await page.getByText(/Open the link in your browser/).count(), 0, "nobody is told to switch");
        await shoot(page, "02-relay-in-browser");
        await page.getByTestId("in-browser-again").click();
        assert.equal((await handedToBrowser(page)).length, 2, "Open again opens it there once more");
        await page.getByTestId("back").click();
        await page.getByTestId("your-spaces").waitFor();
        assert.match(await page.getByTestId("your-space-0").innerText(), /Lakeside\s+In your browser/);
        await shoot(page, "03-your-spaces-relay");
      },
    );

    await t.test("3 a name with no Space is said under the box", async () => {
      await page.getByTestId("add-space").click();
      await page.getByTestId("space-entry-address").fill("northwnd");
      await page.getByTestId("space-entry-continue").click();
      await page.getByTestId("space-entry-error").waitFor({ timeout: 15_000 });
      assert.equal(
        await page.getByTestId("space-entry-error").innerText(),
        "No Space at northwnd.vyre.run. Check the name.",
      );
      await shoot(page, "04-box-no-space");
    });

    await t.test("4 their own Space by its address: its sign-in, then the shell", async () => {
      await page.getByTestId("space-entry-address").fill(space.url);
      await page.getByTestId("space-entry-continue").click();
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      await page.getByTestId("si-user").fill("imran");
      await page.getByTestId("si-password").fill(PASSWORD);
      await page.getByTestId("next").click();
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    });

    await t.test("5 Sign Out keeps the Space in Your Spaces, and opening Vyre again shows the list", async () => {
      await signOut(page);
      await page.getByTestId("back").click();
      await page.getByTestId("your-spaces").waitFor();
      assert.match(await page.getByTestId("your-space-0").innerText(), /Fresh Co\s+Sign in/);
      assert.match(await page.getByTestId("your-space-1").innerText(), /Lakeside\s+In your browser/);
      await shoot(page, "05-your-spaces");
      await page.goto(`${APP}/`);
      await page.getByTestId("your-spaces").waitFor({ timeout: 30_000 });
      assert.equal(
        await page.getByTestId("door-me").count(),
        0,
        "the first-launch doors are for a device that has used no Space",
      );
    });

    await t.test("6 one press on the Space: its sign-in with the username already there, and in", async () => {
      await page.getByTestId("your-space-0").click();
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("si-user").inputValue(), "imran");
      await shoot(page, "06-sign-in-remembered");
      await page.getByTestId("si-password").fill(PASSWORD);
      await page.getByTestId("next").click();
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    });

    await t.test(
      "7 opening Vyre again goes straight into the Space used last, and its row says whose it is",
      async () => {
        await page.goto(`${APP}/`);
        await page.getByTestId("shell").waitFor({ timeout: 30_000 });
        assert.equal(await page.getByTestId("your-spaces").count(), 0);
        const rows = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("vyre.spaces.v1") ?? "{}").spaces as { name: string; person?: string }[],
        );
        assert.deepEqual(
          rows.map((r) => [r.name, r.person ?? ""]),
          [
            ["Fresh Co", "Imran Ibarra"],
            ["Lakeside", ""],
          ],
        );
        assert.equal(
          JSON.stringify(rows).includes("vds_") || /"token"/.test(JSON.stringify(rows)),
          false,
          "the list of Spaces holds no sign-in",
        );
      },
    );
    assert.deepEqual(errors, [], "no page error on the way");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
