// Screen test for the Records table and sidebar.
// table100k: open and scroll the perf space (100,000 rows) through a window of 200.
// The total on screen is the cached count, not the page length.
// Node runs this file. The browser probe is the CI perf job.

import test from "node:test";
import assert from "node:assert/strict";
import { createFakeReplicaSet } from "../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../client/src/index.ts";
import { tokensOf } from "../../../ui/src/tokens/skins.ts";
import { renderSidebar } from "../src/places/records/sidebar/Sidebar.tsx";
import { isSiteScope, sidebarSections } from "../src/places/records/sidebar/model.ts";
import { createTableSession, renderTable, TABLE_SHOTS } from "../src/places/records/table/TableView.tsx";
import type { TableSession } from "../src/places/records/table/TableView.tsx";
import {
  COL_WIDTH_PX,
  ROW_HEIGHT_PX,
  ROW_WINDOW,
  TABLE_OPEN_BUDGET_MS,
  applySavedView,
  columnSpan,
  queryLimit,
  sortFromView,
  visibleRowCount,
} from "../src/places/records/table/window.ts";
import type { TableColumn } from "../src/places/records/table/window.ts";

/** Matches fixtures/seed/perf PERF_TARGET.records. The perf space is not imported (fixtures is outside the app layer). */
const PERF_RECORDS = 100_000;

const COLUMNS: readonly TableColumn[] = [
  { key: "name", title: "Name" },
  { key: "email", title: "Email" },
  { key: "phone", title: "Phone" },
  { key: "city", title: "City" },
  { key: "status", title: "Status" },
  { key: "owner", title: "Owner" },
  { key: "company", title: "Company" },
  { key: "source", title: "Source" },
  { key: "created", title: "Created" },
  { key: "updated", title: "Updated" },
  { key: "score", title: "Score" },
  { key: "notes", title: "Notes" },
];

interface QueryCall {
  limit: number;
  offset: number;
  fields: string[];
}

function recordRow(id: string, type: string, fields: Record<string, unknown>) {
  return { id, type, version: 1, label: 0, fields, createdAt: 0, updatedAt: 0, holds: 0 };
}

function installPerf(replica: FakeReplica, total = PERF_RECORDS): QueryCall[] {
  const calls: QueryCall[] = [];
  replica.resolve("records.counts", () => ({ count: total }));
  replica.resolve("records.query", (_tables, input) => {
    const limit = input.limit ?? 0;
    const offset = input.offset ?? 0;
    if (limit < 1 || limit > ROW_WINDOW) throw new Error(`limit ${limit} is outside the window of ${ROW_WINDOW}`);
    const fields = input.fields ? input.fields.slice() : [];
    calls.push({ limit, offset, fields });
    const n = Math.min(limit, Math.max(0, total - offset));
    const rows: ReturnType<typeof recordRow>[] = [];
    for (let i = 0; i < n; i++) {
      const index = offset + i;
      const fieldsOut: Record<string, unknown> = {};
      for (const key of fields) fieldsOut[key] = `${key}:${index}`;
      rows.push(recordRow(`rec_${index}`, input.type, fieldsOut));
    }
    return { rows, total: 7 };
  });
  return calls;
}

function perfSession(replica: FakeReplica, width = 1280, height = 720): TableSession {
  return createTableSession({
    replica,
    spaceId: "spc_perf",
    spaceName: "Perf",
    kit: "default",
    skinId: "paper",
    mode: "light",
    type: "contact",
    columns: COLUMNS,
    viewportWidth: width,
    viewportHeight: height,
  });
}

function sectionHtml(html: string, name: string): string {
  const token = `data-section="${name}"`;
  const start = html.indexOf(token);
  assert.ok(start >= 0, name);
  const next = html.indexOf("data-section=", start + token.length);
  return html.slice(start, next < 0 ? html.length : next);
}

test("the query window is 200 rows and columns follow the viewport", () => {
  assert.equal(queryLimit(undefined), ROW_WINDOW);
  assert.equal(queryLimit(5000), ROW_WINDOW);
  assert.equal(queryLimit(1), 1);
  assert.equal(ROW_WINDOW, 200);
  assert.equal(visibleRowCount(720), 20);
  assert.equal(visibleRowCount(360), 10);
  assert.equal(Math.floor(1280 / COL_WIDTH_PX), 8);
  assert.equal(Math.floor(390 / COL_WIDTH_PX), 2);
  assert.deepEqual(columnSpan(COLUMNS.length, 1280, 0), { start: 0, end: 8, fit: 8 });
  assert.deepEqual(columnSpan(COLUMNS.length, 390, 0), { start: 0, end: 2, fit: 2 });
  assert.deepEqual(columnSpan(COLUMNS.length, 1280, 4), { start: 4, end: 12, fit: 8 });
  assert.equal(ROW_HEIGHT_PX, 36);
  assert.equal(COL_WIDTH_PX, 160);
});

test("a saved view drops hidden fields before the column window", () => {
  const query = applySavedView(COLUMNS, {
    filter: { field: "status", op: "eq" },
    sort: [{ field: "name", dir: "asc" }],
    hidden: ["notes", "score"],
  });
  assert.equal(query.columns.some((column) => column.key === "notes"), false);
  assert.equal(query.columns.some((column) => column.key === "score"), false);
  assert.equal(query.columns.length, 10);
  assert.deepEqual(query.sort, [{ field: "name", dir: "asc" }]);
  assert.equal(sortFromView("name"), undefined);
  assert.equal(sortFromView([{ field: "name", dir: "sideways" }]), undefined);
});

test("table100k opens the perf space under 100 ms from a window of 200", () => {
  const replica = createFakeReplicaSet().open("spc_perf");
  const calls = installPerf(replica);
  const session = perfSession(replica);
  const rendered = renderTable(session);
  assert.ok(rendered.openMs < TABLE_OPEN_BUDGET_MS, `open ${rendered.openMs} ms`);
  assert.equal(rendered.frame.total, PERF_RECORDS);
  assert.equal(rendered.frame.countSource, "cached-count");
  assert.equal(rendered.frame.limit, ROW_WINDOW);
  assert.equal(rendered.frame.fetchedRows, ROW_WINDOW);
  assert.equal(rendered.frame.painted, 20);
  assert.equal(rendered.frame.rowsRead, ROW_WINDOW);
  assert.equal(rendered.frame.fetches, 1);
  assert.equal(rendered.frame.status, "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.limit, 200);
  assert.equal(calls[0]?.offset, 0);
  assert.deepEqual(calls[0]?.fields, ["name", "email", "phone", "city", "status", "owner", "company", "source"]);
  assert.equal(rendered.html.includes('data-total="100000"'), true);
  assert.equal(rendered.html.includes('data-count-source="cached-count"'), true);
  assert.equal(rendered.html.includes('data-total="7"'), false);
  assert.equal(rendered.html.includes('data-row-window="200"'), true);
  assert.equal(rendered.html.includes('data-painted="20"'), true);
  assert.equal(rendered.html.includes('data-paint-row="rec_0"'), true);
  assert.equal(rendered.html.includes('data-paint-row="rec_19"'), true);
  assert.equal(rendered.html.includes('data-paint-row="rec_20"'), false);
  assert.equal(rendered.html.includes('data-paint-row="rec_200"'), false);
  assert.equal(rendered.html.includes("rec_99999"), false);
  assert.equal(rendered.html.includes('data-placeholder="VirtualList"'), true);
  assert.equal(rendered.html.includes('data-placeholder="Row"'), true);
  assert.equal(rendered.html.includes('data-row-height="36"'), true);
  assert.equal(rendered.html.includes('data-col-width="160"'), true);
  assert.equal(rendered.html.includes('data-cell="notes"'), false);
  assert.ok(rendered.html.length < 30_000);
});

test("table100k scrolls inside the window, then jumps without reading the whole space", () => {
  const replica = createFakeReplicaSet().open("spc_perf");
  const calls = installPerf(replica);
  const session = perfSession(replica);
  renderTable(session);
  session.scrollRow = 10;
  const inside = renderTable(session);
  assert.equal(inside.frame.fetches, 1);
  assert.equal(inside.frame.rowsRead, ROW_WINDOW);
  assert.equal(inside.frame.offset, 0);
  assert.equal(inside.html.includes('data-paint-row="rec_10"'), true);
  assert.equal(inside.html.includes('data-paint-row="rec_29"'), true);
  assert.equal(inside.html.includes('data-paint-row="rec_0"'), false);
  assert.equal(inside.html.includes('data-paint-row="rec_30"'), false);
  assert.equal(calls.length, 1);

  session.scrollRow = 50_000;
  const jumped = renderTable(session);
  assert.ok(jumped.openMs < TABLE_OPEN_BUDGET_MS, `jump ${jumped.openMs} ms`);
  assert.equal(jumped.frame.fetches, 2);
  assert.equal(jumped.frame.rowsRead, ROW_WINDOW * 2);
  assert.equal(jumped.frame.offset, 50_000);
  assert.equal(jumped.frame.fetchedRows, ROW_WINDOW);
  assert.equal(jumped.frame.painted, 20);
  assert.equal(jumped.frame.total, PERF_RECORDS);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.offset, 50_000);
  assert.equal(calls[1]?.limit, 200);
  assert.equal(jumped.html.includes('data-paint-row="rec_50000"'), true);
  assert.equal(jumped.html.includes('data-paint-row="rec_50019"'), true);
  assert.equal(jumped.html.includes('data-paint-row="rec_0"'), false);
  assert.equal(jumped.html.includes('data-paint-row="rec_50020"'), false);
  assert.equal(jumped.html.includes("rec_99999"), false);
});

test("scroll through 10,000 perf rows stays on windows of 200", () => {
  const replica = createFakeReplicaSet().open("spc_perf");
  const calls = installPerf(replica);
  const session = perfSession(replica);
  const started = performance.now();
  let maxFrame = 0;
  for (let step = 0; step < 50; step++) {
    session.scrollRow = step * ROW_WINDOW;
    const rendered = renderTable(session);
    maxFrame = Math.max(maxFrame, rendered.openMs);
    assert.equal(rendered.frame.painted, 20);
    assert.equal(rendered.frame.fetchedRows, ROW_WINDOW);
    assert.equal(rendered.frame.total, PERF_RECORDS);
    assert.ok(rendered.html.length < 30_000);
  }
  const elapsed = performance.now() - started;
  assert.equal(calls.length, 50);
  assert.equal(session.rowsRead, 10_000);
  assert.equal(calls[49]?.offset, 49 * ROW_WINDOW);
  assert.ok(calls.every((call) => call.limit === ROW_WINDOW));
  assert.ok(maxFrame < TABLE_OPEN_BUDGET_MS, `frame ${maxFrame} ms`);
  assert.ok(elapsed < 2_000, `scroll ${elapsed} ms`);
  assert.ok(session.rowsRead < PERF_RECORDS);
});

test("column windowing requests only the visible fields", () => {
  const replica = createFakeReplicaSet().open("spc_perf");
  const calls = installPerf(replica);
  const wide = perfSession(replica, 1280, 720);
  const desktop = renderTable(wide);
  assert.deepEqual(desktop.frame.fields, COLUMNS.slice(0, 8).map((column) => column.key));
  assert.equal(desktop.html.includes('data-cell="notes"'), false);
  wide.scrollColumn = 4;
  const shifted = renderTable(wide);
  assert.equal(shifted.frame.fetches, 2);
  assert.deepEqual(shifted.frame.fields, COLUMNS.slice(4).map((column) => column.key));
  assert.equal(shifted.html.includes('data-cell="name"'), false);
  assert.equal(shifted.html.includes('data-cell="notes"'), true);
  assert.equal(calls[1]?.limit, 200);

  const narrow = perfSession(createFakeReplicaSet().open("spc_perf_phone"), 390, 360);
  installPerf(narrow.replica);
  const phone = renderTable(narrow);
  assert.deepEqual(phone.frame.fields, ["name", "email"]);
  assert.equal(phone.frame.painted, 10);
  assert.equal(phone.html.includes('data-viewport="390"'), true);
  assert.equal(phone.html.includes('data-cell="phone"'), false);
});

test("hidden saved-view fields are not part of the query", () => {
  const replica = createFakeReplicaSet().open("spc_perf");
  const calls = installPerf(replica);
  const view = applySavedView(COLUMNS, { hidden: ["notes", "email"], sort: [{ field: "name", dir: "asc" }] });
  const session = createTableSession({
    replica,
    spaceId: "spc_perf",
    spaceName: "Perf",
    kit: "default",
    skinId: "paper",
    mode: "light",
    type: "contact",
    columns: view.columns,
    viewportWidth: 390,
    viewportHeight: 360,
    ...(view.sort ? { sort: view.sort } : {}),
  });
  const rendered = renderTable(session);
  assert.deepEqual(rendered.frame.fields, ["name", "phone"]);
  assert.deepEqual(calls[0]?.fields, ["name", "phone"]);
  assert.equal(rendered.html.includes('data-cell="email"'), false);
  assert.equal(rendered.html.includes('data-cell="notes"'), false);
});

test("an empty type shows the empty state and does not query rows", () => {
  const replica = createFakeReplicaSet().open("spc_perf");
  let queries = 0;
  replica.resolve("records.counts", () => ({ count: 0 }));
  replica.resolve("records.query", () => {
    queries += 1;
    return { rows: [] };
  });
  const rendered = renderTable(perfSession(replica));
  assert.equal(queries, 0);
  assert.equal(rendered.frame.status, "empty");
  assert.equal(rendered.frame.total, 0);
  assert.equal(rendered.html.includes("No records yet"), true);
  assert.equal(rendered.html.includes('data-kind="empty"'), true);
});

test("offline and error states do not read the table", () => {
  const offlineReplica = createFakeReplicaSet().open("spc_off");
  let reads = 0;
  offlineReplica.resolve("records.counts", () => {
    reads += 1;
    return { count: PERF_RECORDS };
  });
  offlineReplica.resolve("records.query", () => {
    reads += 1;
    return { rows: [] };
  });
  const offline = renderTable({ ...perfSession(offlineReplica), offline: true });
  assert.equal(reads, 0);
  assert.equal(offline.frame.status, "offline");
  assert.equal(offline.html.includes('data-kind="offline"'), true);

  const errorReplica = createFakeReplicaSet().open("spc_err");
  errorReplica.resolve("records.counts", () => {
    throw new Error("counts failed");
  });
  const error = renderTable(perfSession(errorReplica));
  assert.equal(error.frame.status, "error");
  assert.equal(error.html.includes("Could not open the table"), true);
  assert.equal(error.html.includes('data-kind="error"'), true);
});

test("sidebar groups types, keeps site tables in Sites, and lists only membership rows", () => {
  assert.equal(isSiteScope("sit_harbor"), true);
  assert.equal(isSiteScope("space"), false);
  assert.equal(isSiteScope(undefined), false);
  const grouped = sidebarSections(
    [
      { key: "commission", title: "Commission", group: "Studio", scope: "sit_harbor", section: "space" },
      { key: "project", title: "Project", group: "Work", section: "space" },
      { key: "contact", title: "Contact", group: "People", section: "space" },
      { key: "note_board", title: "Note board", group: "Notes", section: "personal" },
    ],
    [{ id: "prj_north", title: "Northwind site", kind: "project", section: "space" }],
  );
  assert.deepEqual(grouped.map((section) => section.name), ["Personal", "Shared with me", "Space"]);
  assert.deepEqual(grouped[2]?.rows.map((row) => row.id), ["type:contact", "project:prj_north", "type:commission"]);
  assert.equal(grouped[2]?.rows[2]?.note, "Sites");
  assert.equal(grouped[0]?.rows[0]?.id, "type:note_board");

  const replica = createFakeReplicaSet().open("spc_northwind");
  const types = [
    storedType("contact", "Contact", "People", "space"),
    storedType("company", "Company", "People", "space", "space"),
    storedType("commission", "Commission", "Studio", "space", "sit_harbor"),
    storedType("project", "Project", "Work", "space"),
    storedType("intake_journey", "Intake journey", "Journeys", "space"),
    storedType("note_board", "Note board", "Notes", "personal"),
  ];
  replica.resolve("schema.types.list", (tables, input) => {
    const rows = [...(tables.get("record_types")?.values() ?? [])];
    const listed: ReturnType<typeof summaryOf>[] = [];
    for (const row of rows) {
      const stored = readStored(row);
      if (!stored) continue;
      if (input.section && stored.section !== input.section) continue;
      listed.push(summaryOf(stored));
    }
    return { types: listed };
  });
  replica.put("record_types", types);

  let projectMine: boolean | undefined;
  replica.resolve("projects.list", (_tables, input) => {
    projectMine = input.mine;
    return {
      projects: [{
        projectId: "prj_north",
        recordId: "rec_north",
        type: "project",
        title: "Northwind site",
        status: "active",
        channelId: "chn_north",
        folderId: "fld_north",
        memberCount: 2,
        openTasks: 1,
        lateTasks: 0,
      }],
    };
  });
  replica.resolve("journeys.list", () => ({
    journeys: [{
      id: "jrn_intake",
      name: "Intake",
      subjectType: "contact",
      recordType: "intake_journey",
      version: 1,
      stages: 3,
      inFlight: 1,
      updatedAt: 0,
    }],
  }));
  replica.resolve("agents.list", (_tables, input) => {
    const all = [
      agent("agt_assistant", "Assistant", "personal"),
      agent("agt_intake", "Intake", "space"),
    ];
    const agents: ReturnType<typeof agent>["out"][] = [];
    for (const row of all) {
      if (input.section && row.section !== input.section) continue;
      agents.push(row.out);
    }
    return { agents };
  });
  replica.resolve("views.list", (_tables, input) => ({
    views: input.type === "contact" ? [{
      viewId: "viw_open",
      type: "contact",
      kind: "table",
      title: "Open contacts",
      shared: false,
      ownerId: "usr_irfad",
      updatedAt: 0,
    }] : [],
  }));

  const html = renderSidebar(replica, { type: "contact" });
  assert.equal(html.includes('data-placeholder="ListSections"'), true);
  assert.equal(html.includes('data-type="records"'), true);
  assert.equal(projectMine, true);
  const personal = sectionHtml(html, "Personal");
  const shared = sectionHtml(html, "Shared with me");
  const space = sectionHtml(html, "Space");
  assert.equal(personal.includes('data-id="type:note_board"'), true);
  assert.equal(personal.includes('data-id="agent:agt_assistant"'), true);
  assert.equal(personal.includes("Commission"), false);
  assert.equal(shared.includes('data-count="0"'), true);
  assert.equal(space.includes('data-id="type:contact"'), true);
  assert.equal(space.includes('data-id="type:company"'), true);
  assert.equal(space.includes('data-id="type:commission"'), true);
  assert.match(space, /data-id="type:commission"[\s\S]{0,180}data-note>Sites</);
  assert.equal(space.includes("Studio"), false);
  assert.equal(html.includes('data-id="type:project"'), false);
  assert.equal(html.includes('data-id="type:intake_journey"'), false);
  assert.equal(space.includes('data-id="project:prj_north"'), true);
  assert.equal(space.includes('data-id="journey:jrn_intake"'), true);
  assert.equal(space.includes('data-id="agent:agt_intake"'), true);
  assert.equal(html.includes('data-id="agent:agt_billing"'), false);
  assert.equal(html.includes('data-id="viw_open"'), true);
  assert.equal(html.includes("Open contacts"), true);
  assert.equal(html.includes('data-saved-views'), true);
  assert.equal(html.includes('data-screen="records.types"'), true);
  assert.equal(html.includes('data-screen="records.schema-map"'), true);
  assert.equal(html.includes('data-flow="console"'), true);
  assert.equal(html.includes("Sync from an app"), true);
  assert.equal(html.includes('data-readonly="true"'), true);
});

test("shots render the table in Northwind and Harbor Studio at 1280 and 390", () => {
  const paper = tokensOf("paper", "light");
  const mist = tokensOf("mist", "light");
  assert.ok(paper);
  assert.ok(mist);
  assert.notEqual(paper["--accent"], mist["--accent"]);
  assert.deepEqual(TABLE_SHOTS.map((shot) => shot.width), [1280, 390, 1280, 390]);
  const seen = new Set<string>();
  for (const shot of TABLE_SHOTS) {
    const replica = createFakeReplicaSet().open(shot.spaceId);
    installPerf(replica, 3);
    const session = createTableSession({
      replica,
      spaceId: shot.spaceId,
      spaceName: shot.spaceName,
      kit: shot.kit,
      skinId: shot.skinId,
      mode: shot.mode,
      type: "contact",
      columns: COLUMNS,
      viewportWidth: shot.width,
      viewportHeight: shot.height,
    });
    const rendered = renderTable(session);
    const key = `${shot.spaceName}:${shot.width}`;
    seen.add(key);
    assert.equal(rendered.html.includes(`data-space="${shot.spaceName}"`), true);
    assert.equal(rendered.html.includes(`data-kit="${shot.kit}"`), true);
    assert.equal(rendered.html.includes(`data-skin="${shot.skinId}"`), true);
    assert.equal(rendered.html.includes(`data-viewport="${shot.width}"`), true);
    assert.equal(rendered.html.includes(`width:${shot.width}px`), true);
    const accent = shot.skinId === "paper" ? paper["--accent"] : mist["--accent"];
    assert.equal(rendered.html.includes(`--accent:${accent}`), true);
    if (shot.width === 1280) assert.equal(rendered.frame.fields.length, 8);
    if (shot.width === 390) assert.equal(rendered.frame.fields.length, 2);
    assert.equal(rendered.frame.fetchedRows, 3);
    assert.ok(rendered.frame.painted <= visibleRowCount(shot.height));
    assert.ok(rendered.openMs < TABLE_OPEN_BUDGET_MS);
  }
  assert.equal(seen.size, 4);
});

interface StoredType {
  id: string;
  key: string;
  title: string;
  plural: string;
  icon: string;
  label: "public" | "internal" | "confidential" | "restricted";
  system: boolean;
  rowCount: number;
  fieldCount: number;
  section: "personal" | "shared" | "space";
  group?: string;
  scope?: string;
}

function storedType(
  key: string,
  title: string,
  group: string,
  section: StoredType["section"],
  scope?: string,
): Row {
  const row: Row = {
    id: key,
    key,
    title,
    plural: title,
    icon: "dot",
    label: "internal",
    system: false,
    rowCount: 1,
    fieldCount: 1,
    section,
    group,
  };
  if (scope !== undefined) row.scope = scope;
  return row;
}

function isLabel(value: unknown): value is StoredType["label"] {
  return value === "public" || value === "internal" || value === "confidential" || value === "restricted";
}

function readStored(row: Row): StoredType | null {
  const section = row.section;
  if (section !== "personal" && section !== "shared" && section !== "space") return null;
  if (typeof row.key !== "string" || typeof row.title !== "string") return null;
  const stored: StoredType = {
    id: row.id,
    key: row.key,
    title: row.title,
    plural: typeof row.plural === "string" ? row.plural : row.title,
    icon: typeof row.icon === "string" ? row.icon : "dot",
    label: isLabel(row.label) ? row.label : "internal",
    system: row.system === true,
    rowCount: typeof row.rowCount === "number" ? row.rowCount : 0,
    fieldCount: typeof row.fieldCount === "number" ? row.fieldCount : 0,
    section,
  };
  if (typeof row.group === "string") stored.group = row.group;
  if (typeof row.scope === "string") stored.scope = row.scope;
  return stored;
}

function summaryOf(row: StoredType) {
  const type: {
    key: string;
    title: string;
    plural: string;
    icon: string;
    label: StoredType["label"];
    system: boolean;
    rowCount: number;
    fieldCount: number;
    group?: string;
    scope?: string;
  } = {
    key: row.key,
    title: row.title,
    plural: row.plural,
    icon: row.icon,
    label: row.label,
    system: row.system,
    rowCount: row.rowCount,
    fieldCount: row.fieldCount,
  };
  if (row.group !== undefined) type.group = row.group;
  if (row.scope !== undefined) type.scope = row.scope;
  return type;
}

function agent(agentId: string, name: string, section: "personal" | "shared" | "space") {
  return {
    section,
    out: {
      agentId,
      name,
      face: "dot",
      status: "asleep" as const,
      ownerId: "usr_irfad",
      folderId: "fld_agents",
      accountPolicy: "asker" as const,
      toolsAllowed: [] as string[],
      toolsDenied: [] as string[],
      vaultKeys: [] as string[],
      limits: {},
      captureMode: "propose" as const,
      hasComputer: false,
      templateVersion: 1,
      createdAt: 0,
    },
  };
}
