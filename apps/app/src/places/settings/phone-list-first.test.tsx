// On a phone Settings opens on its list of pages, not on a page (lane r32-nav, item 3); a link that names a page opens that page, and the page's own back returns to the list.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import type { SettingsProps } from "./SettingsPlace.tsx";
import { createSampleSettings, northwind } from "./sample.ts";

const html = (props: SettingsProps): string =>
  renderToStaticMarkup(
    <SettingsDataProvider value={createSampleSettings(northwind).data}>
      <SettingsPlace {...props} />
    </SettingsDataProvider>,
  ).replaceAll("<!-- -->", "");

test("a phone opens on the list: the search box and the rows, and no page body", () => {
  const out = html({ width: 390 });
  assert.ok(out.includes('data-testid="settings-search"'), "the list's search is the first thing");
  assert.ok(out.includes('data-testid="row-page-profile"'), "the pages are listed");
  assert.ok(!out.includes('data-testid="page-profile"'), "no page body yet");
});

test("a phone link that names a page opens that page, with the page's own back", () => {
  const out = html({ width: 390, initialPage: "appearance" });
  assert.ok(out.includes('data-testid="page-appearance"'), "the named page is drawn");
  assert.ok(out.includes('data-testid="back"'), "and its back to the list");
});

test("a computer is unchanged: the list and the page side by side", () => {
  const out = html({ width: 1280 });
  assert.ok(out.includes('data-testid="settings-search"'));
  assert.ok(out.includes('data-testid="page-profile"'));
});
