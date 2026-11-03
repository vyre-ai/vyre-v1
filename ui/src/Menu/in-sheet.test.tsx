// ui/Menu inside a sheet (owner bug, 3 Nov 2026: the Who picker in Add an exception opened behind its sheet, cut off to the left of it). Every menu, picker or popover opened from a sheet or a
// dialog draws in the root overlay layer above the sheet, anchored to its trigger and kept inside the window. These pin the three things that make it so: the menu's layer sits above
// the dialog's veil; the menu is drawn through the overlay portal; the anchor maths keeps a menu opened near an edge inside the window.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clampMenu } from "./index.tsx";
import { OVERLAY_ROOT_CSS } from "../Overlay/index.tsx";


/** Every z-index a layer in the app sets, from the source (a sheet, a dialog veil, a popover). */
function layers(): Array<{ file: string; z: number }> {
  const out: Array<{ file: string; z: number }> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
      if (!/\.(tsx|ts)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      for (const m of readFileSync(p, "utf8").matchAll(/zIndex:\s*(\d+)/g)) out.push({ file: p, z: Number(m[1]) });
    }
  };
  for (const root of ["../../../ui/src", "../../../apps/app/src"]) walk(fileURLToPath(new URL(root, import.meta.url)));
  return out;
}

test("a menu opened in a sheet or dialog sits above it: no sheet, dialog veil or panel in the app is drawn above the menu layer", () => {
  const src = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  const menuZ = Number(/layer: \{[^}]*zIndex: (\d+)/.exec(src)![1]);
  const overlay = Number(/z-index:(\d+)/.exec(OVERLAY_ROOT_CSS)![1]);
  assert.ok(menuZ >= overlay, "the menu's layer is the top overlay's");
  const dialog = readFileSync(new URL("../Dialog/index.tsx", import.meta.url), "utf8");
  const veil = Number(/veil: \{[^}]*zIndex: (\d+)/.exec(dialog)![1]);
  assert.ok(menuZ > veil, `the menu (${menuZ}) is above the dialog veil (${veil})`);
  // a popover opened from a menu (the date picker) may sit just above it; nothing else may reach it
  const above = layers().filter((l) => l.z >= menuZ && !/Menu\/index\.tsx$|Plan\/datepicker\.tsx$/.test(l.file));
  assert.deepEqual(above, [], "no other layer is drawn at or above the menu layer");
});

test("the menu is drawn through the overlay portal, never inside the sheet's own stacking context", () => {
  const src = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(src, /MenuPortal/, "ui/Menu draws its layer through MenuPortal (ui/Overlay)");
  const portal = readFileSync(new URL("./portal.tsx", import.meta.url), "utf8");
  assert.match(portal, /<Overlay>/);
});

test("a menu opened from a trigger near the left edge of a sheet stays inside the window, under its trigger", () => {
  // the Who picker: a narrow trigger at x 40; a right-aligned menu would have started at 40 - 220
  const at = clampMenu(40 - 220, 300, 220, 260, 1280, 900);
  assert.ok(at.left >= 6 && at.left + 220 <= 1280 - 6, `left ${at.left} is inside the window`);
  const left = clampMenu(40, 300, 220, 260, 1280, 900);
  assert.equal(left.left, 40, "a menu opened from its trigger's left edge stays there");
  const low = clampMenu(40, 860, 220, 260, 1280, 900);
  assert.ok(low.top + 260 <= 900 - 6, "near the bottom it moves up to stay inside the window");
});
