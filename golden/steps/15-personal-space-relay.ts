// Golden flow 15: a Personal Space reached through the relay (spec 2.1, ARCH 5.13). The phone registers as a device of the host computer's Space, its replica converges over sync, the Personal
// matrix refuses what needs a Team Space, and revoking the phone purges its replica. Through the gateway, real tokens; sync is booted live or the flow says why it cannot be.
import assert from "node:assert/strict";
import { issueSessionToken } from "../../host/src/daemon/session.ts";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { FlowSpace, Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_PERSONAL = ["spaces", "devices", "network", "access", "members", "documents"];

/** Why this flow is a todo today (ruling 53). */
export const GAPS: Gap[] = [
  { packet: "P-L1_LIVE", lane: "L1", what: "sync cannot go live: its impl exports 4 of 16 handlers, so a host that boots it is refused; pull, push, snapshot and scope change are unreachable" },
  { packet: "P-L7_LIVE", lane: "L7", what: "the host has no Personal Space: nothing sets space.kind, spaces.matrix is a 'later' stub, and teamOnly is never enforced (no permission.needs_team anywhere in host/src)" },
  { packet: "P-L7b_LIVE", lane: "L7b", what: "the daemon starts no relay endpoint and network.endpoints has no relay entry for the connection manager to pin" },
];

export async function runPersonal(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  let s = undefined as FlowSpace | undefined;
  await trail.step("a Space boots with sync live", async () => { s = await bootFlowSpace([...live, "sync"]); });
  if (!s) {
    await trail.step("the same Space boots with sync as a stub, to check what else is wired", async () => { s = await bootFlowSpace(live); });
    if (!s) return { events: [], trail };
  }
  const synced = trail.lines.some((l) => l.startsWith("ok    a Space boots with sync live"));
  try {
    const space = s!, admin = space.d.token;
    await trail.step("the Space is Personal and says what it cannot do", async () => {
      const m = expectStatus(await space.call("spaces.matrix", admin, {}), 200, "spaces.matrix");
      assert.ok(JSON.stringify(m).includes("Needs a Team Space") || m.kind === "personal", `matrix ${short(m)}`);
    });
    await trail.step("a Team-only call is refused with permission.needs_team", async () => {
      const r = await space.call("members.invites.create", admin, { role: "rol_member", idempotencyKey: "golden-15-invite" });
      assert.equal(r.body?.error?.code, "permission.needs_team", `members.invites.create on a Personal Space: ${r.status} ${short(r.body?.error ?? r.body)}`);
    });
    await trail.step("the endpoint list carries the relay", async () => {
      const e = expectStatus(await space.call("network.endpoints", admin, {}), 200, "network.endpoints").endpoints as { kind: string }[];
      assert.ok(e.some((x) => x.kind === "relay"), `endpoints ${short(e)}`);
    });
    const phone = await trail.step("the phone registers as a device", async () => {
      const out = expectStatus(await space.call("devices.register", admin, { idempotencyKey: "golden-15-phone", person: "usr_olivia", name: "Olivia phone", class: "phone" }), 200, "devices.register");
      return { device: out.device.id as string, token: issueSessionToken(space.d.db!, out.sessionId as string) };
    });
    await trail.step("the phone's replica scope is set and it pulls", async () => {
      const r = await fetch(`${space.d.url}/sync/v1/pull`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${phone!.token}` }, body: JSON.stringify({ cursor: 0, epoch: 0 }) });
      assert.equal(r.status, 200, `sync pull: ${r.status}`);
      assert.ok(synced, "sync is live, so this pull is answered by the real handler");
    }, ["the phone registers as a device"]);
    await trail.step("a document edited on the host reaches the phone", async () => {
      assert.ok(synced, "needs sync live");
      throw new Error("not reachable until sync is live: no document update has been pushed or pulled");
    }, ["the phone's replica scope is set and it pulls"]);
    await trail.step("refusal: the phone cannot revoke the host's other devices", async () => {
      const r = await space.call("devices.revoke", phone!.token, { deviceId: "dev_hostcomputer" });
      assert.ok(r.status >= 400 && r.status < 500, `a phone revoking a device it does not own: ${r.status}`);
    }, ["the phone registers as a device"]);
    await trail.step("revoking the phone ends it", async () => {
      expectStatus(await space.call("devices.revoke", admin, { deviceId: phone!.device }), 200, "devices.revoke");
      const r = await space.call("devices.sessions.list", phone!.token, {});
      assert.equal(r.status, 401, `the phone's token after revoke: ${r.status}`);
    }, ["the phone registers as a device"]);
    return { events: await space.events(), trail };
  } finally { await s?.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runPersonal([]);
  if (trail.failures.length) throw new Error(`flow 15 failed:\n${trail.report()}`);
  return events;
}
