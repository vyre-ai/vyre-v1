// Getting in, in a browser at the Space's own address (rc.41), against a real Space server behind the production export. What a person does, in order:
//   1 claim, Sign Out, Back: Your Spaces shows the Space with a press to its sign-in, and the username is already there
//   2 the Space's server goes down behind its address: Reconnecting, then its name with Try again and Clear old data; Clear old data removes the worker and cached pages and keeps what the
//     browser remembers; the server comes back and Try again opens the sign-in
// Needs a Chromium (CHROME_BIN) and a web export (VYRE_APP_DIST); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { browserOrSkip } from "./support/mail-browser.ts";
import { claimOwner, shoot, signOut } from "./getting-in-kit.test.ts";

test("a browser at the Space's address: Your Spaces after Sign Out, and a server that is down says so with its fixes", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return;
  }
  const space = await bootFreshSpace(undefined, true);
  let up = true;
  // the Space's address stays where it is; the server behind it can be down (the edge answers 502, as a proxy does)
  const web = await edge(env.dist, () => (up ? space.url : "http://127.0.0.1:9"));
  const browser = await env.chromium.launch({ executablePath: env.exe, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // what Clear old data removes is counted as it goes: the page loads again straight after, and a fresh load registers the app's worker anew
    await page.addInitScript(() => {
      const count = (k: string): void => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) ?? 0) + 1));
      const unregister = ServiceWorkerRegistration.prototype.unregister;
      ServiceWorkerRegistration.prototype.unregister = function (this: ServiceWorkerRegistration) {
        count("walk:workers-removed");
        return unregister.call(this);
      };
      const drop = CacheStorage.prototype.delete;
      CacheStorage.prototype.delete = function (this: CacheStorage, name: string) {
        count("walk:caches-removed");
        return drop.call(this, name);
      };
    });

    await t.test("1 after Sign Out the Space is one press away, with the username already there", async () => {
      await claimOwner(page, claimOnEdge(space.claim!, web.origin), "Imran Ibarra", "imran");
      await dismissOnboarding(page);
      await signOut(page);
      await page.getByTestId("back").click();
      await page.getByTestId("your-spaces").waitFor({ timeout: 15_000 });
      assert.match(await page.getByTestId("your-space-0").innerText(), /Fresh Co\s+Sign in/);
      await shoot(page, "20-web-your-spaces");
      await page.getByTestId("your-space-0").click();
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("si-user").inputValue(), "imran");
    });

    await t.test(
      "2 the server is down: Reconnecting, then the Space's name with Try again and Clear old data",
      async () => {
        // the app's own worker is registered once the page is usable: that, and what it cached, is the old data a browser can hold
        await page.waitForFunction(
          async () => (await navigator.serviceWorker.getRegistrations()).some((r) => !!r.active),
          null,
          { timeout: 30_000 },
        );
        const remembered = await page.evaluate(() => localStorage.getItem("vyre.spaces.v1"));
        up = false;
        await page.reload();
        await page.getByTestId("join-status").waitFor({ timeout: 15_000 });
        assert.equal(await page.getByTestId("join-status").innerText(), "Reconnecting");
        await shoot(page, "21-web-sign-in-reconnecting");
        await page.getByTestId("step-not-answering").waitFor({ timeout: 20_000 });
        assert.match(await page.getByTestId("step-not-answering").innerText(), /Fresh Co is not answering/);
        assert.equal(await page.getByText(/cannot reach this Space/).count(), 0, "never the old dead-end line");
        await page.getByTestId("not-answering-clear").waitFor({ timeout: 10_000 });
        assert.equal(await page.getByTestId("not-answering-browser").count(), 0, "a browser is not offered a browser");
        await shoot(page, "22-web-not-answering");
        await page.getByTestId("not-answering-clear").click();
        // the worker and the cached pages go and the page loads again; the server is still down, so the same screen comes back
        await page.waitForFunction(() => Number(sessionStorage.getItem("walk:workers-removed") ?? 0) >= 1, null, {
          timeout: 20_000,
        });
        await page.getByTestId("step-not-answering").waitFor({ timeout: 30_000 });
        assert.ok(
          Number(await page.evaluate(() => sessionStorage.getItem("walk:caches-removed") ?? "0")) >= 1,
          "the cached pages went too",
        );
        assert.equal(
          await page.evaluate(() => localStorage.getItem("vyre.spaces.v1")),
          remembered,
          "what the browser remembers about its Spaces is not old data",
        );
        up = true;
        await page.getByTestId("not-answering-retry").click();
        await page.getByTestId("si-user").waitFor({ timeout: 20_000 });
        assert.equal(await page.getByTestId("si-user").inputValue(), "imran");
      },
    );
    assert.deepEqual(errors, [], "no page error on the way");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
