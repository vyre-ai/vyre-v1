import test from "node:test";
import assert from "node:assert/strict";
import { filterObjectRows } from "../objects/ObjectList.tsx";
import type { ObjectListRow } from "../objects/ObjectList.tsx";
import { personFilters, personRowFilters } from "../pages/People.tsx";

const person = (id: string, status: string, roles: string[], groups: string[]) => ({ id, kind: "person", name: id, status, roles, groups, createdAt: 1 }) as never;
const people = [person("usr_a", "active", ["rol_member"], ["grp_sales"]), person("usr_b", "active", ["rol_dev"], []), person("usr_c", "suspended", ["rol_member"], ["grp_sales", "grp_support"])];
const roles = [{ id: "rol_member", name: "Member" }, { id: "rol_dev", name: "Developer" }, { id: "rol_unused", name: "Guest" }] as never;
const groups = [{ id: "grp_sales", name: "Sales" }, { id: "grp_support", name: "Support" }, { id: "grp_empty", name: "Empty" }] as never;

test("the person filters offer only statuses, roles and groups that someone has", () => {
  const ids = personFilters(people, roles, groups).map((f) => f.id);
  assert.deepEqual(ids, ["status:active", "status:suspended", "role:rol_member", "role:rol_dev", "group:grp_sales", "group:grp_support"]);
});
test("status, role and group filters narrow together", () => {
  const rows: ObjectListRow[] = people.map((p) => ({ id: (p as { id: string }).id, title: (p as { id: string }).id, filters: personRowFilters(p), actions: [] }));
  const ids = (filters: string[]) => filterObjectRows(rows, "", new Set(filters)).map((r) => r.id);
  assert.deepEqual(ids(["role:rol_member"]), ["usr_a", "usr_c"]);
  assert.deepEqual(ids(["role:rol_member", "status:active"]), ["usr_a"]);
  assert.deepEqual(ids(["role:rol_member", "group:grp_sales", "group:grp_support"]), ["usr_c"]);
  assert.deepEqual(ids([]), ["usr_a", "usr_b", "usr_c"]);
});

test("permissions group by area and sort", async () => {
  const { permissionAreas } = await import("../pages/People.tsx");
  assert.deepEqual(permissionAreas(["records.edit", "agents.manage", "records.create", "console.access"]), [["agents", ["manage"]], ["console", ["access"]], ["records", ["create", "edit"]]]);
});
