// The Personal Space Home shots mount opens the real shell after mount (the static export keeps first-render markup), so its first frame is empty. The page itself is tested in
// apps/app/src/places/chats/fixes/l9b_02c.test.tsx and the shell in apps/app/src/shell.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount, { title } from "./mounts/P-L9b_02c.tsx";

test("the Personal Space shell mount draws nothing until it has read ?space after mount", () => {
  assert.equal(title, "Shell on Home (Personal Space)");
  assert.equal(renderToStaticMarkup(<Mount />), "");
});
