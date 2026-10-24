import test from "node:test";
import assert from "node:assert/strict";
import { checkNoRawContextMenu } from "./no-raw-context-menu.ts";

const place = "apps/app/src/places/files/List.tsx";

test("no-raw-context-menu fails a native contextmenu", () => {
  const prop = `export function List() {\n  return <div onContextMenu={(event) => event.preventDefault()} />;\n}\n`;
  const listener = `node.addEventListener("contextmenu", onNativeMenu);\n`;
  const single = `node.addEventListener('contextmenu', onNativeMenu);\n`;
  for (const source of [prop, listener, single]) {
    const hits = checkNoRawContextMenu(place, source);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rule, "no-raw-context-menu");
    assert.match(hits[0].message, /contextmenu/);
  }
  const shared = `import { Menu } from "ui/Menu";\nexport function List() {\n  return <Menu items={[{ label: "Open" }, { label: "Copy" }]} />;\n}\n`;
  assert.equal(checkNoRawContextMenu(place, shared).length, 0);
});

test("no-raw-context-menu allows ui/Menu to cancel the native event", () => {
  const menu = `root.addEventListener("contextmenu", (event) => {\n  event.preventDefault();\n  openMenu(event.clientX, event.clientY);\n});\n`;
  assert.equal(checkNoRawContextMenu("ui/src/Menu/Menu.tsx", menu).length, 0);
  const forgotten = `root.addEventListener("contextmenu", openMenu);\n`;
  assert.equal(checkNoRawContextMenu("ui/src/Menu/Menu.tsx", forgotten).length, 1);
});
