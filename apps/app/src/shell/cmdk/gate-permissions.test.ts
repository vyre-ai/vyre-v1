// Cmd-K offers an action only to a person who can do it: New channel needs channels.create (the same answer the Chats sidebar's + menu uses), so a Guest is not offered a way into a sheet the server will refuse.
import test from "node:test";
import assert from "node:assert/strict";
import type { LiveQuery } from "../../../../../client/src/index.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { createGateSearch } from "./gate.ts";
import type { GateNav } from "./gate.ts";

const idle: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };
const nav: GateNav = {
  go: () => undefined,
  newTab: () => null,
  flash: () => undefined,
  setAway: () => undefined,
  setOnline: () => undefined,
};
const search = (permissions: ReadonlySet<string> | undefined) =>
  createGateSearch({
    runtime: {
      principals: idle,
      screens: { query: () => idle },
      connection: { get: () => "online", subscribe: () => () => undefined },
      space: { id: "nw", kind: "team", name: "Northwind" },
      call: async () => ({}),
      ...(permissions ? { permissions } : {}),
    } as unknown as ShellRuntime,
    nav,
    state: { away: false, offline: false },
    recent: () => [],
  });
const keys = (s: ReturnType<typeof search>) => s.actions("").map((a) => a.key);

test("New channel is offered to a person who holds channels.create, and is absent for one who does not", () => {
  assert.ok(keys(search(new Set(["channels.create"]))).includes("channel.new"));
  assert.ok(!keys(search(new Set(["chats.create"]))).includes("channel.new"), "a Guest: absent, not disabled");
});

test("a server that sends no permission list keeps the action (the person is not judged on nothing)", () => {
  assert.ok(keys(search(undefined)).includes("channel.new"));
});
