// ui/FolderTree: Personal, Shared with me, Space; nesting, counts, keyboard, the folder menu (spec 2.4, 4.9).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { menuEntries } from "../Menu/index.tsx";
import { isItem, isReportItem, isSeparator } from "../Menu/props.ts";
import { FOLDER_SECTIONS, FolderTree, SlotRow, canManageFolder, folderMenu, frozenFolderTreeProps, moveCursor, visibleSections } from "./index.tsx";
import type { FolderNode } from "./index.tsx";

const node = (over: Partial<FolderNode> & Pick<FolderNode, "id" | "name">): FolderNode => ({ parentId: null, count: 0, scope: "space", section: "space", via: "space", open: false, ...over });
const nodes: FolderNode[] = [
  node({ id: "p1", name: "Drafts", scope: "personal", section: "personal", via: "owner", open: true, count: 1 }),
  node({ id: "p2", name: "Ideas", parentId: "p1", scope: "personal", section: "personal", via: "owner" }),
  node({ id: "s1", name: "Clients", open: true, count: 3 }),
  node({ id: "s2", name: "Acme", parentId: "s1", count: 2 }),
  node({ id: "s3", name: "Beta", parentId: "s2" }),
  node({ id: "g1", name: "From Omar", section: "shared", via: "grant", count: 4 }),
];

test("the sections are Personal, Shared with me, Space, in that order, and always present", () => {
  assert.deepEqual(FOLDER_SECTIONS.map((s) => s.label), ["Personal", "Shared with me", "Space"]);
  const empty = visibleSections([]);
  assert.deepEqual(empty.map((s) => s.label), ["Personal", "Shared with me", "Space"]);
  assert.ok(empty.every((s) => s.rows.length === 0));
});

test("children follow their parent, a closed folder hides its children, and totals count every folder", () => {
  const [personal, shared, space] = visibleSections(nodes);
  assert.deepEqual(personal?.rows.map((r) => [r.node.id, r.depth, r.hasChildren, r.open]), [["p1", 0, true, true], ["p2", 1, false, false]]);
  assert.deepEqual(shared?.rows.map((r) => r.node.id), ["g1"]);
  assert.deepEqual(space?.rows.map((r) => [r.node.id, r.depth]), [["s1", 0], ["s2", 1]], "Beta is under the closed Acme");
  assert.equal(space?.total, 3);
  const opened = visibleSections(nodes, { s2: true });
  assert.deepEqual(opened[2]?.rows.map((r) => r.node.id), ["s1", "s2", "s3"]);
  const closed = visibleSections(nodes, { p1: false });
  assert.deepEqual(closed[0]?.rows.map((r) => r.node.id), ["p1"]);
});

test("a folder whose parent is not in the list is a root", () => {
  const s = visibleSections([node({ id: "x", name: "Orphan", parentId: "gone" })]);
  assert.deepEqual(s[2]?.rows.map((r) => [r.node.id, r.depth]), [["x", 0]]);
});

test("the cursor: arrows move, Right opens, Left closes or goes to the parent, Home and End jump", () => {
  const space = visibleSections(nodes)[2]?.rows ?? [];
  assert.deepEqual(moveCursor(space, "s1", "ArrowDown"), { id: "s2" });
  assert.deepEqual(moveCursor(space, "s2", "ArrowUp"), { id: "s1" });
  assert.deepEqual(moveCursor(space, "s2", "ArrowDown"), { id: "s2" }, "stays on the last row");
  assert.deepEqual(moveCursor(space, "s2", "ArrowRight"), { id: "s2", open: true }, "Acme has Beta, closed: Right opens it");
  assert.deepEqual(moveCursor(space, "s1", "ArrowLeft"), { id: "s1", open: false }, "open: Left closes it");
  assert.deepEqual(moveCursor(space, "s2", "ArrowLeft"), { id: "s1" }, "closed child: Left goes to the parent");
  assert.deepEqual(moveCursor(space, null, "ArrowDown"), { id: "s1" });
  assert.deepEqual(moveCursor(space, "s1", "End"), { id: "s2" });
  assert.deepEqual(moveCursor(space, "s2", "Home"), { id: "s1" });
  assert.deepEqual(moveCursor([], "s1", "ArrowDown"), { id: null });
});

test("the rendered tree has three sections, counts, nesting and the selected row painted on the whole row", () => {
  const html = renderToStaticMarkup(<FolderTree resourceType="site" nodes={nodes} selectedId="s1" density="regular" />);
  const at = (s: string) => html.indexOf(`>${s}<`);
  assert.ok(at("Personal") < at("Shared with me") && at("Shared with me") < at("Space"));
  assert.match(html, /data-testid="folder-count-s1"[^>]*>3</);
  assert.match(html, /Drafts/);
  assert.match(html, /Ideas/, "Ideas is under the open Drafts");
  assert.doesNotMatch(html, /Beta/, "Beta is under the closed Acme");
  assert.match(html, /data-testid="row-folder-s1"[^>]*background-color:var\(--sel\)|background-color:var\(--sel\)[^>]*data-testid="row-folder-s1"/);
  assert.match(html, /data-testid="folders-new-personal"/);
  assert.match(html, /data-testid="folders-new-space"/);
  assert.doesNotMatch(html, /folders-new-shared/, "nothing is created in Shared with me");
});

test("an empty section says so quietly", () => {
  const html = renderToStaticMarkup(<FolderTree resourceType="site" nodes={[]} selectedId={null} density="regular" />);
  assert.match(html, /Nothing shared with you yet/);
  assert.match(html, /No folders yet/);
});

test("the frozen props render", () => {
  const html = renderToStaticMarkup(<FolderTree {...frozenFolderTreeProps} />);
  assert.match(html, /Drafts/);
  assert.match(html, /Clients/);
});

test("the folder menu for a folder you own offers everything and ends with Report a problem", () => {
  const entries = menuEntries({ items: folderMenu(nodes[0] as FolderNode, true, true, {}) });
  const labels = entries.filter(isItem).map((i) => i.label);
  assert.deepEqual(labels, ["Close", "New Folder…", "Share…", "Rename…", "Move…", "Delete", "Report a problem"]);
  const last = entries[entries.length - 1];
  assert.ok(last && isReportItem(last));
  assert.ok(isSeparator(entries[entries.length - 2] as never));
  assert.ok(entries.filter(isItem).every((i) => typeof i.icon === "string" && i.icon.length > 0), "icons are all or none");
});

test("a folder shared with you can be opened and shared on, but not renamed, moved or deleted", () => {
  const shared = nodes[5] as FolderNode;
  assert.equal(canManageFolder(shared), false);
  const labels = menuEntries({ items: folderMenu(shared, false, false, {}) }).filter(isItem).map((i) => i.label);
  assert.deepEqual(labels, ["Share…", "Report a problem"]);
});

test("menu choices call the handlers", () => {
  const seen: string[] = [];
  const items = folderMenu(nodes[0] as FolderNode, true, true, {
    onToggle: (id, open) => seen.push(`toggle ${id} ${open}`),
    onNewFolder: (scope, parent) => seen.push(`new ${scope} ${parent}`),
    onShare: (n) => seen.push(`share ${n.id}`),
    onRename: (n) => seen.push(`rename ${n.id}`),
    onMove: (n) => seen.push(`move ${n.id}`),
    onDelete: (n) => seen.push(`delete ${n.id}`),
  });
  for (const e of items) if (isItem(e)) e.onSelect?.();
  assert.deepEqual(seen, ["toggle p1 false", "new personal p1", "share p1", "rename p1", "move p1", "delete p1"]);
});

test("SlotRow is a Row with leading and trailing slots inside the painted row", () => {
  const html = renderToStaticMarkup(<SlotRow id="a" title="Clients" selected leadWidth={30} lead={<span>L</span>} trail={<span>T</span>} />);
  assert.match(html, /background-color:var\(--sel\)/);
  assert.match(html, /data-testid="row-a-leading"/);
  assert.match(html, /data-testid="row-a-trailing"/);
  assert.ok(html.indexOf(">L<") < html.indexOf(">Clients<") && html.indexOf(">Clients<") < html.indexOf(">T<"));
  assert.match(html, /height:28px/);
  assert.doesNotMatch(html, /position:absolute/, "no overlay");
});

// Run on the final commit of P-L9_06 (lead request: every named test shows ok).
