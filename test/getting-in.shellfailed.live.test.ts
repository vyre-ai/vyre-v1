// Getting in, a saved Space whose server answers "I am here" but fails every call after (a proxy or a deploy half way): the shell opens, cannot load, and the screen carries Try again, a way
// to Your Spaces, and the rail's Space tile (so another Space is one press away). When the server heals, Try again opens the Space.
// Needs a Chromium (CHROME_BIN) and a web export (VYRE_APP_DIST); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { browserOrSkip } from "./support/mail-browser.ts";
import { claimOwner, shoot } from "./getting-in-kit.test.ts";

test("a Space that answers its health check but fails its calls: Try again, Your Spaces and the Space tile on one screen", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return;
  }
  const space = await bootFreshSpace();
  let broken = false;
  const target = new URL(space.url);
  const flaky = http.createServer((req, res) => {
    if (broken && req.url !== "/healthz") {
      res.writeHead(502);
      res.end("half way through a deploy");
      return;
    }
    const up = http.request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", r));
  const web = await edge(env.dist, `http://127.0.0.1:${(flaky.address() as { port: number }).port}`);
  const browser = await env.chromium.launch({ executablePath: env.exe, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await claimOwner(page, claimOnEdge(space.claim!, web.origin), "Imran Ibarra", "imran");
    await dismissOnboarding(page);
    broken = true;
    await page.reload();
    await page.getByTestId("state-error").waitFor({ timeout: 40_000 });
    await page.getByTestId("state-second").waitFor({ timeout: 5_000 });
    assert.ok(await page.getByTestId("state-retry").count(), "Try again is there");
    assert.ok(await page.getByTestId("space-tile").count(), "the rail's Space tile is beside it");
    await shoot(page, "40-shell-failed-second");
    await page.getByTestId("state-second").click();
    await page.getByTestId("your-spaces").waitFor({ timeout: 15_000 });
    broken = false;
    await page.getByTestId("your-space-0").click();
    await page.getByTestId("shell").waitFor({ timeout: 40_000 });
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    flaky.close();
    await space.stop();
  }
});
