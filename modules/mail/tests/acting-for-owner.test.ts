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

test("health names a shared inbox that has no owner, in plain words, and stays healthy", async () => {
  const h = harness();
  seedMailbox(h, "mbx_orphan", "orphan@vyre.test", { kind: "shared", ownerId: null });
  seedMailbox(h, "mbx_owned", "owned@vyre.test", { kind: "shared", ownerId: ME });
  const out = await health(h.ctx, {});
  assert.equal(out.state, "healthy");
  assert.equal(out.detail, "1 shared inbox has no owner: orphan@vyre.test. An admin can give it to a person.");
});
