// Where a chat runs is read once and kept; a machine that was drained, hit its limits, ran out of room or has room again (machine.changed) drops what was kept, so the next turn reads it again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { consumers } from "../impl.ts";
import { forgetPlacement, placementOf } from "../placement-cache.ts";

test("a cached placement is dropped when a machine changes, and read again on the next turn", async () => {
  forgetPlacement();
  const key = { threadId: "thr_1", agentId: "agt_a", asker: "usr_me" };
  let reads = 0, where: string | undefined = "dev_mac";
  const read = async (): Promise<string | undefined> => { reads++; return where; };
  assert.equal(await placementOf(read, key, 1000), "dev_mac");
  assert.equal(await placementOf(read, key, 2000), "dev_mac");
  assert.equal(reads, 1, "kept");
  const c = consumers["engine.placement_cache"];
  assert.deepEqual(c.on, ["machine.changed"]);
  where = undefined;   // the Mac was drained: the turn goes to the Space
  await c.run();
  assert.equal(await placementOf(read, key, 3000), undefined, "read again after the event");
  assert.equal(reads, 2);
  forgetPlacement();
});

test("a cached answer never ignores room: when a machine fills up or frees, the kept words are read again", async () => {
  const { placementDecide } = await import("../handlers/place.ts");
  forgetPlacement();
  const NOW = 1_760_000_000_000;
  const mac = { id: "dev_mac", class: "desktop", lastSeenAt: NOW - 1000, name: "Dana's MacBook" };
  let room = 70;
  const ctx = Object.assign(Object.create((await import("../fixtures/harness.ts")).harness().ctx as object), {
    now: () => NOW, principal: { kind: "person", id: "usr_dana" },
    call: async (cap: string, input: unknown) => {
      if (cap === "threads.get") return { thread: { kind: "chat", members: [{ kind: "person", id: "usr_dana" }, { kind: "agent", id: "agt_1" }] } };
      if (cap === "agents.get") return { agent: { hasComputer: false } };
      if (cap === "devices.mine") return { devices: [mac] };
      if (cap === "machines.rooms") return { rooms: [{ machineId: "device:dev_mac", score: room, why: "4 of 4 turns" }, { machineId: "space", score: 90, why: "CPU at 5%" }] };
      throw new Error(`unexpected ${cap} ${JSON.stringify(input)}`);
    },
  });
  const key = { threadId: "thr_1", agentId: "agt_1", asker: "usr_dana" };
  const words = (at: number) => placementOf(async () => (await placementDecide(ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" })).placement, key, at);
  assert.equal(await words(1000), "device");
  room = 0;   // her computer reached its turn limit
  assert.equal(await words(2000), "device", "kept: nothing has told the cache yet");
  // the Machines module says so the moment it happens (machine.changed), and the consumer drops the kept words
  await consumers["engine.placement_cache"].run();
  assert.equal(await words(3000), "host", "read again: the turn goes to the Space now");
  room = 70;
  await consumers["engine.placement_cache"].run();
  assert.equal(await words(4000), "device", "and back when it has room");
  forgetPlacement();
});
