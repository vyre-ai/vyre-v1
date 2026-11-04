// One check every real-browser walk makes after each step (owner/lead, 5 Nov): no error boundary is on screen and no React or script error is in the console. A walk that shoots "Couldn't draw this page"
// and still passes is a broken walk; with this, a crash is a red test. Use: `const guard = guardCrashes(page); ... await guard.check("after Plan");` and `guard.assertClean()` at the end.
import assert from "node:assert/strict";

/** The words of the app's error pages (startup/AppRoot RootBoundary, shell PlaceHost, States kind=error). */
export const BOUNDARY_TEXTS = ["Couldn't draw this page", "Couldn't open Vyre", "Something went wrong here"];
/** Console and page errors that are not crashes: the Space refusing a read the page then handles, a resize observer notice. */
const NOISE = /ResizeObserver|Failed to load resource|favicon|net::ERR/i;
const CRASH = /Minified React error|React error|Invalid hook call|Rendered (more|fewer) hooks|is not defined|Cannot read properties|is not a function|Uncaught|ReferenceError|TypeError/i;

interface PageLike {
  on(event: "pageerror", f: (e: Error) => void): unknown;
  on(event: "console", f: (m: { type(): string; text(): string }) => void): unknown;
  locator(sel: string): { innerText(o?: { timeout?: number }): Promise<string> };
  url(): string;
}

export interface CrashGuard {
  /** Throws when an error page is on screen or a crash was logged since the last check. */
  check(where: string): Promise<void>;
  /** Every crash seen so far. */
  crashes(): string[];
}

export function guardCrashes(page: PageLike): CrashGuard {
  const seen: string[] = [];
  page.on("pageerror", (e) => { if (!NOISE.test(e.message)) seen.push(`pageerror: ${e.message.slice(0, 300)}`); });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text()) && CRASH.test(m.text())) seen.push(`console: ${m.text().slice(0, 300)}`); });
  let reported = 0;
  return {
    crashes: () => [...seen],
    async check(where) {
      const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      for (const t of BOUNDARY_TEXTS) assert.ok(!text.includes(t), `${where}: an error page is on screen ("${t}") at ${page.url()}`);
      const fresh = seen.slice(reported);
      reported = seen.length;
      assert.deepEqual(fresh, [], `${where}: a crash was logged at ${page.url()}`);
    },
  };
}
