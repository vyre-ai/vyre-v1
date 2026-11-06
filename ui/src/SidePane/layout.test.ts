// The layout model: every band, the pane and sidebar limits, drag clamps (main never under 480), the fold and restore rule, and the gutter arithmetic.
import test from "node:test";
import assert from "node:assert/strict";
import { BANDS, BREAKPOINTS, GUTTER, MAIN_MIN, PANE, RAIL_WIDTH, READING_MAX, SIDEBAR, bandKey, bandOf, layoutPanels, paneDefault } from "./layout.ts";
import type { Layout, LayoutInput } from "./layout.ts";

const base = (o: Partial<LayoutInput> = {}): LayoutInput => ({ windowWidth: 1440, hasSidebar: true, sidebarOpen: true, paneOpen: false, ...o });
test("bands start at 1280, 1024 and 768", () => {
  assert.equal(bandOf(2000), "wide"); assert.equal(bandOf(1280), "wide");
  assert.equal(bandOf(1279), "mid"); assert.equal(bandOf(1024), "mid");
  assert.equal(bandOf(1023), "sheet"); assert.equal(bandOf(768), "sheet");
  assert.equal(bandOf(767), "phone"); assert.equal(bandOf(390), "phone");
  assert.deepEqual([...BANDS], ["wide", "mid", "sheet", "phone"]);
  assert.equal(BREAKPOINTS.wide, 1280);
});

test("wide, no pane: rail, sidebar 272 and main add up to the window with one 8 px gutter each", () => {
  for (const w of [1280, 1440, 2000, 2560]) {
    const l = layoutPanels(base({ windowWidth: w }));
    assert.equal(l.sidebar.mode, "docked"); assert.equal(l.sidebar.width, 272); assert.equal(l.pane.mode, "none");
    assert.equal(GUTTER + RAIL_WIDTH + GUTTER + l.sidebar.width + GUTTER + l.main.width + GUTTER, w, `window ${w}`);
  }
});

test("main reading width is capped at 720", () => {
  assert.equal(layoutPanels(base({ windowWidth: 2000 })).main.reading, READING_MAX);
  const small = layoutPanels(base({ windowWidth: 1280, paneOpen: true }));
  assert.equal(small.main.reading, small.main.width);
});

test("wide with a pane: all side by side, the pane is 40% of the room right of the sidebar, 360 to 560", () => {
  for (const w of [1280, 1440, 1700, 2000, 2560]) {
    const l = layoutPanels(base({ windowWidth: w, paneOpen: true }));
    assert.equal(l.pane.mode, "docked"); assert.equal(l.sidebar.mode, "docked");
    assert.ok(l.main.width >= MAIN_MIN, `main ${l.main.width} at ${w}`);
    assert.equal(GUTTER + RAIL_WIDTH + GUTTER + l.sidebar.width + GUTTER + l.main.width + GUTTER + l.pane.width + GUTTER, w);
    const room = w - GUTTER * 2 - RAIL_WIDTH - GUTTER - (l.sidebar.width + GUTTER);
    assert.equal(l.pane.width, Math.min(paneDefault(room), room - GUTTER - MAIN_MIN));
    assert.ok(l.pane.width >= PANE.min && l.pane.width <= 560);
  }
  assert.equal(layoutPanels(base({ windowWidth: 2000, paneOpen: true })).pane.width, 560);
});

test("paneDefault clamps 40% between 360 and 560", () => {
  assert.equal(paneDefault(500), 360); assert.equal(paneDefault(1000), 400); assert.equal(paneDefault(3000), 560);
});

test("a saved width wins over the default and is held inside the limits", () => {
  const w = 1700;
  assert.equal(layoutPanels(base({ windowWidth: w, paneOpen: true, saved: { pane: 600 } })).pane.width, 600);
  assert.equal(layoutPanels(base({ windowWidth: w, paneOpen: true, saved: { pane: 900 } })).pane.width, 640);
  assert.equal(layoutPanels(base({ windowWidth: w, paneOpen: true, saved: { pane: 100 } })).pane.width, 320);
  assert.equal(layoutPanels(base({ windowWidth: w, saved: { sidebar: 300 } })).sidebar.width, 300);
  assert.equal(layoutPanels(base({ windowWidth: w, saved: { sidebar: 100 } })).sidebar.width, 220);
  assert.equal(layoutPanels(base({ windowWidth: w, saved: { sidebar: 999 } })).sidebar.width, 360);
});

test("a pane drag stops where main would drop under 480", () => {
  for (const w of [1280, 1366, 1440, 1920]) {
    const l = layoutPanels(base({ windowWidth: w, paneOpen: true }));
    const max = l.pane.max;
    const drag = layoutPanels(base({ windowWidth: w, paneOpen: true, saved: { pane: max } }));
    assert.ok(drag.main.width >= MAIN_MIN, `at the stop main is ${drag.main.width}`);
    const past = layoutPanels(base({ windowWidth: w, paneOpen: true, saved: { pane: max + 200 } }));
    assert.equal(past.pane.width, max); assert.ok(past.main.width >= MAIN_MIN);
    assert.ok(max <= 640);
  }
});

test("a pane that does not fit the room yields instead of squeezing main", () => {
  // a wide sidebar and a wide saved pane on a 1280 window: the pane gives way
  const l = layoutPanels(base({ windowWidth: 1280, paneOpen: true, saved: { sidebar: 360, pane: 640 } }));
  assert.ok(l.main.width >= MAIN_MIN);
  assert.ok(l.pane.width >= PANE.min);
  assert.equal(l.sidebar.width, 360);
});

test("a sidebar drag stops where the pane at its floor and main at 480 still fit", () => {
  const l = layoutPanels(base({ windowWidth: 1280, paneOpen: true }));
  assert.ok(l.sidebar.max <= SIDEBAR.max);
  const wide = layoutPanels(base({ windowWidth: 1280, paneOpen: true, saved: { sidebar: 360 } }));
  assert.ok(wide.main.width >= MAIN_MIN && wide.pane.width >= PANE.min);
  // no pane: the full range
  assert.equal(layoutPanels(base({ windowWidth: 1280 })).sidebar.max, 360);
  assert.equal(layoutPanels(base({ windowWidth: 1280 })).sidebar.min, 220);
});

test("mid band: opening a pane folds the sidebar to the rail, closing it brings the sidebar back", () => {
  for (const w of [1024, 1100, 1279]) {
    const closed = layoutPanels(base({ windowWidth: w }));
    assert.equal(closed.sidebar.mode, "docked"); assert.equal(closed.folded, false);
    assert.ok(closed.main.width >= MAIN_MIN, `main ${closed.main.width} at ${w}`);
    const open = layoutPanels(base({ windowWidth: w, paneOpen: true }));
    assert.equal(open.sidebar.mode, "hidden"); assert.equal(open.folded, true);
    assert.equal(open.pane.mode, "docked"); assert.ok(open.main.width >= MAIN_MIN);
    assert.equal(GUTTER + RAIL_WIDTH + GUTTER + open.main.width + GUTTER + open.pane.width + GUTTER, w);
    const back = layoutPanels(base({ windowWidth: w }));
    assert.equal(back.sidebar.mode, "docked");
  }
});

test("mid band: a sidebar the person closed stays closed after the pane closes, and is not 'folded'", () => {
  const open = layoutPanels(base({ windowWidth: 1100, sidebarOpen: false, paneOpen: true }));
  assert.equal(open.sidebar.mode, "hidden"); assert.equal(open.folded, false);
  assert.equal(layoutPanels(base({ windowWidth: 1100, sidebarOpen: false })).sidebar.mode, "hidden");
});

test("mid band: a peek shows the sidebar as an overlay, the pane stays", () => {
  const l = layoutPanels(base({ windowWidth: 1100, paneOpen: true, sidebarPeek: true }));
  assert.equal(l.sidebar.mode, "overlay"); assert.equal(l.pane.mode, "docked");
  assert.ok(l.main.width >= MAIN_MIN);
});

test("sheet band: the sidebar and the pane are overlay sheets, main keeps the whole room", () => {
  for (const w of [768, 900, 1023]) {
    const idle = layoutPanels(base({ windowWidth: w }));
    assert.equal(idle.sidebar.mode, "hidden"); assert.equal(idle.pane.mode, "none");
    assert.equal(idle.main.width, w - 2 * GUTTER - RAIL_WIDTH - GUTTER);
    const sidebar = layoutPanels(base({ windowWidth: w, sidebarPeek: true }));
    assert.equal(sidebar.sidebar.mode, "overlay"); assert.equal(sidebar.main.width, idle.main.width);
    const pane = layoutPanels(base({ windowWidth: w, paneOpen: true }));
    assert.equal(pane.pane.mode, "overlay"); assert.equal(pane.main.width, idle.main.width);
    assert.ok(pane.pane.width <= idle.main.width && pane.pane.width >= PANE.min);
  }
});

test("phone: one panel at a time, every panel the window's width, no rail column", () => {
  const l = layoutPanels(base({ windowWidth: 390, paneOpen: true }));
  assert.equal(l.band, "phone"); assert.equal(l.rail.shown, false);
  assert.equal(l.sidebar.mode, "screen"); assert.equal(l.pane.mode, "screen");
  assert.equal(l.main.width, 390);
  assert.equal(layoutPanels(base({ windowWidth: 390, hasSidebar: false })).sidebar.mode, "none");
});

test("no sidebar in the place: nothing is reserved for it", () => {
  const l = layoutPanels(base({ windowWidth: 1440, hasSidebar: false }));
  assert.equal(l.sidebar.mode, "none");
  assert.equal(GUTTER + RAIL_WIDTH + GUTTER + l.main.width + GUTTER, 1440);
});

test("a collapsed sidebar gives its width and its gutter to main", () => {
  const l = layoutPanels(base({ windowWidth: 1440, sidebarOpen: false }));
  assert.equal(l.sidebar.mode, "hidden");
  assert.equal(GUTTER + RAIL_WIDTH + GUTTER + l.main.width + GUTTER, 1440);
});

test("every size from 700 to 2600 keeps main at or over 480 in the docked bands and never overlaps", () => {
  for (let w = 700; w <= 2600; w += 7) for (const paneOpen of [false, true]) for (const sidebarOpen of [false, true]) for (const sp of [0, 360]) {
    const l = layoutPanels(base({ windowWidth: w, paneOpen, sidebarOpen, saved: { sidebar: sp || null, pane: sp ? 640 : null } }));
    if (l.band === "wide" || l.band === "mid") {
      assert.ok(l.main.width >= MAIN_MIN, `main ${l.main.width} at ${w} pane=${paneOpen} sb=${sidebarOpen}`);
      const parts = (l.rail.width + GUTTER * 3) + (l.sidebar.mode === "docked" ? l.sidebar.width + GUTTER : 0) + l.main.width + (l.pane.mode === "docked" ? l.pane.width + GUTTER : 0);
      assert.equal(parts, w, `sum at ${w}`);
    }
    assert.ok(l.sidebar.width >= SIDEBAR.min || l.band === "phone");
  }
});

test("widths are saved per band", () => {
  assert.equal(bandKey("chats-thread-side", "wide"), "chats-thread-side@wide");
  assert.notEqual(bandKey("p", "wide"), bandKey("p", "mid"));
});
