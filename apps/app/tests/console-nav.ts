// How a real-browser walk reaches a Console page the way a person does (the Console is ten places, see src/console/shell/sections.ts): the place in the side list (`row-nav-<section>`), then the tab
// (`tab-<its first page>`, only when the place has more than one), then the view under the tab's text switch (`view-<page>`, only for a second or third view), then the page itself (`page-<page>`).
// An old page id (groups, connectors, runs, kit ...) lands where it moved: resolve() maps it, so a walk can keep the id it always used.
import assert from "node:assert/strict";
import { resolve, sectionOf, tabOf } from "../src/console/shell/sections.ts";

/** The part of a Playwright page this helper uses; the walks pass their `Page`. */
interface NavPage {
  getByTestId(id: string): { click(o?: { timeout?: number }): Promise<void>; waitFor(o?: { timeout?: number }): Promise<void> };
  goto(url: string, o?: { waitUntil?: "load" }): Promise<unknown>;
}

/** Open /console on this origin and wait for the Console frame. */
export async function openConsole(page: NavPage, origin: string): Promise<void> {
  await page.goto(`${origin}/console`, { waitUntil: "load" });
  await page.getByTestId("console").waitFor({ timeout: 30_000 });
}

/** The page id a Console page opens as (an old id resolves to its new place). */
export const consolePageId = (pageId: string): string => resolve(pageId);

/** Click through the real navigation to a page: place row, tab, view, then wait for the page. Returns the resolved page id. */
export async function openConsolePage(page: NavPage, pageId: string, timeout = 30_000): Promise<string> {
  const id = resolve(pageId), section = sectionOf(id), tab = tabOf(id);
  assert.ok(section && tab, `${pageId} has a place in the Console`);
  await page.getByTestId(`row-nav-${section.id}`).click({ timeout: 60_000 });
  if (section.tabs.length > 1) await page.getByTestId(`tab-${tab.views[0]!.page}`).click({ timeout });
  if (tab.views[0]!.page !== id) await page.getByTestId(`view-${id}`).click({ timeout });
  await page.getByTestId(`page-${id}`).waitFor({ timeout });
  return id;
}
