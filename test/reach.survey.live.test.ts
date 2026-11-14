// The sweep, batch 2: the cases of test/support/reach-cases.ts that need no outside account. One file per few cases (a file has 120 s).
import test from "node:test";
import { bootReach, row } from "./support/reach-kit.ts";
import { CASES, runBaseline, runCase } from "./support/reach-cases.ts";

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
