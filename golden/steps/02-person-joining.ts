// Golden flow 2: a person joining (spec 2.1, 2.3, 3.13): invite, accept, keys, first Home checklist, group defaults. Every call goes through the gateway.
// The owner is the daemon's owner bootstrap token (what the installer hands the first admin); the joiner has no account and no token until members.accept answers.
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { FlowSpace } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

/** The modules this flow touches: members and identity (invite, account), devices (the session), access (role and group), spaces (the profile the join page reads and the checklist), home. */
export const LIVE_FOR_JOIN = ["members", "identity", "devices", "access", "spaces", "home"];

/** Opaque key bundle: the server stores ciphertext and never opens it, so any base64 will do. */
const KEYS = { personKeyByPassword: "d3JhcHBlZA==", publicKey: "cHVibGlj", privateKeyWrapped: "d3JhcHBlZA==", spaceKeys: [{ epoch: 0, wrapped: "d3JhcHBlZA==" }] };

/** Why this flow is a todo today (ruling 53: each LIVE packet cannot close until it passes). */
export const GAPS: Gap[] = [];

/** A Space needs an address before it can invite (the join link carries it); a person with server.network sets one. */
export async function setAddress(s: FlowSpace, trail: Trail): Promise<void> {
  await trail.step("the Space has an address for join links", async () => {
    const profile=expectStatus(await s.call("spaces.get",s.d.token,{}),200,"spaces.get").space;
    assert.ok(profile.address?.host,"the fixture server must advertise a configured join-link host");
  });
}

export async function runJoining(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live);
  const trail = new Trail();
  try {
    const owner = s.d.token;
    await setAddress(s, trail);
    const group = await trail.step("owner makes the Sales group", async () => expectStatus(await s.call("access.groups.create", owner, { name: "Sales", idempotencyKey: "golden-2-group" }), 200, "access.groups.create").group.id as string);
    const roleId = await trail.step("the Member role is listed", async () => {
      const roles = expectStatus(await s.call("access.roles.list", owner, {}), 200, "access.roles.list").roles as { id: string; name: string }[];
      const m = roles.find((r) => r.name === "Member");
      assert.ok(m, "access.roles.list has a Member role");
      return m.id;
    });
    const invite = await trail.step("owner invites a Member into Sales", async () => {
      const out = expectStatus(await s.call("members.invites.create", owner, { role: roleId, groups: [group], idempotencyKey: "golden-2-invite" }), 200, "members.invites.create");
      const code = /\/join\/([A-Z0-9-]+)/.exec(out.link as string)?.[1];
      assert.ok(code, `the link carries a code: ${String(out.link)}`);
      return { id: out.invite.id as string, code };
    }, ["owner makes the Sales group", "the Member role is listed"]);
    await trail.step("the join page previews the invite with no token", async () => {
      const p = expectStatus(await s.call("members.invites.preview", null, { code: invite!.code }), 200, "members.invites.preview");
      assert.ok(p.spaceName && p.fingerprint, "the preview names the Space and its key fingerprint");
    }, ["owner invites a Member into Sales"]);
    await trail.step("a wrong code is refused", async () => {
      const r = await s.call("members.accept", null, { code: "ZZZZ-ZZZZ", username: "maya", password: "correct horse battery", deviceName: "Maya's laptop", deviceClass: "web", keys: KEYS });
      assert.ok(r.status >= 400 && r.status < 500, `a wrong code is a 4xx, got ${r.status}`);
    }, ["owner invites a Member into Sales"]);
    const maya = await trail.step("the invited person accepts and gets a session", async () => {
      const out = expectStatus(await s.call("members.accept", null, { code: invite!.code, username: "maya", displayName: "Maya", password: "correct horse battery", deviceName: "Maya's laptop", deviceClass: "web", keys: KEYS }), 200, "members.accept");
      assert.match(out.personId, /^usr_/);
      assert.ok(out.token, "a session token comes back once");
      return { id: out.personId as string, token: out.token as string };
    }, ["owner invites a Member into Sales"]);
    await trail.step("the new session works: whoami names Maya", async () => {
      const w = expectStatus(await s.call("identity.whoami", maya!.token, {}), 200, "identity.whoami");
      assert.equal(w.principal?.id, maya!.id);
    }, ["the invited person accepts and gets a session"]);
    await trail.step("the invite is spent: the same code is refused", async () => {
      const r = await s.call("members.invites.preview", null, { code: invite!.code });
      assert.ok(r.status >= 400 && r.status < 500, `a spent code is a 4xx, got ${r.status}`);
    }, ["the invited person accepts and gets a session"]);
    await trail.step("Maya holds the Member role and sits in Sales", async () => {
      const eff = expectStatus(await s.call("access.principals.effective", owner, { principal: { kind: "person", id: maya!.id } }), 200, "access.principals.effective");
      assert.ok((eff.roles as string[]).includes(roleId!), `roles ${short(eff.roles)} include the Member role`);
      const g = expectStatus(await s.call("access.groups.get", owner, { groupId: group }), 200, "access.groups.get").group;
      assert.ok((g.members as { id: string }[]).some((m) => m.id === maya!.id), "Sales lists Maya");
    }, ["the invited person accepts and gets a session"]);
    await trail.step("Maya's first Home checklist exists", async () => {
      const c = expectStatus(await s.call("home.checklist", maya!.token, {}), 200, "home.checklist");
      assert.equal(c.visible, true);
      assert.equal(c.items.length, 5);
    }, ["the invited person accepts and gets a session"]);
    await trail.step("refusal: a Member cannot invite", async () => {
      const r = await s.call("members.invites.create", maya!.token, { role: roleId, idempotencyKey: "golden-2-refused" });
      assert.equal(r.status, 403, `members.invites.create as a Member: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["the invited person accepts and gets a session"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

/** The harness entry (golden/harness/index.ts fileSteps): runs when every module the flow needs is live in host/modules.json. */
export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runJoining([]);
  if (trail.failures.length) throw new Error(`flow 2 failed:\n${trail.report()}`);
  return events;
}

export interface Joiner { id: string; token: string; username: string; password: string }

/** Joins one person the way flow 2 does (invite as the owner, accept with no token), for the flows that need a real account. Step names carry the label so one trail can hold several. */
export async function joinPerson(s: FlowSpace, trail: Trail, label: string, roleId: string): Promise<Joiner | undefined> {
  const username = label.toLowerCase(), password = "correct horse battery";
  if (!trail.lines.some((l) => l.includes("the Space has an address"))) await setAddress(s, trail);
  const code = await trail.step(`${label} is invited`, async () => {
    const out = expectStatus(await s.call("members.invites.create", s.d.token, { role: roleId, idempotencyKey: `golden-join-${username}` }), 200, "members.invites.create");
    const c = /\/join\/([A-Z0-9-]+)/.exec(out.link as string)?.[1];
    assert.ok(c, `the link carries a code: ${String(out.link)}`);
    return c;
  });
  return trail.step(`${label} accepts`, async () => {
    const out = expectStatus(await s.call("members.accept", null, { code: code!, username, displayName: label, password, deviceName: `${label} laptop`, deviceClass: "web", keys: KEYS }), 200, "members.accept");
    return { id: out.personId as string, token: out.token as string, username, password };
  }, [`${label} is invited`]);
}

/** The member role id, from the roles the module lists. */
export async function memberRole(s: FlowSpace): Promise<string> {
  const roles = expectStatus(await s.call("access.roles.list", s.d.token, {}), 200, "access.roles.list").roles as { id: string; name: string }[];
  const m = roles.find((r) => r.name === "Member");
  if (!m) throw new Error("access.roles.list has no Member role");
  return m.id;
}
