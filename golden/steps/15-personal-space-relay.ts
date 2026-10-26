// Golden flow 15: a Personal Space reached through the relay (spec 2.1, ARCH 5.13). The phone registers as a device of the host computer's Space, its replica converges over sync, the Personal
// matrix refuses what needs a Team Space, and revoking the phone purges its replica. Through the gateway, real tokens; sync is booted live or the flow says why it cannot be.
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { FlowSpace, Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";
import { createRelay } from "../../relay/node/server.js";

export const LIVE_FOR_PERSONAL = ["spaces", "devices", "network", "access", "members", "documents", "identity"];

/** Why this flow is a todo today (ruling 53). */
export const GAPS: Gap[] = [
  { packet: "P-H_19 follow-up (w2q)", lane: "L7", what: "the node boots with --space-kind personal and refuses team-only calls with permission.needs_team, but spaces.matrix still answers kind team with every feature available" },
  { packet: "L1 sync docs", lane: "L1", what: "sync.doc.update answers 404 'That document is not here': a document is a synced row (sync_rows) and no capability creates one, so there is nothing for the phone to open" },
];

export async function runPersonal(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  // the host computer reaches the phone through a relay: a relay node on loopback, given to the daemon as --relay (P-L7b_16)
  const relay = createRelay();
  const relayUrl = await relay.listen();
  let s = undefined as FlowSpace | undefined;
  await trail.step("a Space boots with sync live", async () => { s = await bootFlowSpace([...live, "sync"], { spaceKind: "personal", relay: relayUrl }); });
  if (!s) {
    await trail.step("the same Space boots with sync as a stub, to check what else is wired", async () => { s = await bootFlowSpace(live, { spaceKind: "personal", relay: relayUrl }); });
    if (!s) { await relay.close(); return { events: [], trail }; }
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
      // the node dials the relay after it starts; the relay row appears once the control socket is up
      let e: { kind: string; url: string }[] = [];
      for (let i = 0; i < 50; i++) {
        e = expectStatus(await space.call("network.endpoints", admin, {}), 200, "network.endpoints").endpoints as { kind: string; url: string }[];
        if (e.some((x) => x.kind === "relay")) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const r = e.find((x) => x.kind === "relay");
      assert.ok(r, `endpoints ${short(e)}`);
      assert.match(r.url, /#box=[A-Za-z0-9_-]{43}$/, `the relay entry carries the pinned box key: ${r.url}`);
    });
    const phone = await trail.step("the phone pairs with a code from the signed-in device", async () => {
      const made = expectStatus(await space.call("identity.pair_create", admin, { idempotencyKey: "golden-15-pair", purpose: "app" }), 200, "identity.pair_create");
      const out = expectStatus(await space.call("identity.pair_redeem", null, { code: made.code as string, deviceName: "Olivia phone", deviceClass: "phone" }), 200, "identity.pair_redeem");
      assert.equal(out.status, "ok", `pair_redeem ${short(out)}`);
      return { device: out.session.deviceId as string, token: out.session.token as string };
    });
    await trail.step("the phone's replica scope is set and it pulls", async () => {
      const r = await fetch(`${space.d.url}/sync/v1/pull`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${phone!.token}` }, body: JSON.stringify({ cursor: 0, epoch: 0 }) });
      assert.equal(r.status, 200, `sync pull: ${r.status}`);
      assert.ok(synced, "sync is live, so this pull is answered by the real handler");
    }, ["the phone pairs with a code from the signed-in device"]);
    await trail.step("a document edited on the host reaches the phone", async () => {
      assert.ok(synced, "needs sync live");
      const doc = "not_golden15";
      const update = Buffer.from([0, 0]).toString("base64");   // an empty Yjs update: the server appends what an accepted device sends
      const sent = expectStatus(await space.call("sync.doc.update", admin, { doc, update }), 200, "sync.doc.update");
      assert.ok(sent.seq >= 1, `update ${short(sent)}`);
      const opened = expectStatus(await space.call("sync.doc.open", phone!.token, { doc }), 200, "sync.doc.open");
      assert.ok((opened.updates as string[]).includes(update) || opened.snapshot, `the phone opens the host's update: ${short(opened)}`);
    }, ["the phone's replica scope is set and it pulls"]);
    await trail.step("refusal: the phone cannot revoke the host's other devices", async () => {
      const r = await space.call("devices.revoke", phone!.token, { deviceId: "dev_hostcomputer" });
      assert.ok(r.status >= 400 && r.status < 500, `a phone revoking a device it does not own: ${r.status}`);
    }, ["the phone pairs with a code from the signed-in device"]);
    await trail.step("revoking the phone ends it", async () => {
      expectStatus(await space.call("devices.revoke", admin, { deviceId: phone!.device }), 200, "devices.revoke");
      const r = await space.call("devices.sessions.list", phone!.token, {});
      assert.equal(r.status, 401, `the phone's token after revoke: ${r.status}`);
    }, ["the phone pairs with a code from the signed-in device"]);
    return { events: await space.events(), trail };
  } finally { await s?.stop(); await relay.close(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runPersonal([]);
  if (trail.failures.length) throw new Error(`flow 15 failed:\n${trail.report()}`);
  return events;
}
