// A real file opened in the real app shows its content (the walk is in files-walk.ts, shared by the files.*.live tests).
import test from "node:test";
import { walk } from "./files-walk.ts";

test("real files open with their content: csv, a two-sheet workbook, pdf, image, markdown, text; the shell's Back returns to the list; a file opened cold goes up to its folder; a failed live fetch shows Try again", async (t) => {
  await walk(t);
});
