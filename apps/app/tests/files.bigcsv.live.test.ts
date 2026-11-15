// F20 (13 Nov 2026): a Drive CSV opened as 0 rows. A CSV of 3000 rows opens with every row, in the real app.
import test from "node:test";
import { walk } from "./files-walk.ts";

test("F20: a CSV of 3000 rows opens with every row, not 0 rows", async (t) => {
  await walk(t, ["bigcsv"]);
});
