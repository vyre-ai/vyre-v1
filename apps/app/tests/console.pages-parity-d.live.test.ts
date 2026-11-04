// Console page parity, part D of four (Computers): every page of these places draws at desktop width in light and graphite through the real navigation, without a crash, overflow or page error. The walk
// lives in console-pages-parity.ts; the places are split over four files so each stays under the 120 s cap (a place per tab, never a tab per page).
import test from "node:test";
import { runPagesParity } from "./console-pages-parity.ts";

test("production Console: Computers draw at desktop, light and graphite, without overflow or a crash", async (t) => {
  await runPagesParity(t, { places: ["Computers"] });
});
