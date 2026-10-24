import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Node runs .ts files by stripping types but has no loader for .tsx. The placeholders hold no JSX, so load them as TypeScript.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return { format: "module-typescript", source: readFileSync(fileURLToPath(url)), shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { ComposerPlaceholder } = await import("../../Composer/Placeholder.tsx");
const { ListSectionsPlaceholder } = await import("../../ListSections/Placeholder.tsx");
const { MenuPlaceholder } = await import("../../Menu/Placeholder.tsx");
const { RecipientsPlaceholder } = await import("../../Recipients/Placeholder.tsx");
const { replyAll } = await import("../../Recipients/props.ts");
const { RowPlaceholder } = await import("../../Row/Placeholder.tsx");
const { PanePlaceholder, SidePanePlaceholder } = await import("../../SidePane/Placeholder.tsx");
const { StatesPlaceholder } = await import("../../States/Placeholder.tsx");
const { TabStripPlaceholder } = await import("../../TabStrip/Placeholder.tsx");
const { VirtualListPlaceholder } = await import("../../VirtualList/Placeholder.tsx");

function labelOf(html: string): string {
  const m = /^<div data-placeholder="[^"]*" data-label="([^"]*)" aria-label="\1"/.exec(html);
  assert.ok(m, `labelled box expected: ${html.slice(0, 80)}`);
  return m[1] as string;
}
function nameOf(html: string): string {
  return (/^<div data-placeholder="([^"]*)"/.exec(html) as RegExpExecArray)[1] as string;
}

test("VirtualList renders its labelled placeholder with full-width ui/Row rows", () => {
  const html = VirtualListPlaceholder({ data: [{ title: "Inbox" }, { title: "Sent" }], renderItem: () => null, rowHeight: 32 });
  assert.equal(nameOf(html), "VirtualList");
  assert.equal(labelOf(html), "Inbox");
  assert.match(html, /data-count="2"/);
  assert.match(html, /data-row-height="32"/);
  assert.equal(html.match(/data-row data-width="100%"/g)?.length, 2);
  assert.equal(labelOf(VirtualListPlaceholder({ data: [], renderItem: () => null, rowHeight: "measure" })), "VirtualList");
});

test("Menu appends Report a problem last, after a separator, and leaves source other alone", () => {
  const html = MenuPlaceholder({ items: [{ label: "Open" }, { label: "Delete", danger: true }] });
  assert.equal(nameOf(html), "Menu");
  assert.equal(labelOf(html), "Open");
  const items = [...html.matchAll(/<div data-item="true"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(items, ["Open", "Delete", "Report a problem"]);
  assert.match(html, /<div data-separator="true"><\/div><div data-item="true" role="menuitem" data-report="true">Report a problem/);
  assert.equal(html.match(/Report a problem/g)?.length, 1);
  const again = MenuPlaceholder({ items: [{ label: "Open" }, { label: "Report a problem" }] });
  assert.equal(again.match(/Report a problem/g)?.length, 1);
  assert.doesNotMatch(MenuPlaceholder({ items: [{ label: "Open" }], source: "other" }), /Report a problem/);
});

test("Menu is all icons or no icons", () => {
  const icons = MenuPlaceholder({ items: [{ label: "Open", icon: "open" }] });
  assert.match(icons, /data-icon="flag"/);
  const plain = MenuPlaceholder({ items: [{ label: "Open", icon: "open" }, { label: "Copy" }] });
  assert.doesNotMatch(plain, /data-icon="flag"/);
});

test("TabStrip renders the active tab as its label", () => {
  const html = TabStripPlaceholder({ tabs: [{ key: "a", title: "Chat" }, { key: "b", title: "Files", pinned: true }], active: "b", onPlus: () => {}, plusTitle: "New tab" });
  assert.equal(nameOf(html), "TabStrip");
  assert.equal(labelOf(html), "Files");
  assert.match(html, /data-tab="b" aria-selected="true" data-pinned="true"/);
  assert.match(html, /data-tab="a" aria-selected="false"/);
  assert.match(html, /data-plus="true">New tab/);
});

test("Pane and SidePane put the one toggle at the far left of the header (D57)", () => {
  for (const html of [
    PanePlaceholder({ toggle: { open: false }, title: "Details", tabs: [{ key: "x", title: "Info" }], activeTab: "x" }),
    SidePanePlaceholder({ toggle: { open: true }, paneKey: "ask", tabs: [{ key: "x", title: "Info" }] }),
  ]) {
    assert.match(html, /<header data-pane-header data-toggle-count="1"[^>]*><button type="button" data-pane-toggle="far-left"/);
    assert.equal(html.match(/data-pane-toggle/g)?.length, 1);
  }
  assert.equal(labelOf(PanePlaceholder({ toggle: { open: false }, title: "Details" })), "Details");
  assert.equal(labelOf(SidePanePlaceholder({ toggle: { open: true }, paneKey: "ask" })), "ask");
  assert.match(PanePlaceholder({ toggle: { open: true } }), /data-inner-toggle="hidden"/);
  assert.match(PanePlaceholder({ toggle: { open: false } }), /data-inner-toggle="shown"/);
  assert.match(SidePanePlaceholder({ toggle: { open: true }, paneKey: "ask" }), /data-min="280" data-max="0.7"/);
});

test("Row renders full width with selection and hover state", () => {
  const html = RowPlaceholder({ id: "r1", title: "Acme", note: "Open", selected: true });
  assert.equal(nameOf(html), "Row");
  assert.equal(labelOf(html), "Acme");
  assert.match(html, /data-width="100%" data-selected="true" data-hovered="false"/);
  assert.match(html, /<span data-note>Open<\/span>/);
});

test("States render empty, offline and error from frozen props", () => {
  const empty = StatesPlaceholder({ kind: "empty", title: "No files yet", icon: "files", action: { label: "Add a file", onPress: () => {} } });
  assert.equal(nameOf(empty), "States");
  assert.equal(labelOf(empty), "No files yet");
  assert.match(empty, /data-kind="empty" data-icon="files"/);
  assert.match(empty, /data-action="primary">Add a file/);
  assert.equal(labelOf(StatesPlaceholder({ kind: "offline", title: "You are offline" })), "You are offline");
  const err = StatesPlaceholder({ kind: "error", message: "Could not save", cause: "Disk full", next: "Free space", retryable: true, traceId: "t-1" });
  assert.equal(labelOf(err), "Could not save");
  for (const part of ["data-action=\"retry\"", "Copy trace id", "Report a problem", "data-trace>t-1", "data-cause>Disk full", "data-next>Free space"]) assert.ok(err.includes(part), part);
  assert.doesNotMatch(StatesPlaceholder({ kind: "error", message: "x" }), /data-action="retry"/);
});

test("Composer always shows the who-will-answer line and reserves the recipients slot", () => {
  const html = ComposerPlaceholder({ whoWillAnswer: "Ada will answer", sendsOutside: true, working: true, symbols: ["at", "slash"], chips: [{ kind: "agent", name: "Ada" }], engineLine: "Switched to Claude" });
  assert.equal(nameOf(html), "Composer");
  assert.equal(labelOf(html), "Ada will answer");
  assert.match(html, /data-slot="recipients"/);
  assert.match(html, /data-who="true">Ada will answer/);
  assert.match(html, /data-send="true">Stop/);
  assert.match(html, /data-symbol="at">@.*data-symbol="slash">\//);
  assert.doesNotMatch(html, /data-symbol="hash"/);
  assert.doesNotMatch(ComposerPlaceholder({ whoWillAnswer: "You" }), /data-slot="recipients"/);
});

test("Recipients render To, Cc and Bcc in order and Reply All never repeats or includes me", () => {
  const html = RecipientsPlaceholder({ to: [{ email: "a@x.com", name: "Ann" }], cc: ["b@x.com"] });
  assert.equal(nameOf(html), "Recipients");
  assert.equal(labelOf(html), "Ann");
  assert.ok(html.indexOf('data-row="to"') < html.indexOf('data-row="cc"') && html.indexOf('data-row="cc"') < html.indexOf('data-row="bcc"'));
  assert.equal(labelOf(RecipientsPlaceholder({})), "Recipients");
  const r = replyAll({ from: "A@x.com", to: ["me@x.com", "a@x.com", "c@x.com"], cc: ["c@x.com", "d@x.com"] }, "ME@x.com");
  assert.deepEqual(r, { to: ["A@x.com", "c@x.com"], cc: ["d@x.com"] });
});

test("ListSections renders Personal, Shared with me and Space in order, missing ones empty", () => {
  const html = ListSectionsPlaceholder({ type: "forms", sections: [{ name: "Space", rows: [{ id: "1", title: "Intake", note: "3" }] }] });
  assert.equal(nameOf(html), "ListSections");
  assert.equal(labelOf(html), "forms");
  const names = [...html.matchAll(/data-section="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Personal", "Shared with me", "Space"]);
  assert.match(html, /data-section="Personal" data-count="0"/);
  assert.match(html, /data-row="ui\/Row" data-id="1" data-width="100%">Intake/);
});
