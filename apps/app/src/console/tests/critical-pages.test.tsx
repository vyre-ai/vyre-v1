import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { Backups } from "../pages/Backups.tsx";
import { Devices } from "../pages/Devices.tsx";
import { People, Roles, Grants } from "../pages/Access.tsx";
import { Checker } from "../pages/Checker.tsx";
import { consolePageFor, consolePagesFromNav } from "../../shell/providers/console.tsx";
import { visiblePages } from "../shell/nav.ts";

function data(rows: Record<string, unknown>): ConsoleData {
  const sample = createSampleConsole().data;
  return { ...sample, screens: { ...sample.screens, capQuery: (cap: string) => { const value = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => value }; } } as never };
}
const draw = (element: React.ReactElement, rows: Record<string, unknown>): string => renderToStaticMarkup(<ConsoleDataProvider value={data(rows)}>{element}</ConsoleDataProvider>);

test("Console navigation follows exact server-pruned screen keys", () => {
  const allowed = consolePagesFromNav({ groups: [{ pages: [{ key: "console.overview" }, { key: "console.backups" }] }] });
  const pages = visiblePages(() => true, allowed);
  assert.ok(pages.some((page) => page.id === "backups"));
  assert.ok(!pages.some((page) => page.id === "people"));
});

test("the Backups page mounts configuration and real backup verification/restore actions", () => {
  const html = draw(<Backups />, { "backup.config_get": { target: { kind: "local", path: "/backups" }, schedule: "0 3 * * *", encrypted: true }, "backup.list": { backups: [{ backupId: "bkp_fixture", at: 1, sizeBytes: 100, seq: 5, kind: "manual", verified: false, target: "local" }] } });
  assert.match(html, /backup-config-save|backup-run/);
  assert.match(html, /verify-bkp_fixture|restore-bkp_fixture/);
  assert.doesNotMatch(html, /backup-restore-confirm|opens here/);
});

test("Devices and access pages mount real object-specific controls instead of generic placeholders", () => {
  assert.match(draw(<Devices />, { "devices.list": { devices: [{ id: "dev_fixture", person: "usr_fixture", name: "Test laptop", class: "desktop", epoch: 1 }] } }), /Test laptop|Revoke/);
  const roles = { roles: [{ id: "rol_fixture", name: "Member", builtIn: true, permissions: [], holders: 1 }] };
  assert.match(draw(<People />, { "access.principals.list": { principals: [] }, "access.roles.list": roles }), /Create invite|console-invite-create/);
  assert.match(draw(<Roles />, { "access.roles.list": roles }), /console-role-rol_fixture/);
  assert.match(draw(<Grants />, { "access.grants.list": { grants: [] } }), /grant-add|Give access/);
  assert.match(draw(<Checker />, {}), /checker-run|Check access/);
});

 test("Console resource drilldown dispatch reaches existing person/agent/actor initial objects",()=>{const person=consolePageFor("people",{personId:"usr_ada"});const agent=consolePageFor("agents",{agentId:"agt_scout"});const actor=consolePageFor("actors",{actorId:"act_tool"});assert.equal((person.props as {initialPersonId:string}).initialPersonId,"usr_ada");assert.equal((agent.props as {initialAgentId:string}).initialAgentId,"agt_scout");assert.equal((actor.props as {initialActorId:string}).initialActorId,"act_tool");const html=draw(person,{"access.principals.list":{principals:[]},"access.roles.list":{roles:[]},"access.principals.get":{principal:{id:"usr_ada",kind:"person",name:"Ada",status:"active",roles:[]}},"spaces.get":{space:{owner:"usr_other"}}});assert.match(html,/person-lifecycle/);assert.match(html,/person-remove-review/);});
