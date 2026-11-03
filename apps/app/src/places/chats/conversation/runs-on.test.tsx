// The runs-on chip: drawn for a private chat that has somewhere else to run, named for the place it runs now, with the others in a menu; off places are grey with the reason.
import test from "node:test";
import assert from "node:assert/strict";
import { automaticNote, currentOption, runsOnEntries, runsOptions, showsChip } from "./RunsOn.tsx";
import type { RunsOnOption, RunsOnState } from "./RunsOn.tsx";

const device: RunsOnOption = { target: "device", name: "This computer", online: true };
const space: RunsOnOption = { target: "space", name: "The Space", online: true };
const home: RunsOnOption = { target: "server", serverId: "srv_home", name: "home-box", online: true };
const off: RunsOnOption = { target: "server", serverId: "srv_off", name: "old-mac", online: false, reason: "Off" };
const state = (o: Partial<RunsOnState> = {}): RunsOnState => ({ private: true, effective: { target: "device" }, options: [device, space, home, off], ...o });

test("the chip is drawn only for a private chat with a choice: a lone computer, a shared chat and nothing loaded draw none", () => {
  assert.equal(showsChip(null), false);
  assert.equal(showsChip(state({ options: [device] })), false, "a lone This computer is no choice");
  assert.equal(showsChip(state({ private: false })), false);
  assert.equal(showsChip(state()), true);
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

test("Runs on leads with Automatic, which says where it lands, and no row says its own name twice", () => {
  const rows = runsOptions(state({ options: [device, space, home] }));
  assert.deepEqual(rows.map((r) => [r.name, r.note ?? null]), [["Automatic", "Now: this computer"], ["This computer", null], ["The Space", null], ["home-box", "Your server"]]);
  assert.ok(rows.every((r) => r.name !== r.note), "the source of the duplicate is gone");
  assert.equal(rows[0]!.online, true, "Automatic can always be picked");
  assert.equal(runsOptions(state({ effective: { target: "server", serverId: "srv_home" } }))[0]!.note, "Now: home-box");
});

test("each computer is its own row: This computer for the one the person is on, the others by name; the pill names another computer", () => {
  const s = {
    private: true, pinned: true, effective: { target: "device" as const, deviceId: "dev_desk" },
    options: [
      { target: "device" as const, deviceId: "dev_mac", current: true, name: "This computer", online: false, reason: "Off" },
      { target: "device" as const, deviceId: "dev_desk", name: "Desk", online: true },
      { target: "space" as const, name: "The Space", online: true },
    ],
  };
  assert.equal(currentOption(s).name, "Desk", "the pinned computer, by its id");
  assert.deepEqual(runsOptions(s).map((o) => [o.key, o.name, o.note ?? "", o.online]), [["auto:", "Automatic", "Now: this computer", true], ["device:dev_mac", "This computer", "Off", false], ["device:dev_desk", "Desk", "Your computer", true], ["space:", "The Space", "", true]]);
  assert.equal(currentOption({ ...s, effective: { target: "device" as const } }).name, "This computer", "a pin that names no computer is the one the person is on");
});

test("Automatic says where it would run now, from the engine's order, whatever the chat is pinned to", () => {
  const options = [
    { target: "device" as const, deviceId: "dev_mac", current: true, name: "This computer", online: false, reason: "Off" },
    { target: "device" as const, deviceId: "dev_imac", name: "Office iMac", online: true },
    { target: "space" as const, name: "The Space", online: true },
  ];
  const pinned = { private: true, pinned: true, effective: { target: "device" as const, deviceId: "dev_mac" }, options };
  assert.equal(automaticNote({ ...pinned, automatic: { target: "device", deviceId: "dev_imac" } }), "Now: Office iMac", "pinned to the Mac that is off; Automatic would use the iMac");
  assert.equal(automaticNote({ ...pinned, automatic: { target: "space" } }), "Now: The Space");
  assert.equal(automaticNote({ ...pinned, automatic: { target: "device", deviceId: "dev_mac" } }), "Now: this computer");
});
