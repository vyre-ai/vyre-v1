// The rail (spec 3.0, 2.1) and the Space tile menu: Kit-defined places, counts and dots, the Console only with access, a Personal Space that keeps Apps (and says so in the place).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { iconsAllOrNone, menuEntries } from "../../../../../ui/src/Menu/index.tsx";
import { isHead, isItem, isReportItem } from "../../../../../ui/src/Menu/props.ts";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { SpaceTile, spaceMenuEntries } from "../spaces/SpaceSwitcher.tsx";
import { HARBOR, NORTHWIND, PERSONAL, SEED_DEFS, othersNeedingYou } from "../spaces/model.ts";
import { PLACE_TITLE, kitById, railFor, railPlaces } from "./kits.ts";
import { Rail } from "./Rail.tsx";
import { SHELL_ICONS, iconMarkup } from "./icons.tsx";

const rail = (space: typeof NORTHWIND, active: "home" | "chats" = "chats") => railFor({ kit: kitById(space.kit), console: space.console, counts: space.counts, dots: space.dots, active });
const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node).replaceAll("<!-- -->", "");
const labels = (entries: readonly MenuEntry[]): string[] => entries.filter(isItem).map((e) => e.label);

test("each Space's Kit draws its own rail and the Console shows only with access", () => {
  assert.deepEqual(railPlaces(rail(NORTHWIND)), ["home", "chats", "inbox", "records", "files", "apps", "automations", "vault", "settings", "console", "join"]);
  assert.deepEqual(railPlaces(rail(HARBOR)), ["home", "chats", "inbox", "files", "apps", "vault", "settings", "join"]);
  assert.ok(!railPlaces(rail(PERSONAL)).includes("console"));
  assert.ok(railPlaces(rail(PERSONAL)).includes("apps"), "a Personal Space keeps Apps in the rail; the place says it needs a Team Space");
  const noAccess = railFor({ kit: kitById("northwind"), console: false, counts: {}, dots: {}, active: "home" });
  assert.ok(!railPlaces(noAccess).includes("console"), "no console.access, no Console button");
  assert.equal(kitById("nope").id, "northwind", "an unknown Kit falls back to the default");
});

test("a count is a number, a dot is quiet and never on the place you are looking at", () => {
  const nw = rail(NORTHWIND, "home");
  assert.equal(nw.top.find((e) => e.place === "chats")?.count, 7);
  assert.equal(nw.top.find((e) => e.place === "inbox")?.dot, true);
  assert.equal(rail(NORTHWIND, "chats").top.find((e) => e.place === "chats")?.dot, false);
  const inboxOpen = railFor({ kit: kitById("northwind"), console: true, counts: {}, dots: { inbox: true }, active: "chats" });
  assert.equal(inboxOpen.top.find((e) => e.place === "inbox")?.dot, true);
  const lookingAtIt = railFor({ kit: kitById("northwind"), console: true, counts: {}, dots: { chats: true }, active: "chats" });
  assert.equal(lookingAtIt.top.find((e) => e.place === "chats")?.dot, false);
});

test("the rail draws the open place selected with its bar, counts and dots, the Space tile in the header and the bottom group after a spacer", () => {
  const out = html(<Rail groups={rail(NORTHWIND)} active="chats" onSelect={() => undefined} header={<SpaceTile spaces={SEED_DEFS} openId="nw" away={false} onSwitch={() => undefined} onAction={() => undefined} />} />);
  assert.ok(out.includes('data-testid="rail-chats-selected"') && out.includes('data-testid="rail-bar"'));
  assert.ok(out.includes('data-testid="rail-home"') && !out.includes('data-testid="rail-home-selected"'));
  assert.ok(out.includes('data-testid="rail-count-chats"') && out.includes(">7<"));
  assert.ok(out.includes('data-testid="rail-dot-inbox"'));
  assert.ok(out.includes('aria-label="Chats, 7 waiting"'));
  assert.ok(out.indexOf('data-testid="space-tile"') < out.indexOf('data-testid="rail-home"'), "the Space tile sits above the places");
  assert.ok(out.indexOf('data-testid="rail-files"') < out.indexOf('data-testid="rail-apps"'), "top group, then bottom group");
  assert.ok(out.includes('data-testid="tile-dot"'), "Harbor Studio needs you: the red dot on the tile");
  for (const p of Object.keys(PLACE_TITLE)) assert.ok(SHELL_ICONS[p as keyof typeof SHELL_ICONS] !== undefined, `an icon for ${p}`);
});

test("the Space menu: your Spaces with the open one checked, then the actions; Terminal only for an owner or developer; icons on every item", () => {
  const input = { spaces: SEED_DEFS, openId: "nw", away: false, onSwitch: () => undefined, onAction: () => undefined };
  const nw = spaceMenuEntries(input);
  assert.ok(isHead(nw[0] as MenuEntry) && (nw[0] as { head: string }).head === "Spaces");
  assert.deepEqual(labels(nw), ["Northwind", "Harbor Studio, needs you", "Personal", "Add a Space", "Invite People", "Space Settings", "Open Terminal", "Set Yourself Away", "Your Profile", "Lock Vyre", "Sign Out"]);
  assert.equal(nw.filter(isItem).filter((e) => e.checked === true).map((e) => e.label).join(), "Northwind");
  assert.ok(iconsAllOrNone(nw));
  assert.ok(!labels(spaceMenuEntries({ ...input, openId: "hb" })).includes("Open Terminal"), "a member does not get Open Terminal");
  assert.ok(labels(spaceMenuEntries({ ...input, away: true })).includes("I'm Back"));
  const shown = menuEntries({ items: nw, source: "context" });
  assert.ok(isReportItem(shown[shown.length - 1] as MenuEntry), "ui/Menu appends Report a problem; the switcher never adds it by hand");
  assert.ok(!labels(nw).includes("Report a problem"));
});

test("choosing a Space or an action calls back with it", () => {
  const seen: string[] = [];
  const entries = spaceMenuEntries({ spaces: SEED_DEFS, openId: "nw", away: false, onSwitch: (id) => seen.push(`switch:${id}`), onAction: (a) => seen.push(`action:${a}`) });
  for (const e of entries.filter(isItem)) e.onSelect?.();
  assert.deepEqual(seen, ["switch:nw", "switch:hb", "switch:me", "action:add", "action:invite", "action:settings", "action:terminal", "action:away", "action:profile", "action:lock", "action:sign-out"]);
});

test("the red dot is for another Space that needs you, and the tile says away", () => {
  assert.deepEqual(othersNeedingYou(SEED_DEFS, "nw").map((s) => s.spaceId), ["hb"]);
  assert.deepEqual(othersNeedingYou(SEED_DEFS, "hb"), []);
  const tile = (openId: string, away: boolean) => html(<SpaceTile spaces={SEED_DEFS} openId={openId} away={away} onSwitch={() => undefined} onAction={() => undefined} />);
  assert.ok(tile("nw", false).includes('data-testid="tile-dot"'));
  assert.ok(!tile("hb", false).includes('data-testid="tile-dot"'));
  assert.ok(tile("nw", true).includes('data-testid="tile-away"'));
  assert.ok(tile("nw", false).includes(">N<") && tile("hb", false).includes(">H<"));
  assert.ok(iconMarkup("chats").startsWith("<svg") && iconMarkup("chats").includes("<path"));
});

test("the rail tells the shell which place is pointed at or focused, so it can read that place ahead of the click; no prop, no calls", () => {
  const seen: string[] = [];
  const html = renderToStaticMarkup(<Rail groups={{ top: [{ place: "home", title: "Home", count: 0, dot: false }, { place: "chats", title: "Chats", count: 0, dot: false }], bottom: [] }} active="home" onSelect={() => undefined} onPrefetch={(p) => seen.push(p)} />);
  assert.ok(html.includes('data-testid="rail-chats"'), "the rail still draws");
  assert.deepEqual(seen, [], "nothing is prefetched until a person points at a place");
  assert.ok(renderToStaticMarkup(<Rail groups={{ top: [], bottom: [] }} active="home" onSelect={() => undefined} />).includes("shell-rail"));
});
