// @tsx
// Space switch (spec 2.1, ARCH 7.0, b15): mounts the three seeds (Northwind, Personal, Harbor Studio), opens every place in Northwind, switches, and asserts that every query
// key and subscription carries the new spaceId, that no Northwind id appears in the DOM at any frame after the first skeleton frame, that the Kit, skin, rail, title and
// notification set changed, and that tabs restore when switching back. Perf: space_switch under 500 ms with the skeleton.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createThemeController, seedSpaceSkin } from "../../../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../../../ui/src/theme/index.ts";
import { railPlaces } from "../rail/kits.ts";
import { Shell } from "./Shell.tsx";
import { SpaceSkeleton } from "./Skeleton.tsx";
import { SPACE_SWITCH_BUDGET_MS, titleText } from "./hub.ts";
import type { HubOptions, ShellHub } from "./hub.ts";
import { shellKey } from "./keys.ts";
import { SAMPLE_ROWS, createSampleShell, samplePlace } from "./sample.tsx";

function rig(openId = "nw", extra: Partial<Omit<HubOptions, "spaces">> = {}) {
  const attrs: Record<string, string> = {};
  const root: ThemeRoot = {
    setAttribute: (n, v) => { attrs[n] = v; },
    setProperty: () => undefined,
    removeProperty: () => undefined,
  };
  const theme = createThemeController({ personId: "irfad", spaceId: openId, spaceSkin: seedSpaceSkin(), prefersDark: false, root, storage: null });
  const hub = createSampleShell({ openId, theme, skeletonMs: 0, ...extra });
  return { hub, theme, attrs };
}

const html = (hub: ShellHub): string => renderToStaticMarkup(createElement(Shell, { hub, renderPlace: samplePlace })).replaceAll("<!-- -->", "");
const text = (markup: string): string => markup.replace(/<[^>]*>/g, "");

test("the three seeds mount and every place opens in each Space with only that Space's rows", async () => {
  const { hub } = rig();
  assert.deepEqual(hub.spaces().map((s) => s.name), ["Northwind", "Harbor Studio", "Personal"]);
  const prefix: Record<string, string> = { nw: "nw-", hb: "hb-", me: "me-" };
  for (const id of ["nw", "hb", "me"]) {
    if (id !== "nw") {
      hub.switchTo(id);
      await hub.whenReady();
    }
    const places = railPlaces(hub.rail());
    assert.ok(places.length >= 8, `${id} has a rail`);
    for (const p of places) {
      hub.go(p);
      const out = html(hub);
      const rows = SAMPLE_ROWS[id]?.[p] ?? [];
      if (id === "me" && p === "apps") {
        assert.ok(out.includes("Needs a Team Space"), "a Personal Space says what needs a Team Space");
        assert.ok(!out.includes(`data-testid="sample-apps"`));
        continue;
      }
      assert.ok(out.includes(`data-testid="sample-${p}"`), `${id} ${p} draws`);
      for (const r of rows) assert.ok(out.includes(`data-testid="${r.id}"`), `${r.id} shows in ${id} ${p}`);
      for (const other of Object.keys(prefix).filter((k) => k !== id)) assert.ok(!out.includes(`data-testid="${prefix[other]}`), `no ${other} row in ${id} ${p}`);
    }
  }
});

test("a switch shows the skeleton first and no id of the old Space appears at any frame after it", async () => {
  const { hub } = rig();
  hub.go("chats");
  assert.ok(html(hub).includes('data-testid="nw-chat-1"'), "Northwind rows before the switch");
  assert.equal(hub.switchTo("hb"), true);
  assert.equal(hub.state().phase, "skeleton", "the first frame after the call is the skeleton");
  const first = html(hub);
  assert.ok(first.includes('data-testid="shell-skeleton"'));
  assert.ok(!first.includes('data-testid="shell-place"'), "no place draws under the skeleton");
  assert.ok(!first.includes('data-testid="nw-'), "no Northwind id in the skeleton frame");
  assert.ok(!first.includes("Northwind"), "no Northwind name either");
  await hub.whenReady();
  const next = html(hub);
  assert.ok(next.includes('data-testid="hb-chat-1"'), "Harbor Studio rows after the skeleton");
  assert.ok(!next.includes('data-testid="nw-') && !next.includes("Northwind"), "still nothing from Northwind");
  assert.equal(text(renderToStaticMarkup(createElement(SpaceSkeleton))), "", "the skeleton carries no text and no data");
});

test("every query key and subscription carries the new spaceId; a straggler from the old Space is refused", async () => {
  const { hub } = rig();
  for (const p of ["home", "chats", "files"]) hub.watch(hub.queryKey(p, "list"));
  assert.equal(hub.subscriptions().length, 3);
  assert.ok(hub.subscriptions().every((k) => k[0] === "nw"));
  hub.switchTo("hb");
  assert.deepEqual(hub.subscriptions("nw"), [], "places unmount on switch and their subscriptions close");
  assert.deepEqual(hub.queryKey("chats", "recent"), ["hb", "chats", "recent"], "keys carry the open Space first");
  assert.equal(hub.watch(["nw", "chats", "list"]), null, "a late subscription for Northwind is refused");
  assert.equal(hub.refused(), 1);
  await hub.whenReady();
  const stop = hub.watch(hub.queryKey("chats", "list"));
  assert.ok(stop !== null);
  assert.ok(hub.subscriptions().every((k) => k[0] === "hb"));
  stop();
  assert.equal(hub.subscriptions().length, 0);
});

test("the Kit, skin, rail, title and notification set change with the Space", async () => {
  const { hub, theme, attrs } = rig();
  const nwRail = railPlaces(hub.rail());
  const nwNotes = JSON.stringify(hub.session().def.counts) + JSON.stringify(hub.session().def.dots);
  assert.equal(attrs["data-skin"], "system");
  hub.switchTo("hb");
  assert.equal(attrs["data-skin"], "linen", "the skin is on the root before the call returns");
  assert.equal(theme.current().skin, "linen");
  assert.equal(attrs["data-space"], "hb");
  await hub.whenReady();
  assert.notDeepEqual(railPlaces(hub.rail()), nwRail, "Harbor Studio's Kit draws a different rail");
  assert.ok(!railPlaces(hub.rail()).includes("console") && !railPlaces(hub.rail()).includes("records"));
  assert.equal(hub.session().kit.id, "studio");
  assert.notEqual(JSON.stringify(hub.session().def.counts) + JSON.stringify(hub.session().def.dots), nwNotes, "notification counts are the Space's own");
  assert.equal(titleText(hub.session().def.name, hub.state().place, false), "Vyre · Harbor Studio · Chats");
  assert.ok(html(hub).includes("Vyre · Harbor Studio · Chats"));
  hub.switchTo("me");
  await hub.whenReady();
  assert.equal(hub.session().kit.id, "personal");
  assert.ok(html(hub).includes("Vyre · Personal"));
});

test("tabs restore when you switch back to a Space", async () => {
  const { hub } = rig();
  hub.go("files");
  hub.go("records", "pruitt");
  const before = hub.session().tabs.state();
  assert.deepEqual(before.tabs.map((t) => t.key), ["chats", "files", "records:pruitt"]);
  hub.switchTo("hb");
  await hub.whenReady();
  hub.go("inbox");
  assert.deepEqual(hub.session().tabs.state().tabs.map((t) => t.key), ["chats", "inbox"], "Harbor Studio has its own tabs");
  hub.switchTo("nw");
  await hub.whenReady();
  assert.deepEqual(hub.session().tabs.state(), before, "Northwind's tabs are as you left them");
  assert.equal(hub.state().place, "records");
  assert.equal(hub.state().hash, "pruitt");
  assert.ok(html(hub).includes('data-testid="sample-records"'));
});

test("starred Spaces are pre-opened, the previous replica stays open read-only, and a Space opens once", async () => {
  const opened: string[] = [];
  const { hub } = rig("nw", { openReplica: (id) => { opened.push(id); } });
  assert.equal(hub.session("nw").replica.opens, 1);
  assert.equal(hub.session("hb").replica.opens, 1, "Harbor Studio is starred: already open");
  assert.equal(hub.session("me").replica.opens, 0, "Personal is not starred");
  hub.switchTo("hb");
  assert.equal(hub.session("nw").replica.mode, "read-only", "Interrupt notices from Northwind can still arrive");
  assert.equal(hub.session("hb").replica.mode, "open");
  await hub.whenReady();
  hub.switchTo("me");
  await hub.whenReady();
  assert.deepEqual(opened, ["me"], "only the Space that was not pre-opened is brought up on the switch");
  hub.switchTo("nw");
  await hub.whenReady();
  assert.equal(hub.session("nw").replica.opens, 1);
  assert.equal(hub.switchTo("nw"), false, "switching to the open Space is a no-op");
  assert.equal(hub.switchTo("zz"), false, "an unknown Space is refused");
});

test("perf space_switch: under 500 ms with the skeleton, pre-opened and cold", async () => {
  const { hub } = rig("nw", { openReplica: () => new Promise<void>((resolve) => { setTimeout(resolve, 25); }), skeletonMs: 120 });
  const ran: string[] = [];
  for (const to of ["hb", "me", "nw"]) {
    hub.switchTo(to);
    assert.equal(hub.state().phase, "skeleton");
    await hub.whenReady();
    html(hub);
    hub.placeDrawn(hub.state().epoch);
    ran.push(to);
  }
  const probes = hub.probes();
  assert.equal(probes.length, 3);
  for (const p of probes) {
    console.log(`perf space_switch ${p.from}->${p.to} ${p.ms.toFixed(1)} ms (budget ${SPACE_SWITCH_BUDGET_MS} ms)`);
    assert.ok(p.ms < SPACE_SWITCH_BUDGET_MS, `${p.from}->${p.to} took ${p.ms} ms`);
  }
  assert.deepEqual(ran, ["hb", "me", "nw"]);
});

test("a Space that fails to open says so and Try again opens it", async () => {
  let fail = true;
  const { hub } = rig("nw", { openReplica: () => (fail ? Promise.reject(new Error("The local store did not unlock")) : Promise.resolve()) });
  hub.switchTo("me");
  await hub.whenReady();
  assert.equal(hub.state().error, "The local store did not unlock");
  const out = html(hub);
  assert.ok(out.includes("Couldn&#x27;t open Personal") || out.includes("Couldn't open Personal"));
  assert.ok(out.includes("Retry"));
  fail = false;
  hub.retry();
  await hub.whenReady();
  assert.equal(hub.state().error, null);
  assert.ok(html(hub).includes('data-testid="sample-chats"') || html(hub).includes('data-testid="sample-home"'));
});

test("the shell owns Shift-Cmd-1..3, Cmd-T, Cmd-W, Cmd-K and Shift-Cmd-/ and leaves Cmd-1..9 to Chats", () => {
  assert.deepEqual(shellKey({ key: "2", metaKey: true, shiftKey: true }), { type: "space", index: 1 });
  assert.deepEqual(shellKey({ key: "@", ctrlKey: true, shiftKey: true }), { type: "space", index: 1 });
  assert.deepEqual(shellKey({ key: "3", metaKey: true, shiftKey: true }), { type: "space", index: 2 });
  assert.deepEqual(shellKey({ key: "t", metaKey: true }), { type: "new-tab" });
  assert.deepEqual(shellKey({ key: "w", ctrlKey: true }), { type: "close-tab" });
  assert.deepEqual(shellKey({ key: "k", metaKey: true }), { type: "search" });
  assert.deepEqual(shellKey({ key: "/", metaKey: true, shiftKey: true }), { type: "report" });
  assert.equal(shellKey({ key: "1", metaKey: true }), null, "Cmd-1 jumps to a starred agent in Chats");
  assert.equal(shellKey({ key: "4", metaKey: true, shiftKey: true }), null);
  assert.equal(shellKey({ key: "t" }), null, "no modifier, no command");
  assert.equal(shellKey({ key: "t", metaKey: true, altKey: true }), null);
});
