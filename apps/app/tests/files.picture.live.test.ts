// F27 (14 Nov 2026): every picture in Files was blank, because an image element sends no sign-in. A picture in the viewer draws, in the real app.
import test from "node:test";
import { walk } from "./files-walk.test.ts";

test("F27: a picture opened in Files draws (not an empty checkerboard)", async (t) => {
  await walk(t, ["image"]);
});
