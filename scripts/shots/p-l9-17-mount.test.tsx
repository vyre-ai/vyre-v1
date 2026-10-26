// The phone shell's shots mount reads its query after mount (the static export keeps first-render markup), so its first frame is the blank page the client must also draw first.
// The shell itself is tested in apps/app/src/mobile/shell/mobile-nav.test.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount, { title } from "./mounts/P-L9_17.tsx";

test("the phone shell mount draws a blank first frame, then reads ?tab, ?space and ?empty after mount", () => {
  assert.equal(title, "Phone shell");
  const html = renderToStaticMarkup(<Mount />);
  assert.ok(!html.includes('data-testid="mobile-tabs"'), "the tab bar appears after mount, so server and client draw the same first frame");
});
