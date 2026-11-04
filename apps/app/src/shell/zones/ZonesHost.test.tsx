// The zones the shell gives every place: the Space's from its profile, the person's from their setting, this computer's zone for someone who never set one, and a bad name never gets in.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { flush, installDom, mount, textOf } from "../../../../../ui/src/testing/dom.ts";
import { When } from "../../../../../ui/src/Time/index.tsx";
import { ZonesHost, refreshZones, zonesFrom } from "./ZonesHost.tsx";
import type { ShellRuntime } from "../providers/runtime.tsx";

const NOW = Date.parse("2026-11-05T15:00:00Z");
const NINE = Date.parse("2026-11-06T17:00:00Z");

test("zonesFrom: a person's own zone when they set one, this computer's when they did not, and an unknown Space zone falls to theirs", () => {
  assert.deepEqual(zonesFrom("America/Los_Angeles", { value: "Asia/Karachi", source: "person" }, "Europe/London"), { space: "America/Los_Angeles", viewer: "Asia/Karachi" });
  assert.deepEqual(zonesFrom("America/Los_Angeles", { value: "UTC", source: "default" }, "Europe/London"), { space: "America/Los_Angeles", viewer: "Europe/London" });
  assert.deepEqual(zonesFrom(undefined, undefined, "Europe/London"), { space: "Europe/London", viewer: "Europe/London" });
  assert.deepEqual(zonesFrom("Mars/Olympus", { value: "Asia/Karachi", source: "person" }, "Europe/London"), { space: "Asia/Karachi", viewer: "Asia/Karachi" });
  assert.deepEqual(zonesFrom("America/Los_Angeles", { value: "Not/AZone", source: "person" }, "Europe/London"), { space: "America/Los_Angeles", viewer: "Europe/London" });
});

test("the host reads the Space zone and the person's, shows the time in both, and reads again when told", async () => {
  installDom();
  let space = "America/Los_Angeles";
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "spaces.get") return { space: { timezone: space } };
    if (cap === "settings.get") return { row: { key: "profile.timezone", value: "Asia/Karachi", source: "person" } };
    throw new Error(cap);
  };
  const rt = { call } as unknown as ShellRuntime;
  const root = await mount(createRoot, <ZonesHost rt={rt}><When at={NINE} now={NOW} testID="w" /></ZonesHost>);
  await flush();
  assert.equal(textOf(root).replace(/\s+/g, " ").trim(), "Tomorrow 9:00 AM (10:00 PM your time)");
  space = "Asia/Karachi";
  refreshZones();
  await flush();
  assert.equal(textOf(root).replace(/\s+/g, " ").trim(), "Tomorrow 10:00 PM", "the Space moved to the viewer's own zone: one reading");
});
