// @tsx
// SPEED BUDGETS for opening the app (r38: https://mla.vyre.run took 2.9 s to parse its page, the sign-in form typable at 3.0 s; r39: the shared chunk split and the next files preloaded). A perf file (test/slow.json
// "perf": true): speed numbers count only on the v1-perf runners (ruling 46), each after a web export with Chromium (VYRE_APP_DIST). The export is served by the Space's own daemon (host/src/routes/app-files.ts:
// compressed, hashed files cached for good, the page carrying the lists of files it will load next: app-hints.ts), over a link of 24 Mbps and 20 ms (the link the firm's complaint was measured on).
//   cold sign-in   a fresh browser, nothing cached: the moment the form can be typed in (app.usable)
//   second visit   the same browser opens the address again: the entry is in the cache
//   signed-in home a fresh browser with a session opens the Chats place: its frame is usable; and again on a second visit
// Measured on box D, 5-run medians: r37 (everything in one 8.7 MB entry, sent as it was) cold 3,402 ms and 8.96 MB, home 4,070 ms; r38 (compressed, one shared chunk) cold 709 ms and 1.36 MB, home 1,013 ms;
// r39 (granular chunks, lazy pages, hints) cold about 255 ms and 0.22 MB, home about 860 ms; second visit about 100 ms.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { holdKeyOnOwnNode } from "../client/src/gateway/local-key.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boot, scriptedModel, stop } from "./support/eco-live.ts";

/** Budgets in ms (the median of five runs). The brief: the form typable in under 1 s on a fresh visit, a second visit under 400 ms. */
export const FIRST_LOAD_BUDGET_MS = { signInCold: 400, secondVisit: 400, homeCold: 1000, homeSecondVisit: 650 } as const;
const LINK = { latency: 20, downloadThroughput: (24 * 1_000_000) / 8, uploadThroughput: 625_000 };
const median = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

test("first load: the sign-in form is typable within 1 s cold and 400 ms on a second visit, and a signed-in home within 1.5 s", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    // on the perf host a missing export is a failure, never a skip: a budget that silently does not run is not a budget
    if (
      process.env["VYRE_REQUIRE_CHROME"] === "1" ||
      process.env["VYRE_PERF_RUN"] === "1" ||
      process.env["VYRE_PERF_FULL"] === "1"
    )
      assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const pw = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || pw.chromium.executablePath();
  assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-first-load-")));
  const d = await boot(
    fresh,
    scriptedModel(async function* () {
      /* no model turns in this walk */
    }),
    {
      appDir: path.resolve(dist),
      config: loadConfig(
        ["--data-dir", fresh, "--port", "0", "--space", "spc_fresh", "--space-name", "Load Co"],
        {},
        "1.2.3",
      ),
    },
  );
  const browser = await pw.chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    // an owner and a session, the way a person claims a Space
    const PASSWORD = "first load password 4417";
    const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
    const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
    const made = await makeBundle(PASSWORD, "first-load-recovery-code-1", { spaceId });
    const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        spaceId,
        displayName: "Maya Chen",
        username: "maya",
        password: PASSWORD,
        deviceName: "perf",
        deviceClass: "desktop",
        keys: {
          personKeyByPassword: made.personKeyByPassword,
          personKeyByRecovery: made.personKeyByRecovery,
          publicKey: made.publicKey,
          privateKeyWrapped: made.privateKeyWrapped,
          spaceKeys: made.spaceKeys ?? [],
        },
      }),
    });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const token = ((await claimed.json()) as { data: { session: { token: string } } }).data.session.token;
    assert.equal(await holdKeyOnOwnNode(d.url, token, made.personKey), true);
    const call = async (cap: string, input: unknown): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      return ((await r.json()) as { data?: unknown }).data;
    };
    for (const flow of ["team", "personal", "member"])
      await call("spaces.onboarding.seen", { flow }).catch(() => undefined);
    const me = (await call("identity.whoami", {})).principal.id as string;
    const marker = (await call("spaces.get", {})).space.fingerprint as string;
    const session = {
      baseUrl: d.url,
      token,
      personId: me,
      marker,
      def: {
        spaceId,
        name: "Load Co",
        kind: "team",
        address: d.url,
        role: "Owner",
        tint: ["#6E5CF0", "#9B6BE8"],
        kit: "northwind",
        skinDefault: "system",
        starred: true,
        needsYou: false,
        console: true,
        terminal: false,
        counts: {},
        dots: {},
      },
    };

    const open = async (
      url: string,
      withSession: boolean,
      visits: number,
    ): Promise<{ dcl: number; usable: number; bytes: number }[]> => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      if (withSession)
        await ctx.addInitScript((s: unknown) => {
          try {
            localStorage.setItem(
              "vyre.session.v1",
              JSON.stringify({ sessions: { [(s as { baseUrl: string }).baseUrl]: s } }),
            );
          } catch {
            /* blocked */
          }
        }, session);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...LINK });
      let bytes = 0;
      cdp.on("Network.loadingFinished", (e: { encodedDataLength: number }) => {
        bytes += e.encodedDataLength;
      });
      const rows: { dcl: number; usable: number; bytes: number }[] = [];
      for (let v = 0; v < visits; v++) {
        bytes = 0;
        await page.goto(url, { waitUntil: "commit" });
        await page.waitForFunction(() => performance.getEntriesByName("app.usable").length > 0, null, {
          timeout: 60_000,
        });
        const m = await page.evaluate(() => ({
          dcl: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domContentLoadedEventEnd,
          usable: performance.getEntriesByName("app.usable")[0]!.startTime,
        }));
        rows.push({ dcl: Math.round(m.dcl), usable: Math.round(m.usable), bytes });
        await page.waitForTimeout(300);
      }
      await ctx.close();
      return rows;
    };
    const cold: number[] = [];
    const second: number[] = [];
    const home: number[] = [];
    const homeAgain: number[] = [];
    const bytesCold: number[] = [];
    for (let i = 0; i < 5; i++) {
      const [a, b] = await open(`${d.url}/`, false, 2);
      cold.push(a!.usable);
      bytesCold.push(a!.bytes);
      second.push(b!.usable);
      const [h, h2] = await open(`${d.url}/chats`, true, 2);
      home.push(h!.usable);
      homeAgain.push(h2!.usable);
    }
    const line = `first-load cold ${median(cold)} ms (${(median(bytesCold) / 1e6).toFixed(2)} MB sent), second visit ${median(second)} ms, signed-in home ${median(home)} ms (second visit ${median(homeAgain)} ms)`;
    console.log(line);
    assert.ok(
      median(cold) <= FIRST_LOAD_BUDGET_MS.signInCold,
      `${line}: cold over ${FIRST_LOAD_BUDGET_MS.signInCold} ms`,
    );
    assert.ok(
      median(second) <= FIRST_LOAD_BUDGET_MS.secondVisit,
      `${line}: second visit over ${FIRST_LOAD_BUDGET_MS.secondVisit} ms`,
    );
    assert.ok(median(home) <= FIRST_LOAD_BUDGET_MS.homeCold, `${line}: home over ${FIRST_LOAD_BUDGET_MS.homeCold} ms`);
    assert.ok(
      median(homeAgain) <= FIRST_LOAD_BUDGET_MS.homeSecondVisit,
      `${line}: home on a second visit over ${FIRST_LOAD_BUDGET_MS.homeSecondVisit} ms`,
    );
  } finally {
    await browser.close();
    await stop(d);
  }
});
