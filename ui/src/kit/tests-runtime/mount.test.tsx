// The shots mount for this packet renders the 20-screen run: 20 Kit screens, each in its loading state on the first frame.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount, { title } from "../../../../scripts/shots/mounts/P-L9_13.tsx";

test("the mount renders 20 Kit screens, loading, with the run scroller the probe looks for", () => {
  const html = renderToStaticMarkup(<Mount />);
  assert.equal(title, "Kit runtime, 20 screens");
  assert.equal(html.match(/data-testid="kit-screen-/g)?.length, 20);
  assert.match(html, /data-testid="kit-run"/);
  assert.ok((html.match(/data-testid="kit-skeleton"/g)?.length ?? 0) >= 1, "screens with queries start as skeletons");
});
