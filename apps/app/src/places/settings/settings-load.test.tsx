// Settings reads its pages' rows through the one data hook and draws a page only when they are in. A read that fails is a plain error with Retry, not a page that says "Loading" for ever
// (13 Nov 2026: the Settings read's error was never read, so a failed read looked like a wait).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import { SettingsDataProvider } from "./data.tsx";
import type { SettingsData } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { createSampleSettings } from "./sample.ts";

const settingsWith = (rows: QueryState<unknown>): SettingsData => {
  const s = createSampleSettings();
  const query: LiveQuery<unknown> = { subscribe: () => () => undefined, getSnapshot: () => rows };
  return {
    ...s.data,
    screens: {
      ...s.data.screens,
      query: (id: string, name: string, state?: Record<string, unknown>) =>
        id === "settings.page" && name === "rows" ? query : s.data.screens.query(id, name, state),
    } as SettingsData["screens"],
  };
};
const html = (data: SettingsData, props: { initialQuery?: string } = {}): string =>
  renderToStaticMarkup(
    <SettingsDataProvider value={data}>
      <SettingsPlace width={1280} {...props} />
    </SettingsDataProvider>,
  ).replaceAll("<!-- -->", "");

test("when the read of the settings rows fails, the page says so plainly with Retry, not Loading", () => {
  const out = html(
    settingsWith({ status: "loading", error: { message: "The server did not answer.", code: "internal.error" } }),
  );
  assert.match(out, /data-testid="load-failed"/);
  assert.match(out, /Couldn(?:'|&#x27;)t load settings/);
  assert.match(out, /The server did not answer\./);
  assert.match(out, /data-testid="state-retry"/);
  assert.doesNotMatch(out, />Loading</);
  assert.match(out, /data-testid="settings-nav"/, "the page list and the title stay: only the page is replaced");
});

test("while the read is only waiting there is no error and no word Loading", () => {
  const out = html(settingsWith({ status: "loading" }));
  assert.doesNotMatch(out, /load-failed/);
  assert.doesNotMatch(out, />Loading</);
  assert.match(out, /data-testid="quiet"/);
});

test("a search over settings that could not load says so, not that nothing matches", () => {
  const out = html(settingsWith({ status: "loading", error: { message: "The server did not answer." } }), {
    initialQuery: "time",
  });
  assert.match(out, /data-testid="load-failed"/);
  assert.doesNotMatch(out, /search-none|Nothing matches/);
});
