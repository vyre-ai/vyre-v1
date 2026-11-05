// Console Access pages, part: Policies. The walk lives in console-access-pages.ts; the parts are split over files so each stays under the 120 s cap.
import test from "node:test";
import { runAccessPages } from "./console-access-pages.ts";

test("production Console Access pages: Policies", async (t) => {
  await runAccessPages(t, ["policies"], await import("playwright-core"));
});
