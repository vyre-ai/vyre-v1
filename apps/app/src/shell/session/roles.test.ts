import test from "node:test";
import assert from "node:assert/strict";
import { holdsRole, railConsole, roleAsksServer, roleOpensConsole } from "./session.ts";
import { kitById, phoneMore, railFor, railPlaces } from "../rail/kits.ts";

test("a role is matched by the id the server sends, so an owner or admin really gets the Console and a member does not", () => {
  for (const form of ["rol_owner", "Owner", "owner"]) assert.equal(holdsRole([form], "owner", "admin"), true, form);
  assert.equal(holdsRole(["rol_member", "rol_admin"], "owner", "admin"), true);
  assert.equal(holdsRole(["rol_developer"], "owner", "admin"), false);
  assert.equal(holdsRole(["rol_member"], "owner", "admin"), false);
  assert.equal(holdsRole([], "owner"), false);
});

test("whoever holds console.access gets the rail button: a developer does, a plain member does not, and a role the Space made is the server's to answer", () => {
  for (const form of ["rol_developer", "Developer", "developer"]) assert.equal(roleOpensConsole([form]), true, form);
  assert.equal(roleOpensConsole(["rol_member"]), false);
  assert.equal(roleAsksServer(["rol_member"]), false, "a plain member is not asked for: the call would only be refused");
  assert.equal(roleAsksServer(["rol_guest"]), false);
  assert.equal(roleAsksServer(["rol_owner", "rol_billing"]), false, "already yes");
  assert.equal(roleAsksServer(["rol_member", "rol_billing"]), true);
});

test("a plain Member or Guest in a Team Space is known to hold no Console, connector or schema rights, so nothing asks for them; any other role, or a Personal Space, is not", async () => {
  const { plainRoleOnly } = await import("./session.ts");
  assert.equal(plainRoleOnly(["rol_member"], "team"), true);
  assert.equal(plainRoleOnly(["Guest"], "team"), true);
  assert.equal(plainRoleOnly(["rol_member", "rol_guest"], "team"), true);
  assert.equal(plainRoleOnly(["rol_member", "rol_billing"], "team"), false, "a role the Space made is the server's to answer");
  assert.equal(plainRoleOnly(["rol_owner"], "team"), false);
  assert.equal(plainRoleOnly([], "team"), false, "unknown roles ask");
  assert.equal(plainRoleOnly(["rol_member"], "personal"), false);
});

test("the Console's rail button stays role-gated (owner ruling, 3 Nov): a plain member never sees it and is never asked for it; owners and admins see it on desktop widths only", async () => {
  let asked = 0;
  const ask = async (): Promise<boolean> => { asked += 1; return true; };
  const rail = async (roles: string[]) => railFor({ kit: kitById("northwind"), console: await railConsole(roles, ask), counts: {}, dots: {}, active: "chats" });
  for (const roles of [["rol_member"], ["Member"], ["rol_guest"], ["rol_member", "rol_guest"], []]) {
    assert.ok(!railPlaces(await rail(roles)).includes("console"), roles.join() || "no roles");
  }
  assert.equal(asked, 0, "a plain member's rail never asks the server");
  for (const roles of [["rol_owner"], ["rol_admin"], ["Admin"]]) {
    const groups = await rail(roles);
    assert.ok(railPlaces(groups).includes("console"), roles.join());
    assert.ok(!phoneMore(groups).some((e) => e.place === "console"), "never on a phone");
  }
  assert.equal(await railConsole(["rol_member", "rol_billing"], async () => false), false, "a role the Space made is the server's answer");
  assert.equal(await railConsole(["rol_member", "rol_billing"], () => Promise.reject(new Error("refused"))), false);
  assert.equal(await railConsole(["rol_member", "rol_billing"], async () => true), true);
});
