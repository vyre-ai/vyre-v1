// The sign-in page names the Space by its current name (3 Nov live walk: after the owner named the Space in setup, identity.sign_in_options went on answering its spc_ id until a restart).
// identity.space_name copies a committed rename into the row sign-in options reads; an id or an empty name never replaces a name, and a change that is not the name touches nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers } from "../impl.ts";

function world(profile: string) {
  const rows = new Map<string, string>([["spc_firm", "spc_firm"]]);
  const ctx = {
    space: "spc_firm",
    db: { run: (sql: string, name: string, id: string) => { assert.match(sql, /^UPDATE identity_space SET name = \? WHERE id = \?$/); rows.set(id, name); } },
    call: async (cap: string) => { assert.equal(cap, "spaces.get"); return { space: { id: "spc_firm", name: profile } }; },
  };
  return { ctx, name: () => rows.get("spc_firm") };
}
const run = consumers["identity.space_name"];

test("a rename reaches the sign-in page's name at once", async () => {
  assert.deepEqual(run.on, ["space.updated"]);
  const w = world("My Legal Academy");
  await run.run(w.ctx, { payload: { fields: ["name"], by: "usr_owner" } } as never);
  assert.equal(w.name(), "My Legal Academy");
});

test("an id or an empty name never replaces a name, and a logo change leaves the name alone", async () => {
  for (const profile of ["spc_firm", "  ", "SPC_other"]) {
    const w = world(profile);
    await run.run(w.ctx, { payload: { fields: ["name"] } } as never);
    assert.equal(w.name(), "spc_firm", profile);
  }
  const w = world("Renamed");
  await run.run(w.ctx, { payload: { fields: ["logoFileId"] } } as never);
  assert.equal(w.name(), "spc_firm");
});
