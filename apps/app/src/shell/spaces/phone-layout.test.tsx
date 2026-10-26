// The phone layout (P-L9_36): the rail lies along the bottom with the five places and a More menu button; a computer keeps the side rail; the Files header keeps New and one "..." menu.
// @reads ../../../../../scripts/shots/mounts/P-L9_36.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NORTHWIND } from "./model.ts";
import { kitById, railFor } from "../rail/kits.ts";
import { Rail } from "../rail/Rail.tsx";
import { Toolbar } from "../../places/files/Toolbar.tsx";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node).replaceAll("<!-- -->", "");
const groups = railFor({ kit: kitById(NORTHWIND.kit), console: NORTHWIND.console, counts: NORTHWIND.counts, dots: NORTHWIND.dots, active: "files" });
const noop = (): void => undefined;

test("on a phone the rail is a bottom bar with the five places and a More button", () => {
  const out = html(<Rail bottom groups={groups} active="files" onSelect={noop} />);
  assert.ok(out.includes('data-testid="shell-rail-bottom"') && !out.includes('data-testid="shell-rail"'));
  for (const p of ["home", "chats", "inbox", "records", "files"]) assert.ok(out.includes(`data-testid="rail-${p}`), p);
  assert.ok(out.includes('data-testid="rail-files-selected"'));
  assert.ok(out.includes('aria-label="More places"') && out.includes('aria-haspopup="menu"'));
  assert.ok(!out.includes('data-testid="rail-apps"'), "the other places sit behind More");
});

test("on a computer the rail stays at the side, with every place and no More button", () => {
  const out = html(<Rail groups={groups} active="files" onSelect={noop} />);
  assert.ok(out.includes('data-testid="shell-rail"') && !out.includes("shell-rail-bottom") && !out.includes("rail-more"));
  assert.ok(out.includes('data-testid="rail-apps"'));
});

test("the Files header on a phone is the title, New and a More options button; the sort and view controls move into the menu", () => {
  const props = { crumbs: [{ key: "root", name: "Files", id: null }, { key: "a", name: "Agents", id: "a" }], count: "6 items", sortLabel: "Name", view: "list" as const, onGo: noop, onSort: noop, onView: noop, onNew: noop, onMore: noop, onUpload: noop };
  const phone = html(<Toolbar {...props} compact />);
  assert.ok(phone.includes('data-testid="files-new"') && phone.includes('aria-label="More options"'));
  for (const gone of ["files-sort", "files-view", "files-upload", "files-count", "files-back"]) assert.ok(!phone.includes(`data-testid="${gone}"`), gone);
  assert.ok(phone.includes("Agents") && !phone.includes('data-testid="files-crumb-root"'));
  const desk = html(<Toolbar {...props} />);
  for (const kept of ["files-sort", "files-view", "files-upload", "files-count", "files-back"]) assert.ok(desk.includes(`data-testid="${kept}"`), kept);
});
