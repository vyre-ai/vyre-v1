// The Records and Files places over the Space's runtime: the sidebar, tree and views draw real rows from the Space, and without a runtime each draws its loading frames.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { liveQuery } from "../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../client/src/index.ts";
import { createSampleFiles } from "../../places/files/list/sample.ts";
import { createViewsSample } from "../../places/records/views-a/sample.ts";
import FilesPlace from "./files.tsx";
import { folderNodes } from "./files-data.ts";
import { RecordsDataProvider, RecordsSidebarSlot, RecordsStateProvider } from "../../places/records/sidebar/index.ts";
import { SidebarContent } from "../sidebar/index.ts";
import type { SidebarSlotApi } from "../sidebar/index.ts";
import RecordsPlace from "./records.tsx";
import { recordsData } from "./records-data.ts";
import { nameLookup } from "./records-live.ts";
import { ShellRuntimeProvider } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

function runtimeOver(sample: { data: { screens: ShellRuntime["screens"]; call: ShellRuntime["call"]; connection: ShellRuntime["connection"] }; replica: FakeReplica }, opened: unknown[] = []): ShellRuntime {
  const screens = Object.assign(Object.create(sample.data.screens) as ShellRuntime["screens"], {
    capQuery: (cap: string, input: Record<string, unknown> = {}) => liveQuery(sample.replica, cap as never, input as never),
  });
  return {
    screens, call: sample.data.call, connection: sample.data.connection,
    principals: { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [{ id: "usr_maya", name: "Maya Chen", kind: "person" }] }) },
    recordTitle: () => undefined, me: { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, clock: () => ({ now: 0, offsetMin: 0 }),
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: true,
    open: (t) => void opened.push(t), openUrl: () => undefined,
  };
}
const html = (el: ReactElement): string => renderToStaticMarkup(el).replaceAll("<!-- -->", "");

test("Records draws the record types in the sidebar and the open type as a table from the Space", () => {
  const rt = runtimeOver(createViewsSample());
  const out = html(<ShellRuntimeProvider value={rt}><RecordsPlace place="records" /></ShellRuntimeProvider>);
  assert.ok(out.includes("Clients"), "the open type's table shows its rows");
  assert.ok(out.includes('data-testid="records-place"'));
  assert.ok(!out.includes("records-place-loading"));
  assert.ok(!out.includes('data-testid="records-sidebar"'), "the sidebar is the shell's slot, not a frame in the place");
  // The slot's content is portalled, so it is read from the element the place registers.
  const el = RecordsSidebarSlot({}) as ReactElement<{ title: string; searchPlaceholder?: string; children: (q: string, slot: SidebarSlotApi) => ReactElement }>;
  assert.equal(el.type, SidebarContent, "the place registers its sidebar in the shared slot");
  assert.deepEqual([el.props.title, el.props.searchPlaceholder], ["Records", "Search records"]);
  const slot: SidebarSlotApi = { query: "", collapsed: false, setCollapsed: () => undefined, hasSidebar: true, compact: false, openBody: () => undefined, back: () => undefined, view: "body", title: "Records" };
  const side = (q: string): string => html(<RecordsDataProvider value={recordsData(rt)}><RecordsStateProvider>{el.props.children(q, slot)}</RecordsStateProvider></RecordsDataProvider>);
  assert.ok(side("").includes("Clients"), "the sidebar lists the record types");
  assert.ok(!side("zzzz").includes("Clients"), "the slot's search narrows the rows");
});

test("Records without a runtime draws the sidebar and table loading frames", () => {
  const out = html(<RecordsPlace place="records" />);
  assert.ok(out.includes("records-place-loading") && out.includes("records-sidebar-loading") && out.includes("records-table-loading"));
});

test("Files draws the folders in the tree and the top of Files in the list", () => {
  const rt = runtimeOver(createSampleFiles());
  const out = html(<ShellRuntimeProvider value={rt}><FilesPlace place="files" /></ShellRuntimeProvider>);
  assert.ok(out.includes('data-testid="files-place"'));
  assert.ok(out.includes("Sales") && out.includes("Money"), "the Space's folders show");
  assert.ok(!out.includes("files-place-loading"));
});

test("Files without a runtime draws the tree and list loading frames", () => {
  const out = html(<FilesPlace place="files" />);
  assert.ok(out.includes("files-place-loading") && out.includes("files-tree-loading") && out.includes("files-list-loading"));
});

test("the tree's folders come from the list's folder rows, personal and Space apart", () => {
  const nodes = folderNodes({ files: [], total: 2, folders: [
    { folderId: "fld_a", name: "Daily", path: "Daily", fileCount: 3, folderCount: 0, scope: "personal", label: 1, git: false, reviewChanges: false },
    { folderId: "fld_b", parentId: "fld_a", name: "Sales", path: "Sales", fileCount: 1, folderCount: 0, scope: "space", label: 1, git: false, reviewChanges: false },
  ] } as never);
  assert.deepEqual(nodes.map((n) => [n.id, n.parentId, n.section, n.via]), [["fld_a", null, "personal", "owner"], ["fld_b", "fld_a", "space", "space"]]);
});

test("a name is looked up from the Space's people, then yourself, else the id", () => {
  const rt = runtimeOver(createSampleFiles());
  const name = nameLookup(rt);
  assert.equal(name("usr_maya"), "Maya Chen");
  assert.equal(name("usr_irfad"), "Irfad Imtiaz");
  assert.equal(name("usr_zed"), "usr_zed");
});

test("opening a record or a file goes through the shell's door", () => {
  const opened: unknown[] = [];
  const rt = runtimeOver(createSampleFiles(), opened);
  rt.open({ screen: "files.viewer", args: { fileId: "fil_1" } });
  assert.deepEqual(opened, [{ screen: "files.viewer", args: { fileId: "fil_1" } }]);
});
