// The Records and Files places over the Space's runtime: the sidebar, tree and views draw real rows from the Space, and without a runtime each draws its loading frames.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { liveQuery } from "../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../client/src/index.ts";
import { createSampleFiles } from "../../places/files/list/sample.ts";
import { createViewsSample } from "../../places/records/views-a/sample.ts";
import { createSampleSchema } from "../../places/records/schemamap/sample.ts";
import FilesPlace from "./files.tsx";
import { folderNodes } from "./files-data.ts";
import { RecordsDataProvider, RecordsSidebarSlot, RecordsStateProvider } from "../../places/records/sidebar/index.ts";
import { SidebarContent } from "../sidebar/index.ts";
import type { SidebarSlotApi } from "../sidebar/index.ts";
import RecordsPlace from "./records.tsx";
import { recordsData } from "./records-data.ts";
import { nameLookup } from "./records-live.ts";
import { PlaceHashProvider } from "../hash/context.tsx";
import { resolveRecordType } from "./record-detail.tsx";
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

test("a name is looked up from the Space's people, then yourself, else a plain word and never the id", () => {
  const rt = runtimeOver(createSampleFiles());
  const name = nameLookup(rt);
  assert.equal(name("usr_maya"), "Maya Chen");
  assert.equal(name("usr_irfad"), "Irfad Imtiaz");
  assert.equal(name("usr_zed"), "Someone");
  assert.equal(name("svc_host"), "Vyre", "the server itself reads as Vyre");
  assert.equal(name("agt_gone"), "An agent");
});

test("opening a record or a file goes through the shell's door", () => {
  const opened: unknown[] = [];
  const rt = runtimeOver(createSampleFiles(), opened);
  rt.open({ screen: "files.viewer", args: { fileId: "fil_1" } });
  assert.deepEqual(opened, [{ screen: "files.viewer", args: { fileId: "fil_1" } }]);
});


test("an incoming file hash mounts its viewer instead of leaving the list open", () => {
  const rt = runtimeOver(createSampleFiles());
  const out = html(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash="screen=files.viewer&fileId=fil_1" opened={() => undefined}><FilesPlace place="files" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.match(out, /file-viewer-loading/);
  assert.doesNotMatch(out, /data-testid="files-list"/);
});

test("an incoming record hash opens a detail route instead of drawing the table", () => {
  const rt = runtimeOver(createViewsSample());
  const out = html(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash="subject=record:rec_1&type=contact" opened={() => undefined}><RecordsPlace place="records" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.match(out, /Opening record/);
  assert.doesNotMatch(out, /data-testid="records-table"/);
});

test("record type lookup validates hints and supports old links without leaking forbidden records", async () => {
  const calls: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push(cap);
    if (cap === "schema.types.list") return { types: [{ key: "hidden" }, { key: "contact" }] };
    if ((input as { type: string }).type === "hidden") throw { code: "access.denied" };
    return { record: { id: "rec_1" } };
  };
  assert.equal(await resolveRecordType(call as ShellRuntime["call"], "rec_1"), "contact");
  assert.deepEqual(calls, ["schema.types.list", "records.get", "records.get"]);
  assert.equal(await resolveRecordType(call as ShellRuntime["call"], "rec_1", "contact"), "contact");
  await assert.rejects(resolveRecordType(call as ShellRuntime["call"], "rec_1", "hidden"));
});

test("Calendar, Timeline, Map and Charts are views of the place: a link that names one opens it", () => {
  const rt = runtimeOver(createViewsSample());
  const draw = (kind: string): string => html(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash={`type=clients&kind=${kind}`} opened={() => undefined}><RecordsPlace place="records" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.ok(draw("calendar").includes('data-testid="records-calendar"'), "the Calendar view");
  assert.ok(!draw("table").includes('data-testid="records-calendar"'));
  for (const kind of ["timeline", "map", "charts"]) assert.ok(!draw(kind).includes('data-testid="records-table"'), `${kind} is not the table`);
});

function schemaRuntime(opened: unknown[] = []): ShellRuntime {
  const s = createSampleSchema();
  const base = runtimeOver(createViewsSample(), opened);
  return { ...base, screens: s.data.screens, call: s.data.call };
}

test("the Record types row writes its screen, and the screen mounts the read-only list of types", () => {
  const rt = schemaRuntime();
  const out = html(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash="screen=records.types" opened={() => undefined}><RecordsPlace place="records" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.ok(out.includes('data-testid="record-types"'), "the Record types list is the body");
  assert.ok(!out.includes('data-testid="records-table"'), "not the table");
});

test("the Schema map row writes its screen, and the screen mounts the map", () => {
  const rt = schemaRuntime();
  const out = html(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash="screen=records.schema-map" opened={() => undefined}><RecordsPlace place="records" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.ok(out.includes('data-testid="schema-map-place"'), "the Schema map is the body");
});

test("the sidebar marks the Manage row of the screen the body shows", () => {
  const rt = schemaRuntime();
  const el = RecordsSidebarSlot({}) as ReactElement<{ children: (q: string, slot: SidebarSlotApi) => ReactElement }>;
  const slot: SidebarSlotApi = { query: "", collapsed: false, setCollapsed: () => undefined, hasSidebar: true, compact: false, openBody: () => undefined, back: () => undefined, view: "body", title: "Records" };
  const side = (screen?: string): string => html(<RecordsDataProvider value={recordsData(rt, screen)}><RecordsStateProvider>{el.props.children("", slot)}</RecordsStateProvider></RecordsDataProvider>);
  assert.ok(side().includes("Record types") && side().includes("Schema map"), "both rows are listed under Manage");
  assert.notEqual(side("records.types"), side(), "the Record types row is marked when its screen is open");
  assert.notEqual(side("records.schema-map"), side(), "the Schema map row is marked when its screen is open");
  assert.notEqual(side("records.schema-map"), side("records.types"), "each screen marks its own row");
});
