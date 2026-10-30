// The Google and Microsoft setup shots mount draws every scenario over the real pages.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount from "./mounts/SUITE_01.tsx";

test("each scenario of the suite shots mount draws its page", () => {
  const seen: string[] = [];
  const g = globalThis as { location?: { search: string } };
  for (const [part, text] of [["google-new", "Google Workspace is not connected"], ["google-bad", "Google Workspace needs attention"], ["google-ok", "Google Workspace is connected"], ["ms-new", "Microsoft 365 is not connected"], ["ms-bad", "Microsoft 365 needs attention"], ["ms-ok", "Microsoft 365 is connected"]] as const) {
    g.location = { search: `?part=${part}` };
    const html = renderToStaticMarkup(<Mount />);
    assert.ok(html.includes(text), `${part}: ${text}`);
    seen.push(part);
  }
  delete g.location;
  assert.equal(seen.length, 6);
});
