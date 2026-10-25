// P-L9b_09b: the agent page's tab strip folds like the right pane's, through the same fit (rightpane/fit.ts). At the phone width (390 px) Settings never clips: what does not fit
// goes behind More, the open tab stays drawn, and the page still lists every tab on a wide screen.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TABS as PAGE_TABS } from "../agentpage/model.ts";
import { AgentPage } from "../agentpage/AgentPage.tsx";
import { createSample } from "../agentpage/sample.ts";
import { HEADER_CHROME, MORE_KEY, fitTabs, tabWidth } from "./model.ts";

test("at 390 px the page column (358 px) folds the last tabs behind More and never clips", () => {
  const col = 390 - 32;
  const { shown, hidden } = fitTabs(PAGE_TABS, "chats", col);
  assert.ok(hidden.length > 0, "five tabs do not fit the room a phone leaves");
  const used = shown.reduce((n, t) => n + tabWidth(t.title), 0) + tabWidth("More") + 2;
  assert.ok(used <= col - HEADER_CHROME, `${used} fits ${col - HEADER_CHROME}`);
  assert.ok(hidden.some((t) => t.key === "settings"), "Settings waits behind More");
  assert.equal(MORE_KEY, "more");
});

test("the open tab is always drawn, even when it is one of the last", () => {
  const { shown, hidden } = fitTabs(PAGE_TABS, "settings", 390 - 32);
  assert.ok(shown.some((t) => t.key === "settings"));
  assert.deepEqual([...shown, ...hidden].map((t) => t.key).sort(), PAGE_TABS.map((t) => t.key).sort());
});

test("on a wide screen the agent page draws all five tabs and no More", () => {
  const s = createSample("owner");
  const out = renderToStaticMarkup(<AgentPage data={s.data} window={{ start: 0, end: 500 }} />).replaceAll("<!-- -->", "");
  for (const t of ["Chats", "Memory", "Files", "Computer", "Settings"]) assert.ok(out.includes(`>${t}<`), t);
  assert.ok(!out.includes(">More<"));
});
