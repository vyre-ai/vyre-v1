// The sweep: every case of test/support/reach-cases.ts that needs no outside account, as owner and as member, printing a row per step (reach-kit row()). Not a test file: run it on a box with
// `REACH_PART=note,site node test/support/reach-survey.ts` (a part keeps it under a minute); nothing runs it in CI. The assertions are test/reach.made-for-me.*.live.test.ts.
import test from "node:test";
import { bootReach, row } from "./reach-kit.ts";
import { CASES, runBaseline, runCase } from "./reach-cases.ts";

const PART = (process.env["REACH_PART"] ?? "").split(",").filter(Boolean);
test("sweep: made for me, usable by the maker", { timeout: 115_000 }, async () => {
  const r = await bootReach();
  try {
    for (const who of ["owner", "member"] as const)
      for (const c of CASES.filter((x) => PART.length === 0 || PART.includes(x.id))) {
        try {
          await runCase(r, who, c);
          if (process.env["REACH_BASE"]) await runBaseline(r, who, c);
        } catch (e) {
          row({ case: c.id, who, step: "harness", result: String((e as Error).message).slice(0, 300) });
        }
      }
  } finally {
    await r.stop();
  }
});
