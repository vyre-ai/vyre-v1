// F21 (13 Nov 2026): no way back from a file. The viewer uses the shell's one Back (the title bar's arrow): a file opened cold goes up to its folder, and the file draws no back control of its own.
import test from "node:test";
import { walk } from "./files-walk.test.ts";

test("F21: a file opened cold goes up to its folder by the shell's own Back, and the file has no back control of its own", async (t) => {
  await walk(t, ["cold"]);
});
