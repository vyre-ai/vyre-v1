// Run on a box with `node test/support/reach-survey-personal.ts` (not a test file: nothing runs it in CI).
// The "made for me" sweep in a Personal Space: one person, their own Assistant. Rows go to the sweep file; the assertions are in test/reach.made-for-me.*.live.test.ts.
import test from "node:test";
import { bootPersonal, row } from "./reach-kit.ts";
import { CASES, runCase } from "./reach-cases.ts";

const PART = (process.env["REACH_PART"] ?? "").split(",").filter(Boolean);
test("sweep (Personal Space): made for me, usable by the maker", { timeout: 115_000 }, async () => {
  const r = await bootPersonal();
  try {
    for (const c of CASES.filter((x) => PART.length === 0 || PART.includes(x.id))) {
      try {
        await runCase(r, "owner", c);
      } catch (e) {
        row({ case: c.id, who: "personal", step: "harness", result: String((e as Error).message).slice(0, 300) });
      }
    }
  } finally {
    await r.stop();
  }
});
