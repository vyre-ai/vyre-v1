// Screen test for files.list and files.tree (spec 2.4, 3.5, ARCH 7.5).
// Loaded by scripts/test-run.mjs via node --test.

import test from "node:test";
import assert from "node:assert/strict";
import { createFakeReplica, type Row } from "../../../client/src/index.ts";
import { applyMove, bindFilesList } from "../src/places/files/list/bind.ts";
import {
  FilesList,
  applyMove as applyMoveFromIndex,
} from "../src/places/files/list/index.ts";
import {
  FILES_LIST_SHOTS,
  densityFor,
  placeFrame,
  renderFilesList,
} from "../src/places/files/list/render.ts";
import { FilesList as FilesListScreen } from "../src/places/files/list/session.ts";
import { ROW_HEIGHT, SCROLL_FRAME_MS, SPRING_LOAD_MS } from "../src/places/files/list/types.ts";
import { FilesTree as FilesTreeFromIndex } from "../src/places/files/tree/index.ts";
import { FilesTree, bindFilesTree } from "../src/places/files/tree/tree.ts";

function folder(partial: {
  id: string;
  name: string;
  section?: "personal" | "shared" | "space";
  via?: "owner" | "grant" | "folder" | "space";
  scope?: "personal" | "space";
  parentId?: string;
  fileCount?: number;
  deletedAt?: number;
}): Row {
  const row: Row = {
    id: partial.id,
    folderId: partial.id,
    name: partial.name,
    path: partial.name,
    fileCount: partial.fileCount ?? 0,
    folderCount: 0,
    scope: partial.scope ?? (partial.section === "space" ? "space" : "personal"),
    section: partial.section ?? "personal",
    via: partial.via ?? "owner",
    label: 0,
    git: false,
    reviewChanges: false,
  };
  if (partial.parentId) row.parentId = partial.parentId;
  if (partial.deletedAt !== undefined) row.deletedAt = partial.deletedAt;
  return row;
}

function file(partial: {
  id: string;
  name: string;
  folderId: string;
  section?: "personal" | "shared" | "space";
  via?: "owner" | "grant" | "folder" | "space";
  kind?: string;
  mime?: string;
  updatedAt?: number;
  deletedAt?: number;
  size?: number;
}): Row {
  const row: Row = {
    id: partial.id,
    fileId: partial.id,
    folderId: partial.folderId,
    name: partial.name,
    kind: partial.kind ?? "markdown",
    mime: partial.mime ?? "text/markdown",
    size: partial.size ?? 12,
    version: 1,
    label: 0,
    ownerId: "usr_me",
    createdAt: 1,
    updatedAt: partial.updatedAt ?? 1,
    updatedBy: "usr_me",
    thumb: false,
    holds: 0,
    section: partial.section ?? "personal",
    via: partial.via ?? "owner",
  };
  if (partial.deletedAt !== undefined) row.deletedAt = partial.deletedAt;
  return row;
}

function seed(spaceId: string, folders: Row[], files: Row[]) {
  const replica = createFakeReplica(spaceId);
  if (folders.length) replica.put("folders", folders);
  if (files.length) replica.put("files", files);
  return replica;
}

test("barrels re-export the list and tree screens", () => {
  assert.equal(FilesList, FilesListScreen);
  assert.equal(applyMoveFromIndex, applyMove);
  assert.equal(FilesTreeFromIndex, FilesTree);
  assert.equal(ROW_HEIGHT, 44);
  assert.equal(SPRING_LOAD_MS, 500);
  assert.equal(SCROLL_FRAME_MS, 16.7);
});

test("drag into a folder spring-loads it and the drop moves the file", () => {
  const replica = seed("spc_drag", [
    folder({ id: "fld_notes", name: "Notes" }),
    folder({ id: "fld_clients", name: "Clients", section: "shared", via: "grant" }),
  ], [
    file({ id: "fil_plan", name: "plan.md", folderId: "fld_notes" }),
  ]);
  const seen: { cap: string }[] = [];
  const list = new FilesList({
    replica,
    view: { mode: "folder" },
    invoke: (call) => seen.push(call),
  });
  const before = list.html();
  assert.match(before, /data-screen="files.list"/);
  assert.match(before, /data-id="fil_plan"/);
  assert.match(before, /data-id="fld_clients"/);
  list.select("fil_plan");
  list.dragStart();
  list.dragOver("fld_clients", 5_000);
  assert.match(list.html(), /data-id="fld_clients"[\s\S]{0,220}data-spring="arming"/);
  list.tick(5_000 + SPRING_LOAD_MS - 1);
  assert.match(list.html(), /data-id="fld_clients"[\s\S]{0,220}data-spring="arming"/);
  assert.equal(replica.rows("files")[0]?.folderId, "fld_notes");
  list.tick(5_000 + SPRING_LOAD_MS);
  const opened = list.html();
  assert.match(opened, /data-folder="fld_clients"/);
  assert.match(opened, /data-section="shared"/);
  assert.equal(opened.includes("fil_plan"), false);
  list.drop("fld_clients");
  const dropped = list.html();
  assert.match(dropped, /data-entry="file" data-id="fil_plan" data-via="folder"/);
  const row = replica.rows("files")[0];
  assert.equal(row?.folderId, "fld_clients");
  assert.equal(row?.section, "shared");
  assert.equal(row?.via, "folder");
  assert.deepEqual(list.calls, [{
    cap: "files.move",
    input: { fileId: "fil_plan", toFolderId: "fld_clients" },
  }]);
  assert.equal(seen.length, 1);
  list.setView({ mode: "shared" });
  const shared = list.html();
  assert.match(shared, /data-title="Shared with me"/);
  assert.match(shared, /data-entry="file" data-id="fil_plan" data-via="folder"/);
});

test("Shared with me lists granted items and hides files you own", () => {
  const replica = seed("spc_shared", [
    folder({ id: "fld_notes", name: "Notes" }),
    folder({ id: "fld_clients", name: "Clients", section: "shared", via: "grant" }),
    folder({ id: "fld_projects", name: "Projects", fileCount: 1 }),
  ], [
    file({ id: "fil_plan", name: "plan.md", folderId: "fld_notes", updatedAt: 10 }),
    file({
      id: "fil_brief",
      name: "brief.pdf",
      folderId: "fld_clients",
      section: "shared",
      via: "grant",
      kind: "pdf",
      mime: "application/pdf",
      updatedAt: 30,
    }),
    file({ id: "fil_old", name: "old.txt", folderId: "fld_notes", kind: "text", deletedAt: 5, updatedAt: 40 }),
  ]);
  bindFilesList(replica);
  bindFilesTree(replica);
  const list = new FilesList({ replica });
  const tree = new FilesTree({ replica });
  list.setView(tree.select("shared"));
  const shared = list.html();
  assert.match(shared, /data-mode="shared"/);
  assert.match(shared, /data-title="Shared with me"/);
  assert.match(shared, /data-entry="folder" data-id="fld_clients" data-via="grant"/);
  assert.match(shared, /data-entry="file" data-id="fil_brief" data-via="grant"/);
  assert.equal(shared.includes("plan.md"), false);
  assert.equal(shared.includes("old.txt"), false);
  assert.equal(shared.includes("fld_notes"), false);
  assert.equal(shared.includes("fld_projects"), false);

  list.setView(tree.select("recent"));
  const recent = list.html();
  assert.match(recent, /data-title="Recent"/);
  const recentIds = [...recent.matchAll(/data-entry="file" data-id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(recentIds, ["fil_brief", "fil_plan"]);

  list.setView(tree.select("trash"));
  const trash = list.html();
  assert.match(trash, /data-mode="trash"/);
  assert.match(trash, /data-title="Trash"/);
  assert.match(trash, /old\.txt/);
  assert.equal(trash.includes("plan.md"), false);
  assert.equal(trash.includes("brief.pdf"), false);

  list.setView(tree.select("memory"));
  assert.match(list.html(), /data-title="Memory"/);
  assert.match(list.html(), /No files yet/);
  list.setView(tree.select("graph"));
  assert.match(list.html(), /data-mode="knowledge"/);
  assert.match(list.html(), /data-title="Graph"/);

  const nav = tree.html();
  assert.match(nav, /data-screen="files.tree"/);
  assert.match(nav, /data-root="recent" data-kind="virtual" data-title="Recent" data-count="2"/);
  assert.match(nav, /data-root="shared" data-kind="virtual" data-title="Shared with me" data-count="1"/);
  assert.match(nav, /data-root="trash" data-kind="virtual" data-title="Trash" data-count="1"/);
  assert.match(nav, /data-group="Knowledge"/);
  assert.match(nav, /data-root="memory"/);
  assert.match(nav, /data-root="graph"/);
  assert.match(nav, /data-root="projects"[\s\S]{0,180}data-folder="fld_projects"/);
  assert.match(nav, /data-root="agents" data-kind="virtual"/);
  assert.deepEqual(tree.select("projects"), { mode: "folder", folderId: "fld_projects", section: "personal" });

  tree.dragOver("fld_projects", 2_000);
  assert.match(tree.html(), /data-root="projects"[\s\S]{0,180}data-spring="arming"/);
  tree.tick(2_000 + SPRING_LOAD_MS - 1);
  assert.match(tree.html(), /data-root="projects"[\s\S]{0,180}data-spring="arming"/);
  tree.tick(2_000 + SPRING_LOAD_MS);
  assert.match(tree.html(), /data-open="fld_projects"/);
  assert.match(tree.html(), /data-root="projects"[\s\S]{0,180}data-spring="open"/);
  assert.equal(tree.receiveDrop("fil_plan", "fld_projects"), true);
  assert.equal(tree.receiveDrop("missing", "fld_projects"), false);
  assert.deepEqual(tree.calls, [{
    cap: "files.move",
    input: { fileId: "fil_plan", toFolderId: "fld_projects" },
  }]);
  const moved = replica.rows("files").find((row) => row.id === "fil_plan");
  assert.equal(moved?.folderId, "fld_projects");
  assert.equal(moved?.section, "personal");
  assert.equal(moved?.via, "owner");
});

test("moving into a shared folder shares the file", () => {
  const replica = seed("spc_rules", [
    folder({ id: "fld_notes", name: "Notes" }),
    folder({ id: "fld_clients", name: "Clients", section: "shared", via: "grant" }),
    folder({ id: "fld_space", name: "Workspace", section: "space", via: "space", scope: "space" }),
  ], [
    file({ id: "fil_plan", name: "plan.md", folderId: "fld_notes" }),
  ]);
  assert.equal(applyMove(replica, "fil_plan", "fld_notes"), false);
  assert.equal(applyMove(replica, "missing", "fld_clients"), false);
  assert.equal(applyMove(replica, "fil_plan", "fld_clients"), true);
  let row = replica.rows("files").find((item) => item.id === "fil_plan");
  assert.equal(row?.folderId, "fld_clients");
  assert.equal(row?.section, "shared");
  assert.equal(row?.via, "folder");
  assert.equal(applyMove(replica, "fil_plan", "fld_space"), true);
  row = replica.rows("files").find((item) => item.id === "fil_plan");
  assert.equal(row?.section, "space");
  assert.equal(row?.via, "space");
  assert.equal(applyMove(replica, "fil_plan", "fld_notes"), true);
  row = replica.rows("files").find((item) => item.id === "fil_plan");
  assert.equal(row?.folderId, "fld_notes");
  assert.equal(row?.section, "personal");
  assert.equal(row?.via, "owner");
});

test("shift extends the selection, meta toggles a row, and hover prefetches the viewer", () => {
  const prefetched: { screenId: string; args: Record<string, unknown> }[] = [];
  const replica = seed("spc_sel", [
    folder({ id: "fld_notes", name: "Notes" }),
  ], [
    file({ id: "fil_a", name: "a.md", folderId: "fld_notes" }),
    file({ id: "fil_b", name: "b.md", folderId: "fld_notes" }),
    file({ id: "fil_c", name: "c.md", folderId: "fld_notes" }),
  ]);
  const list = new FilesList({
    replica,
    view: { mode: "folder", folderId: "fld_notes" },
    prefetch: (screenId, args) => prefetched.push({ screenId, args }),
  });
  list.select("fil_a");
  list.select("fil_c", { shift: true });
  assert.equal(list.html().match(/data-selected="true"/g)?.length, 3);
  list.select("fil_b");
  list.select("fil_c", { meta: true });
  assert.equal(list.html().match(/data-selected="true"/g)?.length, 2);
  list.select("fil_b", { meta: true });
  const html = list.html();
  assert.equal(html.match(/data-selected="true"/g)?.length, 1);
  assert.match(html, /data-id="fil_c"[\s\S]{0,240}data-selected="true"/);
  assert.match(html, /data-id="fil_b"[\s\S]{0,240}data-selected="false"/);
  list.hover("fil_c");
  assert.deepEqual(prefetched, [{ screenId: "files.viewer", args: { fileId: "fil_c" } }]);
  assert.match(list.html(), /data-id="fil_c"[\s\S]{0,240}data-hovered="true"/);
  list.hover(null);
  assert.equal(prefetched.length, 1);
});

test("space toggles Quick Look and a folder share goes through the share sheet", () => {
  const replica = seed("spc_look", [
    folder({ id: "fld_clients", name: "Clients", section: "shared", via: "grant" }),
  ], [
    file({
      id: "fil_plan",
      name: "plan.md",
      folderId: "fld_clients",
      section: "shared",
      via: "folder",
      size: 12,
    }),
  ]);
  const list = new FilesList({ replica, view: { mode: "shared" }, width: 1280 });
  list.select("fil_plan");
  list.key(" ");
  const look = list.html();
  assert.match(look, /data-quick-look="fil_plan"/);
  assert.match(look, /data-name="plan.md"/);
  assert.match(look, /data-kind="markdown"/);
  assert.match(look, /data-size="12"/);
  assert.match(look, /data-mime="text\/markdown"/);
  assert.match(look, /Preview from the local copy/);
  list.key(" ");
  assert.equal(list.html().includes("data-quick-look"), false);
  list.quickLook("fil_plan");
  assert.match(list.html(), /data-quick-look="fil_plan"/);
  list.key("Escape");
  assert.equal(list.html().includes("data-quick-look"), false);

  list.openMenu("fil_plan");
  const menu = list.html();
  assert.match(menu, /Quick Look/);
  assert.match(menu, /Share/);
  assert.match(menu, /Report a problem/);
  list.key("Escape");
  assert.equal(list.html().includes('role="menu"'), false);

  list.confirmShare({ kind: "person", id: "prs_omar" }, "edit");
  assert.equal(list.calls.length, 0);
  list.openShare({ kind: "folder", id: "fld_clients" });
  const share = list.html();
  assert.match(share, /data-share-target="folder"/);
  assert.match(share, /data-resource-id="fld_clients"/);
  assert.match(share, /data-resource-name="Clients"/);
  assert.match(share, /data-density="regular"/);
  list.confirmShare({ kind: "person", id: "prs_omar" }, "edit");
  assert.deepEqual(list.calls[0], {
    cap: "access.share",
    input: {
      resource: { type: "folder", id: "fld_clients" },
      subject: { kind: "person", id: "prs_omar" },
      level: "edit",
    },
  });
  assert.equal(list.html().includes("data-share-target"), false);
  list.setFrame({ width: 390 });
  list.openShare({ kind: "file", id: "fil_plan" });
  assert.match(list.html(), /data-share-target="item"/);
  assert.match(list.html(), /data-density="compact"/);
  list.confirmShare({ kind: "person", id: "prs_omar" }, "view");
  assert.deepEqual(list.calls[1], {
    cap: "files.share",
    input: {
      fileId: "fil_plan",
      subject: { kind: "person", id: "prs_omar" },
      level: "view",
    },
  });
});

test("both skins paint the files list at 1280 and 390", () => {
  const replica = seed("spc_skin", [
    folder({ id: "fld_notes", name: "Notes" }),
  ], [
    file({ id: "fil_plan", name: "plan.md", folderId: "fld_notes" }),
  ]);
  const list = new FilesList({ replica, view: { mode: "folder" } });
  const tree = new FilesTree({ replica });
  for (const shot of FILES_LIST_SHOTS) {
    list.setFrame(shot);
    tree.setFrame(shot);
    const html = list.html();
    const density = densityFor(shot.width);
    assert.equal(density, shot.width < 800 ? "compact" : "regular");
    assert.match(html, new RegExp(`data-space="${shot.spaceName}"`));
    assert.match(html, new RegExp(`data-skin="${shot.skinId}"`));
    assert.match(html, new RegExp(`data-width="${shot.width}"`));
    assert.match(html, new RegExp(`data-density="${density}"`));
    const accent = shot.skinId === "paper" ? "#5B5BD6" : "#3E6FD8";
    assert.match(html, new RegExp(`data-accent="${accent}"`));
    const frame = placeFrame(html, tree.html(), shot);
    assert.match(frame, /data-place="files"/);
    assert.match(frame, /data-shot="files.list"/);
    assert.match(frame, /data-screen="files.list"/);
    assert.match(frame, /data-screen="files.tree"/);
  }
  const empty = renderFilesList({
    spaceName: "Northwind",
    skinId: "paper",
    width: 1280,
    viewport: 800,
    scrollTop: 0,
    mode: "shared",
    section: "shared",
    title: "Shared with me",
    link: "ready",
    entries: [],
    selected: [],
    hovered: null,
    springFolderId: null,
    spring: "idle",
    quickLook: null,
    share: null,
    menuFor: null,
  });
  assert.match(empty, /Nothing shared with you/);
  list.setLink("offline");
  assert.match(list.html(), /Offline, showing your saved copy/);
  list.setLink("error");
  assert.match(list.html(), /Could not load this/);
});

test("scrolling 10000 files paints a window inside the scroll budget", () => {
  const files: Row[] = [];
  for (let i = 0; i < 10_000; i++) {
    const n = String(i).padStart(5, "0");
    files.push(file({
      id: `fil_${n}`,
      name: `f${n}.txt`,
      folderId: "fld_bulk",
      kind: "text",
      mime: "text/plain",
      updatedAt: i,
    }));
  }
  const replica = seed("spc_scroll", [
    folder({ id: "fld_bulk", name: "Bulk", fileCount: 10_000 }),
  ], files);
  const list = new FilesList({
    replica,
    view: { mode: "folder", folderId: "fld_bulk" },
    viewport: 800,
  });
  list.html();
  list.setScroll(ROW_HEIGHT * 4000);
  const frame = list.html();
  assert.match(frame, /data-total="10000"/);
  assert.match(frame, /data-row-height="44"/);
  assert.match(frame, /data-window-start="3998"/);
  assert.match(frame, /data-window-end="4021"/);
  assert.match(frame, /data-id="fil_03998"/);
  assert.equal(frame.includes("fil_00000"), false);
  assert.equal(frame.includes("fil_09999"), false);
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    list.setScroll(ROW_HEIGHT * (1000 + i * 100));
    const started = performance.now();
    list.html();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[18] ?? samples[samples.length - 1] ?? 0;
  assert.ok(p95 < SCROLL_FRAME_MS, `scroll p95 ${p95.toFixed(2)} ms, budget ${SCROLL_FRAME_MS} ms`);
});
