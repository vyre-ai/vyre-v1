// Mark unread from one message (threads.mark_unread_from) and Move to project (threads.move), against the frozen contract.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../handlers/index.ts";
import { DANA, INTAKE, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const key = (): string => `mu${++n}`;

test("Mark unread from here puts the read point just before that message, never forward, and a bad number is refused", async () => {
  const hn = harness();
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  for (const body of ["one", "two", "three"]) await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body, idempotencyKey: key() });
  await h["threads.mark_read"]!(hn.ctx, { threadId: dm });
  const call = async (seq: number): Promise<{ unread: number }> => {
    const input = { threadId: dm, seq };
    assert.deepEqual(contractErrors("threads.mark_unread_from", "in", input), []);
    const out = await h["threads.mark_unread_from"]!(hn.ctx, input);
    assert.deepEqual(contractErrors("threads.mark_unread_from", "out", out), []);
    return out;
  };
  assert.deepEqual(await call(2), { unread: 2 }, "message 2 and 3 are new again");
  assert.deepEqual(await call(3), { unread: 2 }, "a later message does not move the point forward");
  assert.deepEqual(await call(1), { unread: 3 });
  let code = "none";
  try { await h["threads.mark_unread_from"]!(hn.ctx, { threadId: dm, seq: 0 }); } catch (e) { code = codeOf(e); }
  assert.equal(code, "validation.bad_input");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("Move to project sets the chat's project for someone who may edit it, refuses someone who may not, and is audited by its contract", async () => {
  const allow = harness({ calls: { "projects.get": () => ({ project: { projectId: "prj_a", recordId: "rec_a", title: "A" } }), "access.check": () => ({ decision: { effect: "allow" } }) } });
  const chat = (await h["chat.start"]!(allow.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const input = { threadId: chat, projectId: "prj_a" };
  assert.deepEqual(contractErrors("threads.move", "in", input), []);
  const out = await h["threads.move"]!(allow.ctx, input);
  assert.deepEqual(contractErrors("threads.move", "out", out), []);
  assert.equal(allow.rows("SELECT recordId FROM chat_thread WHERE id = ?", chat)[0]!["recordId"], "rec_a");
  assert.ok(allow.emitted.some((e) => e.name === "thread.updated"));
  assert.deepEqual(assertEventsConform(allow), []);

  const deny = harness({ calls: { "projects.get": () => ({ project: { projectId: "prj_a", recordId: "rec_a", title: "A" } }), "access.check": () => ({ decision: { effect: "deny" } }) } });
  const other = (await h["chat.start"]!(deny.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  let code = "none";
  try { await h["threads.move"]!(deny.ctx, { threadId: other, projectId: "prj_a" }); } catch (e) { code = codeOf(e); }
  assert.equal(code, "permission.role_lacks_permission");
  assert.equal(deny.rows("SELECT recordId FROM chat_thread WHERE id = ?", other)[0]!["recordId"], null, "nothing was written");
  void DANA;
});
