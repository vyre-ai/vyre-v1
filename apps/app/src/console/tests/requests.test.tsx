// Console > People > Requests: open invites with New link and Revoke, a line saying how many asked for access, Approve and Decline on each request, and New invite opening the one invite flow.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { RequestsPage, askedLine } from "../pages/Requests.tsx";
import { dataWith } from "./sheet-helper.tsx";

const roles = { roles: [{ id: "rol_member", name: "Member", builtIn: true, permissions: [], holders: 1, clearance: "internal", assignableToAgents: false }, { id: "rol_guest", name: "Guest", builtIn: true, permissions: [], holders: 0, clearance: "internal", assignableToAgents: false }] };
const invite = (id: string, email?: string) => ({ id, role: "rol_guest", groups: [], agents: [], projects: [], channels: [], expiresAt: Date.UTC(2026, 10, 9), createdBy: "usr_owner", state: "open", createdAt: Date.UTC(2026, 10, 2), ...(email ? { email } : {}) });
const asked = (id: string, requester: string) => ({ id, requester, resource: { type: "space", id: "spc_1" }, level: "view", state: "waiting", taskId: `tsk_${id}`, at: Date.UTC(2026, 10, 3) });
const rows = {
  "access.roles.list": roles, "access.groups.list": { groups: [] },
  "members.invites.list": { invites: [invite("inv_a", "dana@example.com"), invite("inv_b")], total: 2 },
  "access.requests.list": { requests: [asked("req_a", "usr_maya")], total: 1 },
};

async function page(extraRows: Record<string, unknown> = {}) {
  const calls: { cap: string; input: any }[] = [];
  const call = async (cap: string, input: unknown) => { if (!cap.endsWith(".get")) calls.push({ cap, input }); /* name lookups are not actions */ return cap === "members.invites.create" ? { invite: invite("inv_new"), link: "https://x.vyre.run/join#c=A" } : {}; };
  const restore = installDom();
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({ ...rows, ...extraRows }, { call: call as never })}><RequestsPage /></ConsoleDataProvider>);
  return { root, calls, restore };
}

test("the line above the page counts the people who asked", () => {
  assert.equal(askedLine(0), null);
  assert.equal(askedLine(1), "1 person asked for access");
  assert.equal(askedLine(3), "3 people asked for access");
});

test("open invites list with role and end date, and Revoke asks first then calls members.invites.revoke", async () => {
  const { root, calls, restore } = await page();
  try {
    const text = textOf(root);
    assert.match(text, /dana@example\.com/);
    assert.match(text, /Guest · Ends Nov/);
    assert.ok(find(root, "console-invite-again-inv_a") && find(root, "console-invite-revoke-inv_b"));
    assert.match(text, /1 person asked for access/);
    await press(find(root, "console-invite-revoke-inv_a"));
    assert.equal(calls.length, 0, "nothing is revoked before it is confirmed");
    await press(find(root, "console-invite-revoke-confirm"));
    assert.deepEqual(calls.map((c) => c.cap), ["members.invites.revoke"]);
    assert.deepEqual(calls[0]!.input, { inviteId: "inv_a" });
  } finally { restore(); }
});

test("New link replaces an invite: it revokes the old one and makes the same invite again, showing the new link", async () => {
  const { root, calls, restore } = await page();
  try {
    await press(find(root, "console-invite-again-inv_a"));
    assert.deepEqual(calls.map((c) => c.cap), ["members.invites.revoke", "members.invites.create"]);
    assert.equal(calls[1]!.input.role, "rol_guest");
    assert.equal(calls[1]!.input.email, "dana@example.com");
    assert.match(textOf(root), /https:\/\/x\.vyre\.run\/join#c=A/);
  } finally { restore(); }
});

test("Approve calls access.requests.approve with the request and the level asked for", async () => {
  const { root, calls, restore } = await page();
  try {
    assert.match(textOf(root), /Wants view access/);
    await press(find(root, "request-approve-req_a"));
    assert.deepEqual(calls.map((c) => c.cap), ["access.requests.approve"]);
    assert.deepEqual(calls[0]!.input, { requestId: "req_a", level: "view" });
  } finally { restore(); }
});

test("Decline calls access.requests.decline with the request", async () => {
  const { root, calls, restore } = await page();
  try {
    await press(find(root, "request-decline-req_a"));
    assert.deepEqual(calls.map((c) => c.cap), ["access.requests.decline"]);
    assert.deepEqual(calls[0]!.input, { requestId: "req_a" });
  } finally { restore(); }
});

test("with no one waiting the line is gone and the list says so; with no invites the page says so", async () => {
  const { root, restore } = await page({ "access.requests.list": { requests: [] }, "members.invites.list": { invites: [], total: 0 } });
  try {
    const text = textOf(root);
    assert.ok(!find(root, "requests-asked"));
    assert.match(text, /No one is waiting/);
    assert.match(text, /No open invites/);
  } finally { restore(); }
});

test("New invite opens the invite sheet, and Create invite calls members.invites.create with the role and the days", async () => {
  const { root, calls, restore } = await page();
  try {
    assert.ok(!find(root, "invite-sheet"));
    await press(find(root, "newinvite"));
    assert.ok(find(root, "invite-sheet"), "the sheet opens");
    await press(find(root, "sheet-submit"));
    const made = calls.find((c) => c.cap === "members.invites.create");
    assert.ok(made, "the invite is created");
    assert.equal(made!.input.role, "rol_member");
    assert.equal(made!.input.expiresInDays, 7);
    assert.match(textOf(root), /https:\/\/x\.vyre\.run\/join#c=A/);
  } finally { restore(); }
});
