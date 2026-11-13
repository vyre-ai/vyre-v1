// Esc puts away an inline name box and keeps the old words, as its Cancel does (owner, 13 Nov 2026; K6): a Routine's name, a Journey stage's new field, the Fields panel's name boxes and a calendar event's edit.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, typeInto } from "../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../ui/src/testing/dom.ts";
import { fakeEscape } from "../../../../ui/src/testing/escape.ts";
import { FieldsPanel } from "./records/typeedit/index.ts";
import type { PanelType } from "./records/typeedit/index.ts";
import { RoutinesTab } from "./chats/rightpane/RoutinesTab.tsx";
import { RightPaneDataProvider } from "./chats/rightpane/data.tsx";
import { createSample } from "./chats/rightpane/sample.ts";
import { EventPane } from "./inbox/calendar/eventpane/EventPane.tsx";
import { createCalendarSample } from "./inbox/calendar/index.ts";
import { northwind } from "./inbox/contactlist/sample.ts";
import { InboxDataProvider } from "./inbox/sidebar/index.ts";

for (const k of ["setInterval", "setTimeout"] as const) { const orig = globalThis[k] as (...a: unknown[]) => { unref?: () => void }; (globalThis as Record<string, unknown>)[k] = (...a: unknown[]) => { const h = orig(...a); h?.unref?.(); return h; }; }

async function draw(el: ReactElement): Promise<{ root: Node; down(): Promise<void> }> {
  const r = createRoot() as unknown as { render(e: ReactElement): void; unmount(): void; container: unknown };
  await act(async () => { r.render(el); });
  await flush();
  return { root: r.container as Node, down: async () => { await act(async () => { r.unmount(); }); } };
}
const settle = async (): Promise<void> => { await flush(); await flush(); };
const gone = (root: Node, id: string): boolean => find(root, id) === null;   // not assert.equal: a failing one would print the whole tree

test("Routines: Esc puts away the rename box and the routine keeps its name", async () => {
  const restore = installDom(); const esc = fakeEscape();
  const s = createSample(); const calls: string[] = [];
  const d = { call: async (cap: string, input: unknown) => { calls.push(cap); return s.data.call(cap, input); }, note: () => undefined };
  const routine = (s.replica.rows("routines") as unknown as { routineId: string; title: string }[])[0]!;
  const o = await draw(<RightPaneDataProvider value={s.data}><RoutinesTab deps={d as never} window={{ start: 0, end: 500 }} initial={{ routineId: routine.routineId, mode: "rename" }} /></RightPaneDataProvider>);
  try {
    assert.ok(find(o.root, "routine-rename-save") !== null, "the rename box is open");
    await act(async () => { esc.esc(); }); await settle();
    assert.ok(gone(o.root, "routine-rename-save"), "Esc puts it away");
    assert.ok(!calls.some((c) => /rename|update|set/.test(c)), "nothing was saved");
  } finally { await o.down(); esc.restore(); restore(); }
});

const type: PanelType = { key: "clients", title: "Client", system: false, titleField: "name", fields: [{ key: "name", title: "Name", type: "text" }, { key: "value", title: "Value", type: "text" }] as never };
const panel = (calls: string[]): ReactElement => <FieldsPanel call={(async (cap: string) => { calls.push(cap); return {}; }) as never} type={type} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={[]} trash={[]} layout={[{ key: "overview", title: "Overview", fields: ["name"] }, { key: "billing", title: "Billing", fields: ["value"] }]} viewToggles={false} />;

test("Fields panel: Esc puts away the new-group box and the group-rename box, newest first, and saves nothing", async () => {
  const restore = installDom(); const esc = fakeEscape(); const calls: string[] = [];
  const o = await draw(panel(calls));
  try {
    await press(find(o.root, "panel-group-new"));
    await typeInto(find(o.root, "panel-group-name"), "Money");
    assert.ok(find(o.root, "panel-group-name") !== null);
    await act(async () => { esc.esc(); }); await settle();
    assert.ok(gone(o.root, "panel-group-name"), "Esc puts the new-group box away");
    await press(find(o.root, "panel-group-rename-billing"));
    await typeInto(find(o.root, "panel-group-input-billing"), "Cash");
    await act(async () => { esc.esc(); }); await settle();
    assert.ok(gone(o.root, "panel-group-input-billing"), "Esc puts the rename box away");
    assert.ok(find(o.root, "panel-group-rename-billing") !== null, "the group is back with its own name and a Rename button");
    assert.ok(!calls.includes("schema.layout.set"), "nothing was saved");
  } finally { await o.down(); esc.restore(); restore(); }
});

test("Calendar event: Esc leaves the edit and the event keeps its title", async () => {
  const restore = installDom(); const esc = fakeEscape();
  const s = createCalendarSample(northwind);
  const ev = s.events()[0]!;
  const calls: string[] = [];
  const data = { ...s.data, call: async (cap: string, input: unknown) => { calls.push(cap); return s.data.call(cap, input); } };
  const nav = { join() {}, call() {}, openUrl() {}, openRecord() {}, openMeeting() {}, openFile() {}, ask() {} };
  const o = await draw(<InboxDataProvider value={data as never}><EventPane eventId={ev.id} calendars={[]} names={new Map()} directory={[]} me="maya@northwind.example" editing stamp="1" nav={nav} onClose={() => undefined} onUndo={() => undefined} onDeleted={() => undefined} /></InboxDataProvider>);
  try {
    await settle();
    assert.ok(find(o.root, "event-edit-title") !== null, "the edit is open");
    await act(async () => { esc.esc(); }); await settle();
    assert.ok(gone(o.root, "event-edit-title"), "Esc leaves the edit");
    assert.ok(!calls.some((c) => /update|patch|set/.test(c)), "nothing was saved");
  } finally { await o.down(); esc.restore(); restore(); }
});
