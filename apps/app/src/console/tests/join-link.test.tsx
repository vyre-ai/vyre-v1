// Console > People > Requests > Request to join: the reusable link. The switch, the copyable address, the role, Rotate (with its confirm), and the people who asked through it with Approve and Decline.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { RequestsPage } from "../pages/Requests.tsx";
import { dataWith } from "./sheet-helper.tsx";

const roles = { roles: [
  { id: "rol_member", name: "Member", builtIn: true, permissions: [], holders: 1, clearance: "internal", assignableToAgents: false },
  { id: "rol_guest", name: "Guest", builtIn: true, permissions: [], holders: 0, clearance: "internal", assignableToAgents: false },
  { id: "rol_owner", name: "Owner", builtIn: true, permissions: [], holders: 1, clearance: "internal", assignableToAgents: false },
] };
const ADDRESS = "https://maya.vyre.run/join/request/K7P2-9QXA#fp=ab12cd34ef567890";
const on = { on: true, role: "rol_guest", waiting: 1, total: 1, address: ADDRESS };
const off = { on: false, role: "rol_guest", waiting: 0, total: 0 };
const ask = (id: string, name: string, email: string, note?: string) => ({ id, name, email, role: "rol_member", state: "waiting", at: Date.UTC(2026, 10, 3), ...(note ? { note } : {}) });
const base = { "access.roles.list": roles, "access.groups.list": { groups: [] }, "members.invites.list": { invites: [], total: 0 }, "access.requests.list": { requests: [], total: 0 } };

async function page(link: unknown, requests: unknown[]) {
  const calls: { cap: string; input: any }[] = [];
  const call = async (cap: string, input: unknown) => {
    if (!cap.endsWith(".get")) calls.push({ cap, input });
    return cap === "members.join_requests.approve" ? { invite: { id: "inv_new" }, link: "https://maya.vyre.run/join/ABCD-EFGH#fp=ab12" } : {};
  };
  const restore = installDom();
  const rows = { ...base, "members.join_link.get": { link }, "members.join_requests.list": { requests, total: requests.length } };
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith(rows, { call: call as never })}><RequestsPage /></ConsoleDataProvider>);
  return { root, calls, restore };
}

test("with the link off the row says what it is for, offers no Copy or Rotate, and the switch calls members.join_link.create as Guest", async () => {
  const { root, calls, restore } = await page(off, []);
  try {
    assert.match(textOf(root), /Reusable request link/);
    assert.match(textOf(root), /Turn this on to get a link anyone can open to ask to join/);
    assert.ok(!find(root, "join-copy") && !find(root, "join-rotate") && !find(root, "join-role"));
    await press(find(root, "join-switch"));
    assert.deepEqual(calls.map((c) => c.cap), ["members.join_link.create"]);
    assert.deepEqual(calls[0]!.input, { role: "rol_guest" });
  } finally { restore(); }
});

test("with the link on the address shows, Joins as names the role, and the switch calls members.join_link.disable", async () => {
  const { root, calls, restore } = await page({ ...on, waiting: 0 }, []);
  try {
    const text = textOf(root);
    assert.ok(text.includes(ADDRESS));
    assert.match(text, /Joins as/);
    assert.ok(!text.includes("Owner"), "ownership is never a role to join as");
    await press(find(root, "join-switch"));
    assert.deepEqual(calls.map((c) => c.cap), ["members.join_link.disable"]);
    assert.deepEqual(calls[0]!.input, {});
  } finally { restore(); }
});

test("Copy link puts the address on the clipboard and says so", async () => {
  const { root, restore } = await page({ ...on, waiting: 0 }, []);
  const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const wrote: string[] = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t: string) => { wrote.push(t); } } }, configurable: true });
  try {
    await press(find(root, "join-copy"));
    assert.deepEqual(wrote, [ADDRESS]);
    assert.match(textOf(root), /Copied\./);
  } finally { if (had) Object.defineProperty(globalThis, "navigator", had); else delete (globalThis as Record<string, unknown>)["navigator"]; restore(); }
});

test("a role picked while the link is on calls members.join_link.create with it; the role already chosen calls nothing", async () => {
  const { root, calls, restore } = await page({ ...on, waiting: 0 }, []);
  try {
    await press(find(root, "seg-rol_guest"));
    assert.equal(calls.length, 0);
    await press(find(root, "seg-rol_member"));
    assert.deepEqual(calls.map((c) => [c.cap, c.input]), [["members.join_link.create", { role: "rol_member" }]]);
    assert.match(textOf(root), /People who ask now join as Member\./);
  } finally { restore(); }
});

test("a role picked while the link is off is kept for when it is turned on", async () => {
  const { root, calls, restore } = await page(off, []);
  try {
    assert.ok(!find(root, "seg-rol_member"), "no picker until the link is on");
    await press(find(root, "join-switch"));
    assert.deepEqual(calls[0]!.input, { role: "rol_guest" });
  } finally { restore(); }
});

test("Rotate asks first ('The old link stops working.'), Cancel does nothing, and Rotate link calls members.join_link.rotate", async () => {
  const { root, calls, restore } = await page({ ...on, waiting: 0 }, []);
  try {
    assert.ok(!find(root, "join-rotate-confirm-box"));
    await press(find(root, "join-rotate"));
    assert.match(textOf(find(root, "join-rotate-confirm-box")), /The old link stops working\./);
    assert.equal(calls.length, 0, "nothing is rotated before it is confirmed");
    await press(find(root, "join-rotate-cancel"));
    assert.ok(!find(root, "join-rotate-confirm-box"));
    assert.equal(calls.length, 0);
    await press(find(root, "join-rotate"));
    await press(find(root, "join-rotate-confirm"));
    assert.deepEqual(calls.map((c) => c.cap), ["members.join_link.rotate"]);
    assert.ok(!find(root, "join-rotate-confirm-box"), "the confirm closes");
    assert.match(textOf(root), /New link made\. The old one no longer works\./);
  } finally { restore(); }
});

test("people who asked through the link are listed with their email, the role and the note; the line above counts them", async () => {
  const { root, restore } = await page(on, [ask("jrq_a", "Dana Lee", "dana@example.com", "From the Tuesday call")]);
  try {
    const text = textOf(root);
    assert.match(text, /Dana Lee/);
    assert.match(text, /dana@example\.com · Asked Nov 3 · Joins as Member · From the Tuesday call/);
    assert.match(text, /1 person asked for access/);
    assert.ok(!text.includes("No one has asked to join"));
  } finally { restore(); }
});

test("Approve calls members.join_requests.approve, then shows the one-time invite link and Done hides it", async () => {
  const { root, calls, restore } = await page(on, [ask("jrq_a", "Dana Lee", "dana@example.com")]);
  try {
    await press(find(root, "join-approve-jrq_a"));
    assert.deepEqual(calls.map((c) => [c.cap, c.input]), [["members.join_requests.approve", { requestId: "jrq_a" }]]);
    assert.match(textOf(root), /Copy this one-time invite link for dana@example\.com:/);
    assert.match(textOf(find(root, "join-approved-link")), /https:\/\/maya\.vyre\.run\/join\/ABCD-EFGH/);
    assert.ok(find(root, "join-approved-link-copy"), "the link has a Copy button: nobody has to select text to share it");
    assert.ok(find(root, "join-approved-mail"), "the link can be emailed");
    await press(find(root, "join-approved-done"));
    assert.ok(!find(root, "join-approved-link"));
  } finally { restore(); }
});

test("Decline calls members.join_requests.decline with the request", async () => {
  const { root, calls, restore } = await page(on, [ask("jrq_a", "Dana Lee", "dana@example.com")]);
  try {
    await press(find(root, "join-decline-jrq_a"));
    assert.deepEqual(calls.map((c) => [c.cap, c.input]), [["members.join_requests.decline", { requestId: "jrq_a" }]]);
    assert.match(textOf(root), /Denied Dana Lee\./);
  } finally { restore(); }
});

test("with the link on and no one asking the section says so; with the link off it stays quiet; requests made before Off still list", async () => {
  const empty = await page({ ...on, waiting: 0 }, []);
  try { assert.match(textOf(empty.root), /No one has asked to join/); } finally { empty.restore(); }
  const quiet = await page(off, []);
  try { assert.ok(!textOf(quiet.root).includes("No one has asked to join")); } finally { quiet.restore(); }
  const left = await page({ ...off, waiting: 1, total: 1 }, [ask("jrq_a", "Dana Lee", "dana@example.com")]);
  try { assert.ok(find(left.root, "join-approve-jrq_a") && find(left.root, "join-decline-jrq_a")); } finally { left.restore(); }
});
