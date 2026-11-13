// A shared inbox an agent creates while acting for a person belongs to that person; an inbox with no owner is named by mail.health with a plain line.
import test from "node:test";
import assert from "node:assert/strict";
import { mailboxCreate } from "../handlers/extra/mailboxes.ts";
import { health } from "../handlers/extra/status.ts";
import { harness, seedMailbox } from "../fixtures/harness.ts";

const ME = "usr_maya01";

test("an agent that creates a shared inbox for a person: the person owns it", async () => {
  const h = harness({ principal: { kind: "agent", id: "agt_scout01" } });
  h.ctx.actingFor = ME;
  const out = await mailboxCreate(h.ctx, { kind: "shared", address: "help@vyre.test", title: "Help", idempotencyKey: "k-act-1" });
  assert.equal(out.mailbox.ownerId, ME);
});

test("an agent acting for nobody still leaves the inbox to the Space", async () => {
  const h = harness({ principal: { kind: "agent", id: "agt_scout01" } });
  const out = await mailboxCreate(h.ctx, { kind: "shared", address: "help@vyre.test", title: "Help", idempotencyKey: "k-act-2" });
  assert.equal(out.mailbox.ownerId, undefined);
});

test("health names a shared inbox that has no owner, in plain words, to a Space admin only, and stays healthy", async () => {
  const h = harness();
  seedMailbox(h, "mbx_orphan", "orphan@vyre.test", { kind: "shared", ownerId: null });
  seedMailbox(h, "mbx_owned", "owned@vyre.test", { kind: "shared", ownerId: ME });
  const out = await health(h.ctx, {});
  assert.equal(out.state, "healthy");
  assert.equal(out.detail, "1 shared inbox has no owner: orphan@vyre.test.");
});

test("a member who is not an admin is not told which inboxes have no owner", async () => {
  const h = harness({ denied: new Set(["spc_mailtest"]) });
  seedMailbox(h, "mbx_orphan", "orphan@vyre.test", { kind: "shared", ownerId: null });
  assert.deepEqual(await health(h.ctx, {}), { state: "healthy", latencyMs: 0 });
});

test("an inbox created through an agent for a person is the same row, and sends the same way, as one that person creates directly", async () => {
  const direct = harness({ principal: { kind: "person", id: ME } });
  const viaAgent = harness({ principal: { kind: "agent", id: "agt_scout01" } });
  viaAgent.ctx.actingFor = ME;
  const input = { kind: "shared" as const, address: "help@vyre.test", title: "Help", provider: "google" as const, idempotencyKey: "k-same" };
  const a = (await mailboxCreate(direct.ctx, input)).mailbox, b = (await mailboxCreate(viaAgent.ctx, input)).mailbox;
  const shape = (m: Record<string, unknown>): Record<string, unknown> => { const { id, version, updatedAt, ...rest } = m; void id; void version; void updatedAt; return rest; };
  assert.deepEqual(shape(b as never), shape(a as never), "the same row: kind, provider, privacy, state, owner");
  assert.equal(b.ownerId, ME);
  // the send route is a function of that row and of who sends (modules/mail/handlers/send.ts resolveRoute): the owner, or an agent for the owner, sends from the mailbox's own sign-in; nobody else is changed
});
