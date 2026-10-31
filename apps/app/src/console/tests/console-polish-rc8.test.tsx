// rc.8 polish of the Console: an empty list is a designed state (an icon, two or three words, at most one action), a search with no match says so, a Row's leading icon or face has
// the gap the text needs, a disabled button says why beside it, and a form field stops at a readable width.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { Empty, Lead } from "../shell/ui.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import { People } from "../pages/Access.tsx";
import { ConsoleShell } from "../shell/ConsoleShell.tsx";

const noop = (): void => undefined;
const draw = (el: React.ReactElement, rows: Record<string, unknown> = {}): string => {
  const sample = createSampleConsole().data;
  const data: ConsoleData = { ...sample, screens: { ...sample.screens, capQuery: (cap: string) => { const v = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => v }; } } as never };
  return renderToStaticMarkup(<ConsoleDataProvider value={data}>{el}</ConsoleDataProvider>).replaceAll("<!-- -->", "");
};

test("Empty draws an icon tile and a line, and an action only when it is given one", () => {
  const plain = renderToStaticMarkup(<Empty testID="e">No people yet</Empty>);
  assert.ok(plain.includes("No people yet") && plain.includes("<svg") && !plain.includes('data-testid="e-action"'));
  const withAction = renderToStaticMarkup(<Empty testID="e" icon="search" action={{ label: "Clear search", onPress: noop }}>Nothing matches</Empty>);
  assert.ok(withAction.includes("Clear search") && withAction.includes('data-testid="e-action"'));
});

test("an object list with no rows is the designed empty state; a search with no match says Nothing matches", () => {
  const empty = renderToStaticMarkup(<ObjectList rows={[]} selectedId={null} onOpen={noop} empty="No sending domains yet" />);
  assert.ok(empty.includes("No sending domains yet") && empty.includes("<svg"));
  const row = { id: "r1", title: "Reviewers", actions: [] };
  const search = renderToStaticMarkup(<ObjectList rows={[row]} selectedId={null} onOpen={noop} search={{ value: "zzz", onSearch: noop }} empty="No groups yet" />);
  assert.ok(search.includes("Nothing matches") && !search.includes("No groups yet"));
});

test("Lead gives a Row's leading slot its gap", () => {
  const out = renderToStaticMarkup(<Lead><span>icon</span></Lead>);
  assert.match(out, /r-marginRight-/, "a right margin is set");
});

test("a disabled Create invite says why beside it", () => {
  const people = draw(<People />, { "access.principals.list": { principals: [] }, "access.roles.list": { roles: [] }, "access.groups.list": { groups: [] } });
  assert.ok(people.includes("Pick a role first"), "Create invite names what is missing");
});

test("on a phone the page title is the way to another page, and the Space name is not cut to a letter", () => {
  const sample = createSampleConsole().data;
  const shell = (width: number): string => renderToStaticMarkup(<ConsoleDataProvider value={sample}><ConsoleShell width={width} /></ConsoleDataProvider>).replaceAll("<!-- -->", "");
  const phone = shell(390);
  assert.ok(phone.includes('data-testid="console-pages"') && phone.includes("Go to another page"), "the title opens the page list");
  assert.ok(!phone.includes('data-testid="console-nav"'), "no side navigation on a phone");
  assert.ok(!phone.includes(">Console<"), "the Console label gives its room to the Space name");
  const desk = shell(1280);
  assert.ok(desk.includes('data-testid="console-nav"') && !desk.includes('data-testid="console-pages"') && desk.includes(">Console<"));
});
