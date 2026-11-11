// Cmd-K finds Settings, its pages and the Console by name (owner walk, 12 Nov 2026: typing "sett" or "settings" said No results). Each opens where its name says; the Console is listed only for
// someone who may open it, and a shell result is never recorded on the server as a search item.
import test from "node:test";
import assert from "node:assert/strict";
import type { LiveQuery } from "../../../../../client/src/index.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { createGateSearch, reachable, shellHits } from "./gate.ts";
import type { GateNav } from "./gate.ts";

function search(viewer?: Parameters<typeof reachable>[1]) {
  const went: { place: string; hash?: string }[] = [];
  const calls: string[] = [];
  const nav: GateNav = { go: (place, hash) => void went.push(hash === undefined ? { place } : { place, hash }), newTab: () => null, flash: () => undefined, setAway: () => undefined, setOnline: () => undefined };
  const idle: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };
  const rt = { principals: idle, screens: { query: () => idle }, connection: { get: () => "online", subscribe: () => () => undefined }, space: { id: "nw", kind: "team", name: "Northwind" }, call: async (cap: string) => { calls.push(cap); return {}; } } as unknown as ShellRuntime;
  const data = createGateSearch({ runtime: rt, nav, state: { away: false, offline: false }, recent: () => [], ...(viewer !== undefined ? { viewer: () => viewer } : {}) });
  return { data, went, calls };
}

test("typing part of Settings finds Settings; a page's name finds the page and opens it in Settings", () => {
  const { data, went, calls } = search();
  const sett = data.local("sett", null);
  assert.equal(sett[0]?.title, "Settings", "sett finds Settings");
  data.open(sett[0]!, { newTab: false });
  const notif = data.local("notifications", null)[0];
  assert.equal(notif?.title, "Notifications", "the page named Notifications comes before Settings, whose line only mentions notifications");
  data.open(notif!, { newTab: false });
  data.open(data.local("password", null).find((h) => h.title === "Privacy and security")!, { newTab: false });
  assert.deepEqual(went, [{ place: "settings" }, { place: "settings", hash: "page=notifications" }, { place: "settings", hash: "page=signin" }]);
  data.recordOpened(notif!);
  assert.deepEqual(calls, [], "a shell result is not recorded as a search item");
  assert.deepEqual(data.local("", null).filter((h) => h.kind === "setting"), [], "an empty search lists none of them");
});

test("the Console is found by an owner and opens the Console; a member, who has no Console, is never offered it", () => {
  const owner = search({ id: "usr_o", consolePages: new Set(["overview", "people", "machines"]) });
  const hit = owner.data.local("console", null).find((h) => h.title === "Console");
  assert.ok(hit, "the owner finds the Console");
  owner.data.open(hit!, { newTab: false });
  assert.deepEqual(owner.went, [{ place: "console" }]);
  const member = search({ id: "usr_m", consolePages: new Set() });
  assert.equal(member.data.local("console", null).some((h) => h.title === "Console"), false, "a member is not offered a Console they cannot open");
  assert.ok(shellHits({}).every((h) => !/\bid\b|shell:/i.test(`${h.title} ${h.snippet ?? ""}`)), "no result reads like an id");
});
