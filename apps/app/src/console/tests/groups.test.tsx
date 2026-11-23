import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { Groups, MemberRows, groupActivityLabel, groupDeleteImpact, invitedIn, mergeGroupRows, readLaterInvites } from "../pages/Groups.tsx";
import type { ConsoleData } from "../shell/data.tsx";
const custom = {
  id: "grp_review",
  name: "Reviewers",
  members: [{ kind: "person" as const, id: "usr_sana" }],
  managers: [{ kind: "person" as const, id: "usr_olivia" }],
  builtIn: false,
};
function draw(selected?: string, builtIn = false): string {
  const sample = createSampleConsole().data;
  const rows: Record<string, unknown> = {
    "access.groups.list": { groups: [{ ...custom, builtIn }], next: "grp_more" },
    "access.groups.get": { group: { ...custom, builtIn }, roles: ["rol_member"], grants: [] },
    "access.roles.list": {
      roles: [
        {
          id: "rol_member",
          name: "Member",
          permissions: ["records.edit"],
          holders: 1,
          builtIn: true,
          assignableToAgents: true,
          clearance: "internal",
        },
      ],
    },
  };
  const data: ConsoleData = {
    ...sample,
    name: (id) => (id === "usr_olivia" ? "Olivia" : "Sana"),
    screens: {
      ...sample.screens,
      capQuery: (cap: string) => {
        const state = { status: "ready", data: rows[cap] };
        return { subscribe: () => () => undefined, getSnapshot: () => state };
      },
    } as never,
  };
  return renderToStaticMarkup(
    <ConsoleDataProvider value={data}>
      <Groups {...(selected ? { initialId: selected } : {})} />
    </ConsoleDataProvider>,
  );
}
test("Groups mounts shared object list with search, checked filter choices, selection and server pagination", () => {
  const html = draw();
  for (const expected of ["Reviewers", "Search", "group-list", "Load more", "New team"])
    assert.ok(html.includes(expected), expected);
});
test("group deep link mounts standard object tabs and named owner with actions, not a placeholder", () => {
  const html = draw(custom.id);
  for (const expected of [
    "Reviewers",
    "Olivia",
    "Overview",
    "Access",
    "Activity",
    "Members",
    "Managers",
    "Rename",
    "Add members",
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /not implemented|opens here/);
  assert.doesNotMatch(draw(custom.id, true), />Rename</);
});
test("destructive impact is based on the selected object; paging merges by identity", () => {
  assert.match(groupDeleteImpact(custom, 3), /1 membership, 1 manager assignment and 3 extra access entries/);
  assert.match(groupDeleteImpact(custom, 3), /cannot be undone/);
  assert.equal(groupActivityLabel("access.roles.assign"), "Role assigned");
  assert.deepEqual(
    mergeGroupRows([custom], [{ ...custom, name: "Renamed" }]).map((row) => row.name),
    ["Renamed"],
  );
});

const invite = (over: Record<string, unknown>) => ({
  id: "inv_1",
  role: "rol_member",
  groups: ["grp_review"],
  agents: [],
  projects: [],
  channels: [],
  email: "ana@example.test",
  expiresAt: Date.UTC(2026, 11, 1),
  createdBy: "usr_olivia",
  state: "open",
  createdAt: 1,
  ...over,
});
test("people invited into a team show in its member list as Invited, before they accept (only open invites that name the team)", () => {
  const rows = invitedIn(
    [
      invite({}),
      invite({ id: "inv_2", email: undefined }),
      invite({ id: "inv_3", groups: ["grp_other"] }),
      invite({ id: "inv_4", state: "accepted" }),
      invite({ id: "inv_5", state: "revoked" }),
    ] as never,
    "grp_review",
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ["inv_1", "inv_2"],
  );
  const sample = createSampleConsole().data;
  const html = renderToStaticMarkup(
    <ConsoleDataProvider value={{ ...sample, name: () => "Sana" }}>
      <MemberRows
        members={[{ kind: "person", id: "usr_sana" }]}
        invited={rows as never}
        groupId="grp_review"
        refresh={() => undefined}
      />
    </ConsoleDataProvider>,
  );
  assert.ok(html.includes("ana@example.test"), "the invited person is named by their email");
  assert.ok(html.includes("Invited"), "marked Invited");
  assert.ok(html.includes("Invited person"), "an invite with no email still has a row");
  assert.ok(html.includes("Sana"), "members stay");
  assert.doesNotMatch(html, /No members yet/);
  const only = renderToStaticMarkup(
    <ConsoleDataProvider value={{ ...sample, name: () => "Sana" }}>
      <MemberRows members={[]} invited={[]} groupId="grp_review" refresh={() => undefined} />
    </ConsoleDataProvider>,
  );
  assert.match(only, /No members yet/);
});

test("the Members tab reads every open invite, page after page, not only the first hundred (r-review low 2)", async () => {
  const pages: Record<string, { invites: unknown[]; next?: string }> = {
    p2: { invites: [invite({ id: "inv_a" })], next: "p3" },
    p3: { invites: [invite({ id: "inv_b", groups: ["grp_other"] }), invite({ id: "inv_c" })] },
  };
  const asked: unknown[] = [];
  const got = await readLaterInvites(async (_cap, input) => {
    asked.push(input);
    return pages[String(input["cursor"])];
  }, "p2");
  assert.deepEqual(
    got.map((row) => row.id),
    ["inv_a", "inv_b", "inv_c"],
  );
  assert.equal(asked.length, 2);
  assert.deepEqual(
    invitedIn(got, "grp_review").map((row) => row.id),
    ["inv_a", "inv_c"],
  );
});

test("a team with 250 open invites lists all of them: three pages are read, not the first 100", async () => {
  const mk = (from: number, n: number) => Array.from({ length: n }, (_, i) => invite({ id: `inv_${from + i}` }));
  const pages: Record<string, { invites: unknown[]; next?: string }> = {
    c2: { invites: mk(100, 100), next: "c3" },
    c3: { invites: mk(200, 50) },
  };
  const got = await readLaterInvites(async (_cap, input) => pages[String(input["cursor"])], "c2");
  assert.equal(got.length, 150);
  assert.equal(invitedIn([...mk(0, 100), ...got], "grp_review").length, 250);
});
