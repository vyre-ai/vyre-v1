// "Made for me, usable by the maker" (owner rule, 14 Nov 2026). What an agent made for the person it acts for is that person's; the same agent, acting for the same person, holds the person's own level on it
// (read, change, remove) with no grant of its own, even where the thing sits in a private root the Space's access never reaches. Nobody else gains anything: not another agent, not the same agent acting for someone
// else, not for what a person only holds (handing out access), not for Vault items or identities. The person's own access stays the ceiling.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/authorize/index.ts";
import { buildWorld, NOW, AGENT } from "../src/authorize/fixture.ts";

const act = (level: "view" | "use" | "edit" | "manage") => ({ perm: null, level }) as const;

test("an agent keeps the person's own level on what it made for them, and nobody gains from it", () => {
  let worlds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (
      snap.info("p1")?.p.status !== "active" ||
      snap.info("p2")?.p.status !== "active" ||
      snap.info(AGENT)?.p.status !== "active"
    )
      continue;
    worlds++;
    // a thing in a private root (no parent): only its owner reaches it, until someone is given it
    snap.putResource({
      id: "site_made",
      type: "site",
      parent_id: null,
      label: 0,
      owner_id: "p1",
      holds: 0,
      made_by: AGENT,
    });
    snap.putResource({ id: "site_own", type: "site", parent_id: null, label: 0, owner_id: "p1", holds: 0 });
    snap.putResource({
      id: "site_other",
      type: "site",
      parent_id: null,
      label: 0,
      owner_id: "p1",
      holds: 0,
      made_by: "someone_else",
    });
    snap.putResource({
      id: "vit_made",
      type: "vault_item",
      parent_id: null,
      label: 0,
      owner_id: "p1",
      holds: 0,
      made_by: AGENT,
    });
    const as = (id: string, type: string, level: "view" | "use" | "edit" | "manage", acting = "p1", cap?: string) =>
      authorize(snap, {
        principal: AGENT,
        actingFor: acting,
        action: act(level),
        resource: { type, id },
        ...(cap ? { cap } : {}),
        now: NOW,
      }).effect;
    for (const level of ["view", "use", "edit", "manage"] as const)
      assert.equal(as("site_made", "site", level), "allow", `seed ${seed}: the maker may ${level} what it made for p1`);
    // not what it did not make, not what another agent made, not the same thing for a person it did not make it for
    for (const id of ["site_own", "site_other"]) assert.equal(as(id, "site", "view"), "deny", `seed ${seed}: ${id}`);
    assert.equal(as("site_made", "site", "view", "p2"), "deny", `seed ${seed}: acting for someone else`);
    // never what only a person holds, never a Vault item
    assert.equal(as("site_made", "site", "manage", "p1", "access.share"), "deny", `seed ${seed}: handing out access`);
    assert.equal(
      as("vit_made", "vault_item", "view"),
      "deny",
      `seed ${seed}: a Vault item stays under the Vault's own rules`,
    );
    // the person is the ceiling: with the person's own access taken away, the agent loses it too
    snap.putResource({
      id: "site_gone",
      type: "site",
      parent_id: null,
      label: 0,
      owner_id: "p2",
      holds: 0,
      made_by: AGENT,
    });
    assert.equal(as("site_gone", "site", "view", "p1"), "deny", `seed ${seed}: the person is the ceiling`);
  }
  assert.ok(worlds >= 20, `worlds exercised: ${worlds}`);
});

test("an agent works in its person's own private roots (Personal files, Personal calendar) up to Edit, never Manage, never another person's", () => {
  let worlds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (
      snap.info("p1")?.p.status !== "active" ||
      snap.info("p2")?.p.status !== "active" ||
      snap.info(AGENT)?.p.status !== "active"
    )
      continue;
    worlds++;
    snap.putResource({ id: "fld_p1", type: "folder", parent_id: null, label: 0, owner_id: "p1", holds: 0 });
    snap.putResource({ id: "fld_p1_sub", type: "folder", parent_id: "fld_p1", label: 0, owner_id: "p1", holds: 0 });
    snap.putResource({ id: "cld_p1", type: "calendar", parent_id: null, label: 0, owner_id: "p1", holds: 0 });
    snap.putResource({ id: "fld_p2", type: "folder", parent_id: null, label: 0, owner_id: "p2", holds: 0 });
    const make = (parent: string, type: string, acting = "p1") =>
      authorize(snap, {
        principal: AGENT,
        actingFor: acting,
        action: act("edit"),
        resource: { type, id: null, parent },
        now: NOW,
      }).effect;
    assert.equal(make("fld_p1", "folder"), "allow", `seed ${seed}: a folder in the person's Personal files`);
    assert.equal(make("fld_p1_sub", "file"), "allow", `seed ${seed}: a file below it`);
    assert.equal(make("cld_p1", "event"), "allow", `seed ${seed}: an event on the person's Personal calendar`);
    assert.equal(make("fld_p2", "folder", "p1"), "deny", `seed ${seed}: never in another person's`);
    assert.equal(make("fld_p1", "folder", "p2"), "deny", `seed ${seed}: never for another person`);
    const on = (id: string, type: string, level: "view" | "edit" | "manage") =>
      authorize(snap, { principal: AGENT, actingFor: "p1", action: act(level), resource: { type, id }, now: NOW })
        .effect;
    assert.equal(on("fld_p1_sub", "folder", "edit"), "allow", `seed ${seed}: change inside it`);
    assert.equal(
      on("fld_p1_sub", "folder", "manage"),
      "deny",
      `seed ${seed}: Manage of what it did not make stays with the person`,
    );
  }
  assert.ok(worlds >= 20, `worlds exercised: ${worlds}`);
});
