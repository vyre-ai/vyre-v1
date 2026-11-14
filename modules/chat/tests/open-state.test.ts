// threads.open_state: the host's clean-up jobs ask whether a chat still exists and is open. A private chat the system may not read still answers, with nothing but those two facts.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, codeOf, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
const svc = { kind: "service" as const, id: "svc_host" };

test("the system reads a private chat as open, then closed, then gone, and learns nothing else; people and agents are refused", async () => {
  const hn = harness();
  const threadId = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "os1" })).thread
    .threadId as string;
  const system = hn.as(svc);
  await assert.rejects(h["threads.get"]!(system, { threadId }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(await h["threads.open_state"]!(system, { threadId }), { exists: true, closed: false });
  await h["threads.close"]!(hn.ctx, { threadId });
  assert.deepEqual(await h["threads.open_state"]!(system, { threadId }), { exists: true, closed: true });
  await h["threads.reopen"]!(hn.ctx, { threadId });
  await h["threads.delete"]!(hn.ctx, { threadId });
  assert.deepEqual(await h["threads.open_state"]!(system, { threadId }), { exists: false, closed: false });
  assert.deepEqual(await h["threads.open_state"]!(system, { threadId: "thr_never" }), { exists: false, closed: false });
  for (const who of [hn.ctx, hn.person(MAYA), hn.agent(INTAKE)])
    await assert.rejects(h["threads.open_state"]!(who, { threadId }), (e) => codeOf(e) === "permission.no_grant");
});

test("a service a tenant made (an Automation, a form) is refused too: only the host asks", async () => {
  const hn = harness();
  const threadId = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "os2" })).thread
    .threadId as string;
  for (const id of ["svc_form_ab12", `svc_${"a".repeat(32)}`])
    await assert.rejects(
      h["threads.open_state"]!(hn.as({ kind: "service", id }), { threadId }),
      (e) => codeOf(e) === "permission.no_grant",
    );
});
