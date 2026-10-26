// The Space tile and the first-run checklist: a dot appears when a Space needs the person, whichever Space is open.
// @reads ../migrations/0001_spaces.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../impl.ts";
import { STEP_EVENTS, autoComplete } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";
import { MAYA, OMAR } from "../fixtures/seed.ts";

test("every spaces capability has a handler and the migration tables exist", () => {
  assert.equal(Object.keys(handlers).length, 16);
  const sql = readFileSync(new URL("../migrations/0001_spaces.sql", import.meta.url), "utf8");
  for (const t of ["spaces_profile", "spaces_star", "spaces_follow", "spaces_onboarding", "spaces_onboarding_state"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`));
});

test("the tile shows name, kind, role, and the counts that drive the red dot", async () => {
  const h = harness();
  const quiet = await handlers["spaces.switcher"](h.as(MAYA), {});
  assert.deepEqual(quiet, { name: "Northwind", kind: "team", role: "member", needsYou: 0, unread: 0 });

  const waiting = { ...h.as(MAYA), attention: { of: () => ({ needsYou: 2, unread: 5 }) }, directory: { roleName: () => "Admin" } };
  const tile = await handlers["spaces.switcher"](waiting, {});
  assert.equal(tile.needsYou, 2);
  assert.equal(tile.unread, 5);
  assert.equal(tile.role, "Admin");

  h.db.run(`UPDATE spaces_profile SET logo_file_id = 'fil_logo1'`);
  assert.equal((await handlers["spaces.switcher"](h.as(MAYA), {})).logoFileId, "fil_logo1");
});

test("a dot shows for the other Space that needs you, while you work in this one", async () => {
  const north = harness("spc_north", "Northwind", "team");
  const harbor = harness("spc_harbor", "Harbor Studio", "team");
  const personal = harness("spc_me", "Personal", "personal");
  // the client asks each Space server for its own tile; only Harbor has something waiting on Maya
  const tiles = await Promise.all([
    handlers["spaces.switcher"]({ ...north.as(MAYA), attention: { of: () => ({ needsYou: 0, unread: 3 }) } }, {}),
    handlers["spaces.switcher"]({ ...harbor.as(MAYA), attention: { of: () => ({ needsYou: 1, unread: 0 }) } }, {}),
    handlers["spaces.switcher"](personal.as(MAYA), {}),
  ]);
  const dots = tiles.map((t) => t.needsYou > 0);
  assert.deepEqual(dots, [false, true, false]);
  assert.deepEqual(tiles.map((t) => t.kind), ["team", "team", "personal"]);
  // unread alone never makes a dot: only waiting-on-you does, and a Space answers only for itself
  assert.equal(tiles[0]!.unread, 3);
  assert.equal(tiles[0]!.needsYou, 0);
});

test("a tile is for a signed-in person of a Space that has a profile", async () => {
  const h = harness();
  await assert.rejects(handlers["spaces.switcher"](h.anon, {}), (e) => codeOf(e) === "auth.unauthenticated");
  h.db.run(`DELETE FROM spaces_profile`);
  await assert.rejects(handlers["spaces.switcher"](h.as(MAYA), {}), (e) => codeOf(e) === "validation.not_found");
});

test("the checklist lists five steps, completes them once, and dismisses per person", async () => {
  const h = harness();
  const fresh = await handlers["spaces.onboarding.get"](h.as(MAYA), {});
  assert.equal(fresh.dismissed, false);
  assert.deepEqual(fresh.steps.map((s) => s.key), ["photo_title", "connect_mailbox", "meet_assistant", "first_project", "import"]);
  assert.ok(fresh.steps.every((s) => !s.done && s.title.length > 0));

  await handlers["spaces.onboarding.complete"](h.as(MAYA), { step: "meet_assistant" });
  await handlers["spaces.onboarding.complete"](h.as(MAYA), { step: "meet_assistant" });
  assert.equal(h.events.filter((e) => e.name === "onboarding.step_completed").length, 1);
  const after = await handlers["spaces.onboarding.get"](h.as(MAYA), {});
  assert.deepEqual(after.steps.filter((s) => s.done).map((s) => s.key), ["meet_assistant"]);
  await assert.rejects(handlers["spaces.onboarding.complete"](h.as(MAYA), { step: "nonsense" as never }), (e) => codeOf(e) === "validation.bad_input");

  await handlers["spaces.onboarding.dismiss"](h.as(MAYA), {});
  await handlers["spaces.onboarding.dismiss"](h.as(MAYA), {});
  assert.equal(h.events.filter((e) => e.name === "onboarding.dismissed").length, 1);
  assert.equal((await handlers["spaces.onboarding.get"](h.as(MAYA), {})).dismissed, true);
  const omar = await handlers["spaces.onboarding.get"](h.as(OMAR), {});
  assert.equal(omar.dismissed, false);
  assert.ok(omar.steps.every((s) => !s.done));
});

test("steps finish by themselves when their event happens", async () => {
  const h = harness();
  assert.deepEqual(STEP_EVENTS, { "mailbox.connected": "connect_mailbox", "project.created": "first_project", "import.completed": "import" });
  assert.equal(autoComplete(h.as(MAYA), MAYA, STEP_EVENTS["mailbox.connected"]!), true);
  assert.equal(autoComplete(h.as(MAYA), MAYA, "connect_mailbox"), false);
  const steps = (await handlers["spaces.onboarding.get"](h.as(MAYA), {})).steps;
  assert.equal(steps.find((s) => s.key === "connect_mailbox")!.done, true);
});

test("the eight administration capabilities are real in the module's handler map: none answers not implemented any more", async () => {
  const h = harness();
  for (const cap of ["spaces.get", "spaces.update", "spaces.matrix", "spaces.export", "spaces.leave", "spaces.delete", "spaces.transfer_ownership", "spaces.switch_address"] as const) {
    // without the host's drivers they refuse as unavailable (a server that has not given them), never as a later packet
    await assert.rejects(handlers[cap](h.as(MAYA), {} as never), (e) => codeOf(e) !== "internal.not_implemented", cap);
  }
});
