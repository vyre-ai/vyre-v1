// P-GF_03b: a member's access.request opens a task whose actions the tasks module accepts (an unblock task offers resolved and cannot), the owner approves through access.requests.approve,
// which creates the grant and closes the card. Booted daemon, real device tokens through the gateway (rule 27). The same boot also creates a folder (folders.create declares all it emits).
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short } from "./02-space.ts";

test("a member's access.request opens a card the owner approves, which creates the grant", async () => {
  const s = await bootFlowSpace(["access", "members", "files", "devices", "spaces", "tasks"]);
  try {
    const owner = s.signedIn("usr_olivia", "dev_olivia1");
    const noah = s.signedIn("usr_noah", "dev_noah0001");
    const asked = expectStatus(await s.call("access.request", noah, { idempotencyKey: "approve-ask", resource: { type: "channel", id: "chn_general" }, level: "view", note: "I need the general channel" }), 200, "access.request");
    assert.equal(asked.request.state, "waiting", short(asked));
    assert.ok(String(asked.request.taskId).startsWith("tsk_"), `a card was opened: ${short(asked)}`);

    const waiting = expectStatus(await s.call("access.requests.list", owner, {}), 200, "access.requests.list").requests as { id: string; state: string }[];
    assert.ok(waiting.some((r) => r.id === asked.request.id && r.state === "waiting"), `the owner sees the request: ${short(waiting)}`);
    const approved = expectStatus(await s.call("access.requests.approve", owner, { requestId: asked.request.id, level: "view" }), 200, "access.requests.approve");
    assert.equal(approved.grant.resource.id, "chn_general", short(approved));
    assert.deepEqual(approved.grant.subject, { kind: "person", id: "usr_noah" });
    const mine = expectStatus(await s.call("access.requests.list", noah, { mine: true }), 200, "access.requests.list mine").requests as { id: string; state: string }[];
    assert.equal(mine.find((r) => r.id === asked.request.id)?.state, "granted", short(mine));
    const check = expectStatus(await s.call("access.check", owner, { principal: { kind: "person", id: "usr_noah" }, action: { level: "view" }, resource: { type: "channel", id: "chn_general" } }), 200, "access.check");
    assert.equal(check.decision.effect, "allow", short(check));

    const stranger = await s.call("access.requests.approve", noah, { requestId: asked.request.id });
    assert.ok(stranger.status >= 400, `the requester cannot decide their own request: ${stranger.status}`);
    const folder = await s.call("folders.create", owner, { idempotencyKey: "approve-folder", type: "channel", name: "Clients", scope: "space" });
    assert.equal(folder.status, 200, `folders.create answers 200: ${short(folder.body?.error ?? folder.body)}`);
  } finally { await s.stop(); }
});
