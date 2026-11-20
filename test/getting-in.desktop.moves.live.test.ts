// Getting in when a Space is not where it was, in the desktop app (rc.41). Two Spaces this device has used before (their rows are what a past sign-in and a past open in the browser leave in
// the list: the walk puts those two rows there, and nothing else is set up by hand), a real Space server behind whichever name is a server of its own at the time, and the relay's answers
// for the rest. What a person sees, in order:
//   1 a Space that moved from its own address to Vyre's relay: one press, and the app opens it in the browser; its row now says so
//   2 a Space that moved from the relay to an address of its own: the same row signs in inside the app
//   3 a Space that does not answer: Reconnecting on its row, then its name with Try again and Open in browser
//   4 a relay Space whose computer is off: asleep, when it was last seen, checking by itself; awake again, Try again opens it
//   5 the address box: an address that does not answer says so under the box after the quiet retries
// Needs a Chromium (CHROME_BIN) and a web export (VYRE_APP_DIST); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace } from "../apps/app/tests/real-app-harness.test.ts";
import { browserOrSkip } from "./support/mail-browser.ts";
import {
  APP,
  DESKTOP_SHELL,
  handedToBrowser,
  ownAddress,
  servePackaged,
  shoot,
  vyreName,
} from "./getting-in-kit.test.ts";
import type { NameState } from "./getting-in-kit.test.ts";

test("the desktop app finds a Space where it is now: moved to the relay, moved to its own address, not answering, asleep", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return;
  }
  const space = await bootFreshSpace();
  const browser = await env.chromium.launch({ executablePath: env.exe, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await servePackaged(page, env.dist);
    await page.addInitScript(DESKTOP_SHELL);
    // what past use left on this device: Harbor was signed in to here (at an address of its own), Lakeside was opened in the browser (it was on the relay)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("walk:seeded")) return;
      sessionStorage.setItem("walk:seeded", "1");
      const now = Date.now();
      localStorage.setItem(
        "vyre.spaces.v1",
        JSON.stringify({
          spaces: [
            {
              address: "https://harbor.vyre.run",
              name: "Harbor",
              kind: "team",
              person: "Imran Ibarra",
              username: "imran",
              via: "app",
              usedAt: now - 1000,
            },
            { address: "https://lakeside.vyre.run", name: "Lakeside", via: "browser", usedAt: now - 2000 },
          ],
        }),
      );
    });
    let harbor: NameState = "held";
    let lakeside: NameState = { direct: space.url };
    await vyreName(page, "harbor", "Harbor", () => harbor);
    await vyreName(page, "lakeside", "Lakeside", () => lakeside);
    await ownAddress(page, "https://space.northwind.example", () => "down");
    const row = (name: string) => page.getByTestId("your-spaces").getByRole("button", { name: new RegExp(`^${name}`) });

    await t.test(
      "1 moved from its own address to the relay: one press, the app opens it in the browser, and its row says so",
      async () => {
        await page.goto(`${APP}/`);
        await page.getByTestId("your-spaces").waitFor({ timeout: 30_000 });
        assert.match(await row("Harbor").innerText(), /Harbor\s+Sign in/);
        await shoot(page, "10-your-spaces-before");
        await row("Harbor").click();
        await page.getByTestId("step-in-browser").waitFor({ timeout: 20_000 });
        assert.deepEqual(await handedToBrowser(page), ["https://harbor.vyre.run/chat"]);
        assert.match(await page.getByTestId("step-in-browser").innerText(), /Harbor is open in your browser/);
        await shoot(page, "11-moved-to-relay");
        await page.getByTestId("back").click();
        await page.getByTestId("your-spaces").waitFor();
        assert.match(await row("Harbor").innerText(), /Harbor\s+In your browser/);
      },
    );

    await t.test("2 moved from the relay to an address of its own: the same row signs in inside the app", async () => {
      assert.match(await row("Lakeside").innerText(), /Lakeside\s+In your browser/);
      await row("Lakeside").click();
      await page.getByTestId("si-user").waitFor({ timeout: 20_000 });
      // the person pressed a row, so the screen already knows the Space's name: never the generic title first. The Space's own name replaces it when its sign-in options arrive.
      assert.match(
        await page.getByTestId("step-sign-in").innerText(),
        /Sign in to (Lakeside|Fresh Co)/,
        "the known name shows on first paint",
      );
      await page
        .getByTestId("step-sign-in")
        .getByText(/Sign in to Fresh Co/)
        .waitFor({ timeout: 15_000 });
      assert.equal((await handedToBrowser(page)).length, 1, "nothing more went to the browser");
      await shoot(page, "12-moved-to-own-address");
      await page.getByTestId("back").click();
      await page.getByTestId("your-spaces").waitFor();
    });

    await t.test(
      "3 a Space that does not answer: Reconnecting on its row, then its name with the fixes as buttons",
      async () => {
        harbor = "down";
        await row("Harbor").click();
        await page.getByTestId("your-spaces").getByText("Reconnecting").waitFor({ timeout: 10_000 });
        await shoot(page, "13-row-reconnecting");
        await page.getByTestId("step-not-answering").waitFor({ timeout: 20_000 });
        assert.match(await page.getByTestId("step-not-answering").innerText(), /Harbor is not answering/);
        assert.equal(await page.getByTestId("not-answering-retry").count(), 1);
        assert.equal(await page.getByTestId("not-answering-browser").count(), 1);
        assert.equal(
          await page.getByTestId("not-answering-clear").count(),
          0,
          "the app window holds no old data to clear",
        );
        await shoot(page, "14-not-answering");
      },
    );

    await t.test(
      "4 a relay Space whose computer is off is asleep, with when it was last seen; awake again, Try again opens it",
      async () => {
        harbor = "asleep";
        await page.getByTestId("not-answering-retry").click();
        await page.getByText("Harbor is asleep").waitFor({ timeout: 20_000 });
        const said = await page.getByTestId("step-not-answering").innerText();
        assert.match(said, /Its computer is off or offline\. Seen 2 hours ago/);
        assert.match(said, /Checking/);
        await shoot(page, "15-relay-asleep");
        harbor = "held";
        const before = (await handedToBrowser(page)).length;
        await page.getByTestId("not-answering-retry").click();
        await page.getByTestId("step-in-browser").waitFor({ timeout: 20_000 });
        assert.equal((await handedToBrowser(page)).length, before + 1);
        await page.getByTestId("back").click();
        await page.getByTestId("your-spaces").waitFor();
      },
    );

    await t.test(
      "5 the address box: an address that does not answer says so under the box, after Reconnecting",
      async () => {
        await page.getByTestId("add-space").click();
        await page.getByTestId("space-entry-address").fill("space.northwind.example");
        await page.getByTestId("space-entry-continue").click();
        await page.getByTestId("space-entry-continue").getByText("Reconnecting").waitFor({ timeout: 10_000 });
        await page.getByTestId("space-entry-error").waitFor({ timeout: 20_000 });
        assert.equal(
          await page.getByTestId("space-entry-error").innerText(),
          "space.northwind.example is not answering. Check the name and your connection.",
        );
        await shoot(page, "16-box-not-answering");
      },
    );
    assert.deepEqual(errors, [], "no page error on the way");
  } finally {
    await browser.close();
    await space.stop();
  }
});
