// The Files mounts shots mount reads ?part and ?v after mount (the static export keeps first-render markup), so its first frame is blank and the client must draw the same one.
// The mounted-folder strip itself is tested in apps/app/src/shell/providers/files-mounts.test.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount, { title } from "./mounts/P-WIRE_C.tsx";

test("the Files mounts mount draws a blank first frame, then reads ?part and ?v after mount", () => {
  assert.equal(title, "Files mounts");
  assert.equal(renderToStaticMarkup(<Mount />), "");
});
