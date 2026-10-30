import test from "node:test";
import assert from "node:assert/strict";
import { DOORS, deviceOf, doorsFor, prefillFor, rememberClaimed, takeTeamNext, wantTeamNext } from "./doors.ts";
import type { NoteStore } from "./doors.ts";

const memory = (): NoteStore => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };

test("three doors in the owner's order", () => {
  assert.deepEqual(DOORS.map((d) => d.title), ["Just me", "I was invited", "My team"]);
});

test("the wish to add a team is read once", () => {
  const s = memory();
  assert.equal(takeTeamNext(s), false);
  wantTeamNext(true, s);
  assert.equal(takeTeamNext(s), true);
  assert.equal(takeTeamNext(s), false, "spent");
});

test("the Team claim pre-fills the name and username from the Personal claim, never for the same Space, never a password", () => {
  const s = memory();
  rememberClaimed({ name: "Dana Reyes", username: "dana", address: "http://127.0.0.1:8421" }, s);
  assert.deepEqual(prefillFor("https://team.example", s), { name: "Dana Reyes", username: "dana" });
  assert.equal(prefillFor("http://127.0.0.1:8421", s), null);
  assert.ok(!JSON.stringify([...Array(1)].map(() => s.getItem("vyre.onboarding.prefill.v1"))).toLowerCase().includes("password"));
  assert.equal(prefillFor("https://x", memory()), null);
  rememberClaimed({ name: "Dana", username: "dana", address: "a" }, s, 1000);
  assert.equal(prefillFor("b", s, 1000 + 3 * 60 * 60 * 1000), null, "an old note is ignored");
});

test("which device a window is, and which doors it offers", () => {
  assert.equal(deviceOf({ desktop: true, mac: true, width: 1440 }), "mac");
  assert.equal(deviceOf({ desktop: true, mac: false, width: 1440 }), "win");
  assert.equal(deviceOf({ desktop: false, mac: true, width: 1440 }), "web");
  assert.equal(deviceOf({ desktop: false, mac: true, width: 390 }), "phone");
  assert.deepEqual(doorsFor("mac").map((d) => d.door), ["me", "invited", "team"]);
  assert.deepEqual(doorsFor("win").map((d) => d.door), ["me", "invited", "team"]);
  assert.deepEqual(doorsFor("web").map((d) => d.door), ["invited", "server"]);
  assert.deepEqual(doorsFor("phone").map((d) => d.door), ["invited", "app"]);
});
