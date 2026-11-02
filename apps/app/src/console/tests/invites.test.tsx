// Console > People > Invites: an open invite shows who it is for, its role and when it ends, with New link and Revoke; the sheet asks how long an invite lasts; an emailed invite goes through the
// person's own mailbox and the Space's one send path, and says plainly what happened.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { People } from "../pages/Access.tsx";
import { EXPIRY_CHOICES, emailInvite, sentLine } from "../pages/Invites.tsx";

function data(rows: Record<string, unknown>): ConsoleData {
  const sample = createSampleConsole().data;
  return { ...sample, screens: { ...sample.screens, capQuery: (cap: string) => { const value = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => value }; } } as never };
}
const draw = (rows: Record<string, unknown>): string => renderToStaticMarkup(<ConsoleDataProvider value={data(rows)}><People /></ConsoleDataProvider>);
const roles = { roles: [{ id: "rol_member", name: "Member", builtIn: true, permissions: [], holders: 1 }, { id: "rol_admin", name: "Admin", builtIn: true, permissions: [], holders: 1 }] };
const base = { "access.principals.list": { principals: [] }, "access.roles.list": roles, "access.groups.list": { groups: [] } };
const invite = (id: string, email?: string) => ({ id, role: "rol_admin", groups: [], agents: [], projects: [], channels: [], expiresAt: Date.UTC(2026, 10, 9), createdBy: "usr_owner", state: "open", createdAt: Date.UTC(2026, 10, 2), ...(email ? { email } : {}) });

test("open invites are listed with who, role and end date, each with New link and Revoke; none open shows nothing", () => {
  const html = draw({ ...base, "members.invites.list": { invites: [invite("inv_a", "dana@example.com"), invite("inv_b")], total: 2 } });
  assert.match(html, /console-invites/);
  assert.match(html, /dana@example\.com/);
  assert.match(html, /Invite link/);
  assert.match(html, /Admin · Ends Nov/);
  for (const id of ["inv_a", "inv_b"]) { assert.match(html, new RegExp(`console-invite-again-${id}`)); assert.match(html, new RegExp(`console-invite-revoke-${id}`)); }
  assert.doesNotMatch(draw({ ...base, "members.invites.list": { invites: [], total: 0 } }), /console-invites/);
});

test("an invite lasts 1, 7 or 30 days", () => {
  assert.deepEqual(EXPIRY_CHOICES.map((c) => c.key), ["1", "7", "30"]);
});

test("emailing an invite sends one message from the person's own mailbox through mail.send, with the link in it; no mailbox means nothing is sent", async () => {
  const calls: { cap: string; input: any }[] = [];
  const call = async (cap: string, input: unknown) => {
    calls.push({ cap, input });
    if (cap === "mail.mailbox.list") return { mailboxes: [{ id: "mbx_mine", kind: "personal", address: "olive@acme.test", state: "syncing" }] };
    if (cap === "mail.send") return { status: "queued" };
    throw new Error(cap);
  };
  const line = await emailInvite(call, { to: "dana@example.com", link: "https://acme.vyre.run/join#c=ABCD-EFGH&k=x&fp=ab12", by: "Olive", space: "Acme" });
  assert.equal(line, "Sent to dana@example.com.");
  const sent = calls.find((c) => c.cap === "mail.send")!.input;
  assert.equal(sent.mailboxId, "mbx_mine");
  assert.deepEqual(sent.to, [{ address: "dana@example.com" }]);
  assert.equal(sent.subject, "Olive invited you to Acme on Vyre");
  assert.match(sent.text, /https:\/\/acme\.vyre\.run\/join#c=ABCD-EFGH&k=x&fp=ab12/);
  assert.match(sent.text, /works once and expires/);
  const none = await emailInvite(async (cap) => (cap === "mail.mailbox.list" ? { mailboxes: [] } : Promise.reject(new Error(cap))), { to: "dana@example.com", link: "x", by: "Olive", space: "Acme" });
  assert.equal(none, null);
  assert.equal(sentLine("a@b.c", "held"), "Waiting for approval before it goes to a@b.c.");
  assert.match(sentLine("a@b.c", "failed"), /Could not send/);
});
