// Console Access pages, part: Groups and Access reviews. The walk lives in console-access-pages.ts; the parts are split over files so each stays under the 120 s cap.
import test from "node:test";
import { runAccessPages } from "./console-access-pages.ts";

test("production Console Access pages: Groups and Access reviews", async (t) => {
  await runAccessPages(t, ["groups", "reviews"], await import("playwright-core"));
});
