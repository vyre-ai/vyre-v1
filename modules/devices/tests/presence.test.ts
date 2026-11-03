// Presence and last seen (owner D23, 3 Nov: on, a steady dot, Appear away). The app touches a device on activity; teammates read devices.presence: online inside five minutes,
// away when the person set it (notifications.away.who), offline otherwise. A touch inside thirty seconds writes nothing; coming back after four hours asks home for the digest.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/db.ts";
import type { DevicesCtx } from "../projections.ts";

type Calls = { cap: string; input: unknown }[];
const withCall = (ctx: DevicesCtx, calls: Calls, away: { person: string; until: number }[] = []): DevicesCtx =>
  ({ ...ctx, call: async (cap: string, input: unknown) => { calls.push({ cap, input }); return cap === "notifications.away.who" ? { people: away } : { digestId: "dgs_x", items: 1 }; } }) as unknown as DevicesCtx;

test("touch moves last seen on the caller's own device, at most every thirty seconds, and never a stranger's", async () => {
  const h = harness();
  const mac = await handlers["devices.register"](h.host(), { person: "usr_maya", name: "Maya's Mac", class: "desktop" });
  await handlers["devices.register"](h.host(), { person: "usr_omar", name: "Omar's laptop", class: "desktop" });
  const calls: Calls = [];
  h.advance(10 * 60_000);
  const maya = withCall(h.as("usr_maya", { device: mac.device.id }), calls);
  const first = await handlers["devices.touch"](maya, {});
  assert.ok(first.lastSeenAt! > 0 && first.back === undefined, "ten minutes is not an absence");
  h.advance(10_000);
  const quiet = await handlers["devices.touch"](maya, {});
  assert.equal(quiet.lastSeenAt, first.lastSeenAt, "inside thirty seconds nothing is written");
  const mine = await handlers["devices.mine"](h.as("usr_maya", { device: mac.device.id }), {});
  assert.equal(mine.devices[0]!.lastSeenAt, first.lastSeenAt, "Settings shows it");
  await assert.rejects(handlers["devices.touch"](withCall({ ...h.as("usr_omar"), depth: 0 }, calls), { deviceId: mac.device.id }), "a stranger's device reads as missing");
  assert.equal(calls.filter((c) => c.cap === "home.away_digest").length, 0);
});

test("coming back after four hours asks home to write the digest for the time away", async () => {
  const h = harness();
  const mac = await handlers["devices.register"](h.host(), { person: "usr_maya", name: "Maya's Mac", class: "desktop" });
  const at = (await handlers["devices.mine"](h.as("usr_maya", { device: mac.device.id }), {})).devices[0]!.lastSeenAt!;
  const calls: Calls = [];
  h.advance(5 * 3_600_000);
  const out = await handlers["devices.touch"](withCall(h.as("usr_maya", { device: mac.device.id }), calls), {});
  assert.equal(out.back, true);
  assert.deepEqual(calls.filter((c) => c.cap === "home.away_digest").map((c) => c.input), [{ since: at }]);
});

test("presence: online, away and offline as a teammate sees them", async () => {
  const h = harness();
  const mac = await handlers["devices.register"](h.host(), { person: "usr_maya", name: "Maya's Mac", class: "desktop" });
  await handlers["devices.register"](h.host(), { person: "usr_omar", name: "Omar's laptop", class: "desktop" });
  const calls: Calls = [];
  const omar = (away: { person: string; until: number }[] = []) => withCall(h.as("usr_omar"), calls, away);
  const state = async (away: { person: string; until: number }[] = []): Promise<Record<string, string>> =>
    Object.fromEntries((await handlers["devices.presence"](omar(away), {})).people.map((p) => [p.personId, p.state]));
  assert.deepEqual(await state(), { usr_maya: "online", usr_omar: "online" }, "both just signed in");
  h.advance(6 * 60_000);
  assert.deepEqual(await state(), { usr_maya: "offline", usr_omar: "offline" }, "quiet for six minutes");
  await handlers["devices.touch"](withCall(h.as("usr_maya", { device: mac.device.id }), calls), {});
  assert.equal((await state())["usr_maya"], "online", "she did something");
  const until = 9_000_000_000_000;
  const out = (await handlers["devices.presence"](omar([{ person: "usr_maya", until }]), {})).people.find((p) => p.personId === "usr_maya")!;
  assert.equal(out.state, "away", "away wins over online: she asked to appear away");
  assert.equal(out.awayUntil, until);
  assert.ok(out.lastSeenAt! > 0, "last seen still shows");
});
