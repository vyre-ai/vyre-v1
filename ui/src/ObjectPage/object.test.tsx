// ui/ObjectPage: header (name, kind, owner, status, actions), tabs Overview, Access, Activity plus specifics, a side sheet.
// A destructive action shows its impact first and offers Undo afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OBJECT_PAGE_BASE_TABS,
  ObjectPage,
  confirmLine,
  doneLine,
  frozenObjectPageProps,
  moveTab,
  settleObjectAction,
  splitActions,
  statusTone,
  subtitle,
  tabText,
  withBaseTabs,
} from "./index.tsx";
import type { ObjectAction, ObjectTab } from "./index.tsx";

const text = (html: string): string => html.replace(/<[^>]+>/g, "");
const ACTIONS: readonly ObjectAction[] = [
  { id: "change-roles", label: "Change roles", destructive: false },
  { id: "view-as", label: "View as", destructive: false },
  { id: "remove", label: "Remove", destructive: true },
];

test("every object has Overview, Access and Activity; specific tabs follow, and a specific tab with a base id replaces it in place", () => {
  assert.deepEqual(OBJECT_PAGE_BASE_TABS.map((t) => t.id), ["overview", "access", "activity"]);
  const tabs = withBaseTabs([{ id: "devices", label: "Devices", count: 1 }, { id: "access", label: "Access", count: 12 }]);
  assert.deepEqual(tabs.map((t) => t.id), ["overview", "access", "activity", "devices"]);
  assert.equal(tabs.find((t) => t.id === "access")?.count, 12);
  assert.deepEqual(withBaseTabs([]).map((t) => t.id), ["overview", "access", "activity"]);
});

test("arrows move between tabs without wrapping; Home and End jump", () => {
  const tabs: readonly ObjectTab[] = withBaseTabs([{ id: "devices", label: "Devices", count: 1 }]);
  assert.equal(moveTab(tabs, "overview", "ArrowRight"), "access");
  assert.equal(moveTab(tabs, "overview", "ArrowLeft"), "overview", "stops at the first");
  assert.equal(moveTab(tabs, "devices", "ArrowRight"), "devices", "stops at the last");
  assert.equal(moveTab(tabs, "access", "End"), "devices");
  assert.equal(moveTab(tabs, "access", "Home"), "overview");
  assert.equal(moveTab(tabs, "missing", "ArrowRight"), "overview");
  assert.equal(moveTab([], "x", "Home"), "x");
});

test("a tab with a count reads 'Access 12'", () => {
  assert.equal(tabText({ id: "access", label: "Access", count: 12 }), "Access 12");
  assert.equal(tabText({ id: "overview", label: "Overview", count: null }), "Overview");
  assert.equal(tabText({ id: "x", label: "Zero", count: 0 }), "Zero 0");
});

test("actions split into one outlined button, quiet buttons and destructive ones kept off the page face", () => {
  const split = splitActions(ACTIONS);
  assert.equal(split.primary?.id, "change-roles");
  assert.deepEqual(split.secondary.map((a) => a.id), ["view-as"]);
  assert.deepEqual(split.destructive.map((a) => a.id), ["remove"]);
  assert.equal(splitActions([]).primary, null);
  assert.equal(splitActions([{ id: "d", label: "Delete", destructive: true }]).primary, null, "only destructive actions: no outlined button");
});

test("a destructive action states its impact before it runs, and says what it did after", () => {
  const remove = ACTIONS[2] as ObjectAction;
  assert.equal(confirmLine(remove, "Omar", "Removing Omar reassigns 3 things and ends 1 session."), "Removing Omar reassigns 3 things and ends 1 session.");
  assert.equal(confirmLine(remove, "Omar", undefined), "Remove Omar?");
  assert.equal(confirmLine(remove, "Omar", "   "), "Remove Omar?");
  assert.equal(doneLine(remove, "Omar"), "Remove: Omar.");
});

test("status tones and the kind and owner line", () => {
  assert.equal(statusTone("Active"), "ok");
  assert.equal(statusTone(" healthy "), "ok");
  assert.equal(statusTone("Invited"), "warn");
  assert.equal(statusTone("Disabled"), "off");
  assert.equal(subtitle("Person", "Northwind"), "Person · Northwind");
  assert.equal(subtitle("Person", "Northwind", "omar@northwind.example"), "Person · omar@northwind.example · Northwind");
  assert.equal(subtitle("Role", ""), "Role");
});

test("the page renders the frozen props: name, kind, owner, status, tabs with counts, the change-roles button and More", () => {
  const html = renderToStaticMarkup(<ObjectPage {...frozenObjectPageProps} density="regular" />);
  assert.match(html, /aria-label="Person: Omar"/);
  assert.match(html, /data-testid="object-header"/);
  assert.ok(text(html).includes("Omar"));
  assert.ok(text(html).includes("Active"));
  assert.ok(text(html).includes("Person · Northwind"));
  for (const id of ["overview", "access", "activity"]) assert.match(html, new RegExp(`data-testid="object-tab-${id}"`));
  assert.match(html, /aria-label="Access 4"/);
  assert.match(html, /data-testid="object-action-change-roles"/);
  assert.doesNotMatch(html, /data-testid="object-action-remove"/, "Remove is not a button on the page face");
  assert.match(html, /data-testid="object-more"/, "Remove lives in the More menu");
  assert.doesNotMatch(html, /data-testid="object-sheet"/);
  assert.match(html, /aria-selected="true"/);
});

test("on a phone every action sits in the More menu", () => {
  const html = renderToStaticMarkup(<ObjectPage {...frozenObjectPageProps} density="compact" />);
  assert.doesNotMatch(html, /data-testid="object-action-change-roles"/);
  assert.match(html, /data-testid="object-more"/);
  assert.match(html, /data-density="compact"/);
});

test("the side sheet shows when open, with its title and a close control", () => {
  const html = renderToStaticMarkup(<ObjectPage {...frozenObjectPageProps} sheetOpen sheetTitle="Access check" sheet={<span>Why Omar can see Rivera</span>} />);
  assert.match(html, /data-testid="object-sheet"/);
  assert.match(html, /data-testid="object-sheet-close"/);
  assert.ok(text(html).includes("Access check"));
  assert.ok(text(html).includes("Why Omar can see Rivera"));
});

test("the breadcrumb names the list the object belongs to", () => {
  const html = renderToStaticMarkup(<ObjectPage {...frozenObjectPageProps} parent="People" />);
  assert.match(html, /data-testid="object-crumbs"/);
  assert.match(html, /aria-label="Back to People"/);
  assert.ok(text(html).includes("People"));
});

test("the body of the active tab is the children", () => {
  const html = renderToStaticMarkup(<ObjectPage {...frozenObjectPageProps}><p>Roles: Member</p></ObjectPage>);
  assert.ok(text(html).includes("Roles: Member"));
  assert.match(html, /data-testid="object-body"/);
});

test("object actions report success only after async work resolves and preserve a truthful failure", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let settled = false;
  const work = settleObjectAction(() => pending).then((result) => { settled = result.ok; return result; });
  await Promise.resolve();
  assert.equal(settled, false, "a pending mutation is not reported done");
  release();
  assert.deepEqual(await work, { ok: true });
  const failed = await settleObjectAction(async () => { throw new Error("permission held"); });
  assert.deepEqual(failed, { ok: false, error: "permission held" });
});
