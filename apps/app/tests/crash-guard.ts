// One check every real-browser walk makes after each step (owner/lead, 5 Nov): no error boundary is on screen and no React or script error is in the console. A walk that shoots "Couldn't draw this page"
// and still passes is a broken walk; with this, a crash is a red test. Use: `const guard = guardCrashes(page); ... await guard.check("after Plan");` and `guard.assertClean()` at the end.
import assert from "node:assert/strict";
import { rawIdsIn } from "../../../lib/id-shapes.ts";

/** The words of the app's error pages (startup/AppRoot RootBoundary, shell PlaceHost, States kind=error). */
export const BOUNDARY_TEXTS = ["Couldn't draw this page", "Couldn't open Vyre", "Something went wrong here"];
/** Console and page errors that are not crashes: the Space refusing a read the page then handles, a resize observer notice. */
const NOISE = /ResizeObserver|Failed to load resource|favicon|net::ERR/i;
const CRASH =
  /Minified React error|React error|Invalid hook call|Rendered (more|fewer) hooks|is not defined|Cannot read properties|is not a function|Uncaught|ReferenceError|TypeError/i;

/**
 * Pages whose purpose is to show an id. A walk that visits one says so by name when it checks (`guard.check(where, { idsOnPurpose: "space-id" })`), and the reason is here, so the list can be read in one place
 * and a test (crash-guard.test.ts) fails when it grows without the lead reading it. Do not add a name to skip a page that shows an id by mistake: fix the page.
 */
export const IDS_ON_PURPOSE = {
  // owner, 13 Nov 2026: admins may see the Space ID on Console General
  "space-id":
    "Console > Space > General shows the Space ID in full beside Copy Space ID, so an admin can read it out and quote it to support (owner, 13 Nov 2026: admins may see the Space ID on Console General).",
} as const;
export type IdsOnPurpose = keyof typeof IDS_ON_PURPOSE;

/** What the scan does not read: text a person wrote or named (code, pre-formatted text, fields, editable text, anything marked data-user-content). The app's own text is everything else. */
export const USER_CONTENT = "pre, code, kbd, samp, textarea, input, [contenteditable], [data-user-content]";

interface PageLike {
  on(event: "pageerror", f: (e: Error) => void): unknown;
  on(event: "console", f: (m: { type(): string; text(): string }) => void): unknown;
  locator(sel: string): { innerText(o?: { timeout?: number }): Promise<string> };
  evaluate?<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  url(): string;
}

export interface CrashGuard {
  /** Throws when an error page is on screen or a crash was logged since the last check. */
  check(where: string, opts?: { idsOnPurpose?: IdsOnPurpose }): Promise<void>;
  /** Every crash seen so far. */
  crashes(): string[];
}

export function guardCrashes(page: PageLike): CrashGuard {
  const seen: string[] = [];
  page.on("pageerror", (e) => {
    if (!NOISE.test(e.message)) seen.push(`pageerror: ${e.message.slice(0, 300)}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text()) && CRASH.test(m.text()))
      seen.push(`console: ${m.text().slice(0, 300)}`);
  });
  let reported = 0;
  return {
    crashes: () => [...seen],
    async check(where, opts = {}) {
      const text = await page
        .locator("body")
        .innerText({ timeout: 5000 })
        .catch(() => "");
      for (const t of BOUNDARY_TEXTS)
        assert.ok(!text.includes(t), `${where}: an error page is on screen ("${t}") at ${page.url()}`);
      const fresh = seen.slice(reported);
      reported = seen.length;
      assert.deepEqual(fresh, [], `${where}: a crash was logged at ${page.url()}`);
      // an id is never shown to a person (owner, 13 Nov 2026): the app's own text is scanned, not what a person wrote or named, and a page that shows one on purpose says so by name
      if (opts.idsOnPurpose !== undefined) {
        assert.ok(
          opts.idsOnPurpose in IDS_ON_PURPOSE,
          `${where}: "${opts.idsOnPurpose}" is not a listed reason to show an id`,
        );
        return;
      }
      const own = page.evaluate
        ? await page
            .evaluate((bad) => {
              const out: string[] = [];
              const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              for (let n = w.nextNode(); n; n = w.nextNode()) {
                const el = n.parentElement;
                if (el && !el.closest(bad) && el.getClientRects().length > 0) out.push(n.nodeValue ?? "");
              }
              return out.join("\n");
            }, USER_CONTENT)
            .catch(() => text)
        : text;
      const ids = rawIdsIn(own);
      const at = ids[0] === undefined ? 0 : own.indexOf(ids[0]);
      assert.deepEqual(
        ids,
        [],
        `${where}: an id is shown to the person (${ids.join(", ")}) near "${own.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, " ")}" at ${page.url()}`,
      );
    },
  };
}
