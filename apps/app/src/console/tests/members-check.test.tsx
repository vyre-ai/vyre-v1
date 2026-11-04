// Console > People > Members: the table says Teams, "Invite people" opens the one invite flow, and "Check someone's access" opens the access check inline above the table (Hide access check closes it).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { People } from "../pages/Access.tsx";
import { resolve } from "../shell/sections.ts";
import { dataWith } from "./sheet-helper.tsx";

const rows: Record<string, unknown> = {
  "access.principals.list": { principals: [{ id: "usr_maya", kind: "person", name: "Maya Chen", status: "active", roles: ["rol_member"], groups: ["grp_sales"] }] },
  "access.roles.list": { roles: [{ id: "rol_member", name: "Member", builtIn: true, permissions: [], holders: 1, clearance: "internal", assignableToAgents: false }] },
  "access.groups.list": { groups: [{ id: "grp_sales", name: "Sales", members: [], managers: [], builtIn: false }] },
  "files.folder.search": { folders: [{ folderId: "fld_1", name: "Intake", path: "/Intake" }] },
};
async function page() {
  const calls: { cap: string; input: any }[] = [];
  const call = async (cap: string, input: unknown) => {
    if (!cap.endsWith(".get")) calls.push({ cap, input }); /* name lookups are not actions */
    if (cap === "access.check") return { decision: { effect: "allow", reason: "role_grants_it", steps: [{ text: "Member can view folders", ok: true }] } };
    if (cap === "members.invites.create") return { invite: { id: "inv_n" }, link: "https://x.vyre.run/join#c=A" };
    return {};
  };
  const restore = installDom();
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith(rows, { call: call as never })}><People /></ConsoleDataProvider>);
  return { root, calls, restore };
}

test("the old pages land on their place: the checker on Members, invites on Requests", () => {
  assert.equal(resolve("checker"), "people");
  assert.equal(resolve("invites"), "requests");
});

test("Members says Teams and Invite people, and never Groups or Invite a person", async () => {
  const { root, restore } = await page();
  try {
    const text = textOf(root);
    assert.match(text, /Members/);
    assert.match(text, /Invite people/);
    assert.match(text, /Check someone's access/);
    assert.match(text, /1 team/);
    assert.doesNotMatch(text, /Invite a person|[Gg]roups?\b/);
  } finally { restore(); }
});

test("Check someone's access opens the check above the table and Hide access check closes it", async () => {
  const { root, restore } = await page();
  try {
    assert.ok(!find(root, "console-checker") && find(root, "console-people-list"));
    await press(find(root, "people-check-open"));
    assert.ok(find(root, "console-checker"), "the check is open");
    assert.ok(find(root, "console-people-list"), "the table stays below it");
    assert.ok(!find(root, "people-check-open"), "the open button gives way to the close one");
    assert.match(textOf(root), /Hide access check/);
    await press(find(root, "people-check-close"));
    assert.ok(!find(root, "console-checker"));
    assert.ok(find(root, "people-check-open"));
  } finally { restore(); }
});

test("the access check calls access.check with the person, the resource and the level, and shows the answer", async () => {
  const { root, calls, restore } = await page();
  const me = createSampleConsole().data.me.id;
  try {
    await press(find(root, "people-check-open"));
    await typeInto(find(root, "checker-resource-picker-search"), "Intake");
    await press(find(root, "row-checker-resource-picker-fld_1"));
    await press(find(root, "checker-run"));
    const check = calls.find((c) => c.cap === "access.check");
    assert.ok(check, "access.check is called");
    assert.deepEqual(check!.input, { principal: { kind: "person", id: me }, resource: { type: "folder", id: "fld_1" }, action: { level: "view" } });
    assert.match(textOf(find(root, "checker-decision")), /allow/);
  } finally { restore(); }
});

test("Invite people opens the invite sheet and Create invite calls members.invites.create with the Member role", async () => {
  const { root, calls, restore } = await page();
  try {
    assert.ok(!find(root, "invite-sheet"));
    await press(find(root, "console-invite-open"));
    assert.ok(find(root, "invite-sheet"));
    await press(find(root, "sheet-submit"));
    const made = calls.find((c) => c.cap === "members.invites.create");
    assert.ok(made);
    assert.equal(made!.input.role, "rol_member");
    assert.equal(made!.input.expiresInDays, 7);
    assert.match(textOf(root), /https:\/\/x\.vyre\.run\/join#c=A/);
  } finally { restore(); }
});
