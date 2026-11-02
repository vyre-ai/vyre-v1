import assert from "node:assert/strict";
import { test } from "node:test";
import { publicOriginOf } from "./public-origin.ts";

test("the public origin: a given address wins, a claimed phone name stands in for none, and a phone address says so", () => {
  assert.deepEqual(publicOriginOf("team.example.com", "harbor"), { origin: "https://team.example.com", relay: false });
  assert.deepEqual(publicOriginOf("https://team.example.com/", null), { origin: "https://team.example.com", relay: false });
  assert.deepEqual(publicOriginOf(null, "harbor"), { origin: "https://harbor.vyre.run", relay: true });
  assert.deepEqual(publicOriginOf("harbor.vyre.run", null), { origin: "https://harbor.vyre.run", relay: true });
  assert.equal(publicOriginOf(null, null), null);
});
