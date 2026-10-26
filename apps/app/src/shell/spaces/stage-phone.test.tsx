// The shell on a phone (P-L9_35): a place with a sidebar shows its list or the opened body, never both; the body has a Back button; a computer shows both.
// @reads ../../../../../scripts/shots/mounts/P-L9_35.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarSlotProvider, escapeGoesBack } from "../sidebar/index.ts";
import { Stage } from "./Shell.tsx";

const props = { deviceId: "d1", personId: "p1", spaceId: "northwind", place: "files", epoch: 1 };
const entry = { title: "Files", searchPlaceholder: "Search files" };

/** The markup of the element that carries `testid`, from its tag to the first `>` (its own attributes only). */
function tagOf(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  assert.ok(at >= 0, `${testid} is drawn`);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}
const hidden = (html: string, testid: string): boolean => tagOf(html, testid).includes('aria-hidden="true"');
const draw = (compact: boolean, bodyOpen: boolean): string => renderToStaticMarkup(
  <SidebarSlotProvider {...props} compact={compact} initialEntry={entry} initialBodyOpen={bodyOpen}><Stage><Text>The open file</Text></Stage></SidebarSlotProvider>,
);

test("phone 390 px, nothing open: the sidebar list shows, the body is hidden, no Back", () => {
  const html = draw(true, false);
  assert.equal(hidden(html, "place-sidebar"), false);
  assert.equal(hidden(html, "place-body"), true);
  assert.ok(!html.includes('data-testid="sidebar-back"'));
});

test("phone 390 px, an item open: the sidebar is hidden, the body shows with a Back button named Back", () => {
  const html = draw(true, true);
  assert.equal(hidden(html, "place-sidebar"), true);
  assert.equal(hidden(html, "place-body"), false);
  assert.ok(html.includes("The open file"));
  assert.ok(tagOf(html, "sidebar-back").includes('aria-label="Back"'));
});

test("a computer shows the sidebar and the body together, with no Back", () => {
  for (const open of [false, true]) {
    const html = draw(false, open);
    assert.equal(hidden(html, "place-sidebar"), false, `sidebar, open=${open}`);
    assert.equal(hidden(html, "place-body"), false, `body, open=${open}`);
    assert.ok(!html.includes('data-testid="sidebar-back"'));
  }
});

test("Escape goes back only when nothing else took it", () => {
  assert.equal(escapeGoesBack({ key: "Escape", defaultPrevented: false }, false), true);
  assert.equal(escapeGoesBack({ key: "Escape", defaultPrevented: true }, false), false);
  assert.equal(escapeGoesBack({ key: "Escape", defaultPrevented: false }, true), false);
  assert.equal(escapeGoesBack({ key: "Enter", defaultPrevented: false }, false), false);
});
