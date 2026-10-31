// The runs-on chip: drawn for a private chat that has somewhere else to run, named for the place it runs now, with the others in a menu; off places are grey with the reason.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RunsOnPill, currentOption, runsOnEntries, showsChip } from "./RunsOn.tsx";
import type { RunsOnOption, RunsOnState } from "./RunsOn.tsx";

const device: RunsOnOption = { target: "device", name: "This computer", online: true };
const space: RunsOnOption = { target: "space", name: "The Space", online: true };
const home: RunsOnOption = { target: "server", serverId: "srv_home", name: "home-box", online: true };
const off: RunsOnOption = { target: "server", serverId: "srv_off", name: "old-mac", online: false, reason: "Off" };
const state = (o: Partial<RunsOnState> = {}): RunsOnState => ({ private: true, effective: { target: "device" }, options: [device, space, home, off], ...o });
const html = (s: RunsOnState, narrow = false): string => renderToStaticMarkup(<RunsOnPill state={s} narrow={narrow} onOpen={() => undefined} />).replaceAll("<!-- -->", "");

test("the chip is drawn only for a private chat with a choice: a lone computer, a shared chat and nothing loaded draw none", () => {
  assert.equal(showsChip(null), false);
  assert.equal(showsChip(state({ options: [device] })), false, "a lone This computer is no choice");
  assert.equal(showsChip(state({ private: false })), false);
  assert.equal(showsChip(state()), true);
});

test("the pill names where the chat runs, a server by its nickname, and is only an icon on a narrow header", () => {
  assert.ok(html(state()).includes("This computer") && html(state()).includes('aria-label="Runs on This computer"'));
  const onHome = state({ effective: { target: "server", serverId: "srv_home" } });
  assert.equal(currentOption(onHome).name, "home-box");
  assert.ok(html(onHome).includes("home-box"));
  assert.ok(!html(onHome, true).includes('data-testid="runs-on-label"'), "icon only when narrow");
  assert.equal(currentOption(state({ effective: { target: "space" }, options: [device, home] })).name, "This computer", "a place the options do not list reads as the first");
});

test("the menu lists every place, ticks the current one, and greys an off place with the reason on hover; choosing hands back the option", () => {
  const picked: RunsOnOption[] = [];
  const entries = runsOnEntries(state({ effective: { target: "server", serverId: "srv_home" } }), (o) => picked.push(o));
  const items = entries as Array<{ label: string; checked?: boolean; disabled?: boolean; reason?: string; icon?: string; onSelect?: () => void }>;
  assert.deepEqual(items.map((e) => [e.label, e.checked === true, e.disabled === true, e.reason ?? null]), [
    ["This computer", false, false, null], ["The Space", false, false, null], ["home-box", true, false, null], ["old-mac", false, true, "Off"],
  ]);
  assert.ok(items.every((e) => e.icon?.startsWith("<svg")), "every row has an icon (icons are all or none)");
  items[1]!.onSelect!();
  items[2]!.onSelect!();
  assert.deepEqual(picked.map((o) => o.name), ["The Space", "home-box"]);
});
