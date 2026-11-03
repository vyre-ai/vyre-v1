// The Console Permissions page's rules without a screen: what a role's cell says, who differs because of an exception (a person's own beats a group's; among peers Allow wins; the Owner
// never differs), what an admin may give, and the five built-in columns with custom roles on request.
import test from "node:test";
import assert from "node:assert/strict";
import { areasOf, columns, differ, endAt, exceptionFor, exceptionLine, mayGive, roleCell } from "./permissions-model.ts";
import type { ExceptionLite, PersonLite, RoleLite } from "./permissions-model.ts";

const role = (id: string, name: string, permissions: string[], builtIn = true): RoleLite => ({ id, name, builtIn, permissions });
const owner = role("rol_owner", "Owner", []), admin = role("rol_admin", "Admin", ["automations.space", "automations.personal"]), dev = role("rol_developer", "Developer", ["automations.space"]);
const member = role("rol_member", "Member", ["automations.personal"]), guest = role("rol_guest", "Guest", []), lead = role("rol_lead", "Lead", ["automations.personal"], false);
const person = (id: string, roles: string[], groups: string[] = []): PersonLite => ({ id, name: id, kind: "person", status: "active", roles, groups });
const ex = (id: string, subject: ExceptionLite["subject"], perms: string[], effect: "allow" | "deny", until?: number): ExceptionLite => ({ exceptionId: id, subject, perms, effect, ...(until ? { until } : {}), by: { id: "usr_o", name: "Irfad Imtiaz" }, at: Date.UTC(2026, 10, 3) });
const NOW = Date.UTC(2026, 10, 3, 12);

test("a role's cell: the Owner is always Allowed; a role without the permission reads Ask an admin, a Guest Not allowed", () => {
  assert.equal(roleCell(owner, "anything"), "allow");
  assert.equal(roleCell(member, "automations.personal"), "allow");
  assert.equal(roleCell(member, "automations.space"), "ask");
  assert.equal(roleCell(guest, "automations.personal"), "no");
});

test("the five built-in roles are the columns, in order; custom roles follow when asked for", () => {
  assert.deepEqual(columns([lead, guest, member, owner, dev, admin], false).map((r) => r.name), ["Owner", "Admin", "Developer", "Member", "Guest"]);
  assert.deepEqual(columns([lead, guest, member, owner, dev, admin], true).map((r) => r.name), ["Owner", "Admin", "Developer", "Member", "Guest", "Lead"]);
});

test("who differs: a person's own exception beats a group's, Allow wins among peers, an ended one does not count, the Owner never differs", () => {
  const omar = person("omar", ["rol_member"], ["grp_delivery"]), lena = person("lena", ["rol_member"], ["grp_delivery"]), dana = person("dana", ["rol_member"]), boss = person("irfad", ["rol_owner"], ["grp_delivery"]);
  const list = [
    ex("x1", { kind: "group", id: "grp_delivery", name: "Delivery" }, ["automations.space"], "allow"),
    ex("x2", { kind: "person", id: "lena", name: "Lena" }, ["automations.space"], "deny"),
    ex("x3", { kind: "person", id: "dana", name: "Dana" }, ["automations.space"], "allow", NOW - 1000),
    ex("x4", { kind: "person", id: "irfad", name: "Irfad" }, ["automations.space"], "deny"),
  ];
  const d = differ(member, "automations.space", [omar, lena, dana, boss], list, NOW);
  assert.deepEqual(d.map((x) => x.person.id), ["omar"], "Omar by his group; Lena's own Deny keeps her at the role's value; Dana's ended");
  assert.equal(exceptionFor(lena, "automations.space", list, NOW)?.exceptionId, "x2");
  assert.deepEqual(differ(owner, "automations.space", [boss], list, NOW), []);
  const both = [ex("a", { kind: "person", id: "omar", name: "Omar" }, ["k"], "deny"), ex("b", { kind: "person", id: "omar", name: "Omar" }, ["k"], "allow")];
  assert.equal(exceptionFor(omar, "k", both, NOW)?.effect, "allow", "among peers Allow wins");
});

test("an admin gives only what they hold: Not allowed always, Allowed only on their own permissions", () => {
  const mine = new Set(["automations.personal"]);
  assert.deepEqual(mayGive("deny", ["automations.space"], mine), { ok: true });
  assert.deepEqual(mayGive("allow", ["automations.personal"], mine), { ok: true });
  assert.equal(mayGive("allow", ["automations.space"], mine).ok, false);
});

test("ends and words", () => {
  assert.equal(endAt("none", NOW), undefined);
  assert.equal(endAt("week", NOW), NOW + 7 * 86_400_000);
  assert.ok((endAt("day", NOW) ?? 0) > NOW);
  assert.match(exceptionLine({ ...ex("x", { kind: "person", id: "a", name: "A" }, ["k"], "deny", Date.UTC(2026, 10, 10)), why: "First week" }), /^Exception set by Irfad on 3 Nov, until 10 Nov · First week$/);
  assert.ok(areasOf([{ key: "a.b", area: "space", title: "T", risk: "low" }, { key: "c.d", area: "chats", title: "U", risk: "low" }])[0]!.area === "chats", "areas in the matrix's order");
});
