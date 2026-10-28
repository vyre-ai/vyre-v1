import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionMatrix, stageRolePermission } from "../pages/Roles.tsx";
import { permissions } from "../../../../../generated/permissions.ts";
const member = {id:"rol_member",name:"Member",builtIn:true,clearance:"internal" as const,assignableToAgents:true,permissions:["records.edit"],holders:2};
const custom = {...member,id:"rol_custom",name:"Reviewers",builtIn:false};
test("permission staging refuses built-ins and preserves all unstaged role permissions", () => {
  assert.equal(stageRolePermission(member,new Map(),"records.delete"),null);
  const staged = stageRolePermission(custom,new Map(),"records.delete")!;
  assert.deepEqual(staged,["records.delete","records.edit"]);
  assert.deepEqual(custom.permissions,["records.edit"]);
  assert.deepEqual(stageRolePermission(custom,new Map([[custom.id,staged]]),"records.edit"),["records.delete"]);
});
test("full matrix uses every catalogue permission, risk labels, role columns and locked built-in cells", () => {
  const html = renderToStaticMarkup(<PermissionMatrix roles={[member,custom]} drafts={new Map()} onChange={() => undefined} onOpen={() => undefined} />);
  for (const permission of permissions) assert.ok(html.includes(`permission-${permission.key}`),permission.key);
  for (const text of ["Member", "Reviewers", "High risk", "Medium risk", "permission-matrix", "checkbox"]) assert.ok(html.includes(text),text);
  assert.match(html,/aria-disabled="true"/);
});
