// A Personal Space on several computers (lane l-multidevice) under Automatic, by l-runson's placeTurn: each computer holds the whole Space, so a chat runs on the computer it reached. A phone's
// chat (no computer in use) goes to step 2 and, with no computer linked here, runs on this computer, the awake one the relay sent the phone to. The person's other computers' device rows are
// copies from those computers: a recent last-seen time there must not make this computer hand the turn to one that is not linked here.
import test from "node:test";
import assert from "node:assert/strict";
import { placeTurn } from "../../../agent/src/placement/index.ts";
import type { PlaceDevice } from "../../../agent/src/placement/index.ts";
import { bindRelay } from "../relay.ts";
import { personalDevices } from "../handlers/place.ts";

const copied: PlaceDevice[] = [
  { id: "dev_office_mac", role: "daemon", online: true, engines: ["claude_code"], lastSeen: Date.now() - 5_000, name: "Office iMac" },
  { id: "dev_phone", role: "client", online: true, engines: [], lastSeen: Date.now() },
];
const input = (devices: PlaceDevice[], current?: string) => ({
  thread: { kind: "chat" as const, persons: 1 }, item: { kind: "message" as const }, agent: { hasComputer: false }, engine: "claude_code",
  asker: { devices, ...(current ? { current } : {}), servers: [], runtimeOptIn: false }, space: { shared: false, hostIsAsker: true },
});

test("a phone's chat in a Personal Space runs on the computer the relay sent it to, never on a computer known only from a copied row", () => {
  bindRelay(null);
  const here = personalDevices(false, copied);
  assert.equal(here.every((d) => !d.online), true, "a copied row is not a link");
  assert.deepEqual(placeTurn(input(here, "dev_phone")), { placement: "host", reason: "own_host" });
  // without the guard, the stored last-seen would hand the turn to the office computer, which has no link here to take it
  assert.equal(placeTurn(input(copied, "dev_phone")).placement, "device");
});

test("a Team Space keeps l-runson's own rule, and a host with live links counts them", () => {
  bindRelay(null);
  assert.deepEqual(personalDevices(true, copied), copied);
  bindRelay({ spawn: async () => { throw new Error("no"); }, connected: () => false, secure: () => true, devices: () => [] } as never);
  try { assert.deepEqual(personalDevices(false, copied), copied, "links decide where they exist"); } finally { bindRelay(null); }
});
