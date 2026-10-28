import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { Groups, groupActivityLabel, groupDeleteImpact, mergeGroupRows } from "../pages/Groups.tsx";
import type { ConsoleData } from "../shell/data.tsx";
const custom = {id: "grp_review", name: "Reviewers", members: [{kind: "person" as const, id: "usr_sana"}], managers: [{kind: "person" as const, id: "usr_olivia"}], builtIn: false};
function draw(selected?: string, builtIn = false): string {
  const sample = createSampleConsole().data;
  const rows: Record<string, unknown> = {
    "access.groups.list": {groups: [{...custom, builtIn}], next: "grp_more"},
    "access.groups.get": {group: {...custom, builtIn}, roles: ["rol_member"], grants: []},
    "access.roles.list": {roles: [{id: "rol_member", name: "Member", permissions: ["records.edit"], holders: 1, builtIn: true, assignableToAgents: true, clearance: "internal"}]},
  };
  const data: ConsoleData = {...sample, name: (id) => id === "usr_olivia" ? "Olivia" : "Sana", screens: {...sample.screens, capQuery: (cap: string) => {const state = {status:"ready", data: rows[cap]};return {subscribe: () => () => undefined, getSnapshot: () => state};}} as never};
  return renderToStaticMarkup(<ConsoleDataProvider value={data}><Groups {...(selected ? {initialId:selected} : {})} /></ConsoleDataProvider>);
}
test("Groups mounts shared object list with search, checked filter choices, selection and server pagination", () => {
  const html = draw();
  for (const expected of ["Reviewers", "Search", "group-list", "Load more", "Create group"]) assert.ok(html.includes(expected), expected);
});
test("group deep link mounts standard object tabs and named owner with actions, not a placeholder", () => {
  const html = draw(custom.id);
  for (const expected of ["Reviewers", "Olivia", "Overview", "Access", "Activity", "Members", "Managers", "Rename", "Add members"]) assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /not implemented|opens here/);
  assert.doesNotMatch(draw(custom.id, true), />Rename</);
});
test("destructive impact is based on the selected object; paging merges by identity", () => {
  assert.match(groupDeleteImpact(custom, 3), /1 memberships, 1 manager assignments and 3 direct grants/);
  assert.match(groupDeleteImpact(custom, 3), /cannot be undone/);
  assert.equal(groupActivityLabel("access.roles.assign"), "Role assigned");
  assert.deepEqual(mergeGroupRows([custom], [{...custom,name:"Renamed"}]).map((row) => row.name), ["Renamed"]);
});
