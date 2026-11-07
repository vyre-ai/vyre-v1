import test from "node:test";
import assert from "node:assert/strict";
import { notices } from "../../../shell/noticeslot/model.ts";
import { refusalText, tellIfRefused } from "../tree/refusal.ts";

test("a refused Files action says so in the notice slot, with the Space's reason", async () => {
  tellIfRefused(Promise.reject(new Error("You can't delete this folder")), "Could not move Taxes to Trash");
  await new Promise<void>((r) => setTimeout(r, 0));
  assert.equal(notices.getSnapshot().live[0]?.text, "Could not move Taxes to Trash: You can't delete this folder");
});

test("an action that went through says nothing, and a refusal with no reason still reads as a sentence", async () => {
  const before = notices.getSnapshot().live.length;
  tellIfRefused(Promise.resolve({ ok: true }), "Could not restore it");
  await new Promise<void>((r) => setTimeout(r, 0));
  assert.equal(notices.getSnapshot().live.length, before);
  assert.equal(refusalText("x", "Could not restore it"), "Could not restore it.");
});
