import test from "node:test";
import assert from "node:assert/strict";
import { checkMenuIcons } from "./menu-icons.ts";

const file = "apps/app/src/places/files/List.tsx";

function menu(items: string): string {
  return `<Menu items={[\n${items}\n]} />`;
}

test("menu-icons: all items have an icon or none", () => {
  const all = menu(`{ label: "Open", icon: "folder" },\n{ label: "Rename", icon: "pencil" },`);
  const none = menu(`{ label: "Open" },\n{ label: "Rename" },`);
  const mixed = menu(`{ label: "Open", icon: "folder" },\n{ label: "Rename" },`);
  const withSeparator = menu(`{ label: "Open", icon: "folder" },\n{ separator: true },\n{ label: "Delete", icon: "trash" },`);
  assert.equal(checkMenuIcons(file, all).length, 0);
  assert.equal(checkMenuIcons(file, none).length, 0);
  assert.equal(checkMenuIcons(file, withSeparator).length, 0);
  const hits = checkMenuIcons(file, mixed);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "menu-icons");
  assert.equal(hits[0].message, "in any menu every item has an icon or none does");
});

test("menu-icons: Menu.Item children follow the same rule", () => {
  const mixed = `
    <Menu>
      <Menu.Item icon="folder" label="Open" />
      <Menu.Item label="Copy" />
    </Menu>
  `;
  const all = `
    <Menu>
      <Menu.Item icon="folder" label="Open" />
      <Menu.Item icon="copy" label="Copy" />
    </Menu>
  `;
  const none = `
    <Menu>
      <Menu.Item label="Open" />
      <Menu.Item label="Copy" />
    </Menu>
  `;
  assert.equal(checkMenuIcons(file, all).length, 0);
  assert.equal(checkMenuIcons(file, none).length, 0);
  assert.equal(checkMenuIcons(file, mixed).length, 1);
});

test("menu-icons ignores an items array that is not a menu", () => {
  const source = `const items = [{ label: "Open", icon: "folder" }, { label: "Rename" }];`;
  assert.equal(checkMenuIcons(file, source).length, 0);
});
