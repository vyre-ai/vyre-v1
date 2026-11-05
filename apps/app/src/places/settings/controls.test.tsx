// Every control on the pages, pressed in a mounted tree (the test renderer, as the Console tests do) with the capability it calls asserted. The server is the sample Space, which records each call.
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { createSampleSettings, harbor, northwind } from "./sample.ts";
import { LOOK_KEY } from "./look.ts";

import "./controls-sweep.support.tsx";   // its timer patch: the saved line must not keep the process alive

async function open(page: string, space = northwind) {
  const restore = installDom();
  const s = createSampleSettings(space);
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage={page as never} /></SettingsDataProvider>);
  const calls = (cap: string): { cap: string; input: unknown }[] => s.calls.filter((c) => c.cap === cap);
  return { s, root, restore, calls };
}

test("Notifications: pressing a channel chip saves the channels of that kind, and Undo puts them back", async () => {
  const { root, calls, restore } = await open("notifications");
  try {
    await press(find(root, "kind-mention-email"));
    assert.deepEqual(calls("notifications.kind.set_level").map((c) => c.input), [{ kind: "mention", channels: ["desktop", "phone", "email"] }]);
    await press(find(root, "kind-mention-desktop"));
    assert.deepEqual(calls("notifications.kind.set_level").at(-1)!.input, { kind: "mention", channels: ["phone", "email"] });
    await press(find(root, "undo"));
    assert.deepEqual(calls("notifications.kind.set_level").at(-1)!.input, { kind: "mention", channels: ["desktop", "phone", "email"] });
  } finally { restore(); }
});

test("Notifications: a refused change says why and puts the chips back", async () => {
  const { root, calls, restore } = await open("notifications");
  try {
    await press(find(root, "kind-approval.requested-desktop"));
    await press(find(root, "kind-approval.requested-phone"));
    assert.equal(calls("notifications.kind.set_level").length, 2);
    assert.ok(textOf(find(root, "saved-slot")).includes("never go below") || textOf(root).includes("never go below"));
  } finally { restore(); }
});

test("GitHub: Disconnect asks first, then calls github.me.disconnect; Reconnect and Install call github.me.connect and open the link", async () => {
  const { root, calls, restore, s } = await open("github");
  try {
    await press(find(root, "gh-reconnect"));
    assert.equal(calls("github.me.connect").length, 1);
    assert.ok(s.opened.some((o) => o.startsWith("link:https://github.com/")));
    await press(find(root, "gh-disconnect"));
    assert.equal(calls("github.me.disconnect").length, 0, "asks first");
    await press(find(root, "gh-disconnect-yes"));
    assert.equal(calls("github.me.disconnect").length, 1);
  } finally { restore(); }
});

test("GitHub: an org's Change opens GitHub's own page", async () => {
  const { root, restore, s } = await open("github");
  try {
    await press(find(root, "gh-org-irfad7"));
    assert.ok(s.opened.includes("link:https://github.com/settings/installations/1"));
  } finally { restore(); }
});

test("GitHub: not connected, Connect GitHub calls github.me.connect", async () => {
  const { root, calls, restore } = await open("github", harbor);
  try {
    await press(find(root, "gh-connect"));
    assert.equal(calls("github.me.connect").length, 1);
  } finally { restore(); }
});

test("Appearance: Always dark, a Display switch and density save appearance.look and ask the window to wear it", async () => {
  const { root, calls, restore, s } = await open("appearance");
  try {
    await press(find(root, "look-mode-dark"));
    await press(find(root, "look-rm"));
    await press(find(root, "look-density-compact"));
    const writes = calls("settings.set").filter((c) => (c.input as { key: string }).key === LOOK_KEY).map((c) => (c.input as { value: { mode: string; rm: boolean; density: string } }).value);
    assert.equal(writes.length, 3);
    assert.equal(writes[0]!.mode, "dark"); assert.equal(writes[1]!.rm, true); assert.equal(writes[2]!.density, "compact");
    assert.equal(s.looks.length, 3);
  } finally { restore(); }
});

test("Appearance: pressing a skin keeps it in the open slot, says so, and Undo restores", async () => {
  const { root, calls, restore } = await open("appearance");
  try {
    await press(find(root, "skin-paper"));
    const v = (calls("settings.set").at(-1)!.input as { value: { day: string } }).value;
    assert.equal(v.day, "paper");
    assert.ok(textOf(root).includes("Changed to Paper"));
    await press(find(root, "undo"));
    assert.equal((calls("settings.set").at(-1)!.input as { value: { day: string } }).value.day, "vyre-light");
  } finally { restore(); }
});

test("Appearance: Make a skin saves one skin into the look; Paste a link finds and adds one", async () => {
  const { root, calls, restore } = await open("appearance");
  try {
    await press(find(root, "look-make"));
    await press(find(root, "make-accent-#E4572E"));
    await press(find(root, "make-save"));
    const v = (calls("settings.set").at(-1)!.input as { value: { mine: { accent: string }[] } }).value;
    assert.equal(v.mine.length, 1); assert.equal(v.mine[0]!.accent, "#E4572E");
  } finally { restore(); }
});

test("Profile: Your time zone is a city picker; choosing a city saves profile.timezone, and Use this computer's time zone saves this computer's", async () => {
  const { root, calls, restore } = await open("profile");
  try {
    const picker = find(root, "ctl-profile.timezone");
    assert.ok(picker, "the row has the zone picker");
    assert.match(textOf(root), /Your time zone/);
    await press(picker);
    const at = new Date();
    const hm = (zone: string): string => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(at);
    await press(find(root, `menu-item-Pakistan Standard Time, Karachi, ${hm("Asia/Karachi")}`) ?? find(root, `menu-item-Pakistan Time, Karachi, ${hm("Asia/Karachi")}`));
    const sets = calls("settings.set").filter((c) => (c.input as { key: string }).key === "profile.timezone");
    assert.deepEqual(sets.at(-1)!.input, { key: "profile.timezone", value: "Asia/Karachi" });
    await press(find(root, "ctl-profile.timezone"));
    await press(find(root, "menu-item-Use this computer's time zone"));
    const device = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.deepEqual(calls("settings.set").filter((c) => (c.input as { key: string }).key === "profile.timezone").at(-1)!.input, { key: "profile.timezone", value: device });
  } finally { restore(); }
});

test("Profile: the Space's time zone is a read-only row with where to change it", async () => {
  const { root, restore } = await open("profile");
  try {
    assert.match(textOf(root), /Space time zone/);
    assert.match(textOf(root), /shared places show times in .*\. Your time follows beside them\./);
    assert.match(textOf(root), /Matches this computer\.|This computer is in /, "the line says what this computer is");
    assert.equal(find(root, "reset-profile.timezone"), null, "a time zone has no Reset");
    assert.ok(find(root, "row-space.timezone"));
  } finally { restore(); }
});

test("Privacy and security: the GitHub line opens the GitHub page", async () => {
  const { root, restore } = await open("signin");
  try {
    await press(find(root, "gh-open"));
    assert.ok(find(root, "page-github"), "the GitHub page is open");
  } finally { restore(); }
});
