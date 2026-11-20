// Console, AI: the web search row. The service picker is always there; the Vault key picker only once a service is chosen; the key itself never appears.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { SEARCH_NOTE, SEARCH_OPTIONS, WebSearchSetting } from "./WebSearch.tsx";

function draw(element: ReactElement, rows: Record<string, unknown>): string {
  const sample = createSampleConsole().data;
  const data: ConsoleData = {
    ...sample,
    screens: {
      ...sample.screens,
      capQuery: (cap: string) => {
        const state = { status: "ready", data: rows[cap] };
        return { subscribe: () => () => undefined, getSnapshot: () => state };
      },
    } as never,
  };
  return renderToStaticMarkup(<ConsoleDataProvider value={data}>{element}</ConsoleDataProvider>);
}
const vault = {
  items: [
    {
      id: "vit_1",
      name: "Brave Search",
      handle: "#Brave_Search",
      kind: "api_key",
      fieldKeys: ["api_key"],
      yourLevel: "manage",
    },
  ],
};

test("the default shows the picker and no key field", () => {
  const html = draw(<WebSearchSetting />, { "settings.get": { row: { value: "default" } }, "vault.items.list": vault });
  const text = html.replace(/<[^>]*>/g, " ");
  assert.match(text, /Web search for agents/);
  assert.match(text, /Search service/);
  assert.match(text, /Default \(no key\)/);
  assert.ok(!/Vault item for/.test(text), "no key picker for the default");
  assert.ok(text.includes(SEARCH_NOTE));
});

test("a chosen service shows the Vault item picker for its key, and never a key", () => {
  const html = draw(<WebSearchSetting />, { "settings.get": { row: { value: "brave" } }, "vault.items.list": vault });
  const text = html.replace(/<[^>]*>/g, " ");
  assert.match(text, /Brave Search/);
  assert.match(text, /Vault item for Brave Search key/);
  assert.match(text, /Credentials stay in the Vault/);
  assert.deepEqual(
    SEARCH_OPTIONS.map((o) => o.key),
    ["default", "brave", "bing"],
  );
});
