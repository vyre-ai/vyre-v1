// When someone leaves for good (hole 10): nobody stays on a list as a ghost, a chat they started gets a new owner, and each chat gets one line.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers } from "../impl.ts";
import { DANA, INTAKE, LEO, MAYA, assertEventsConform, harness } from "../fixtures/harness.ts";

const H = handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<any>>;
let n = 0;
const key = (): string => `k${++n}`;
const names: Record<string, string> = { [DANA]: "Dana", [MAYA]: "Maya", [LEO]: "Leo" };
const world = () => harness({ calls: { "access.principals.get": (i) => ({ principal: { name: names[(i["principal"] as { id: string }).id] } }) } });

async function channel(h: ReturnType<typeof world>): Promise<string> {
  const c = (await H["channels.create"]!(h.person(DANA), { name: `room ${key()}`, visibility: "public", idempotencyKey: key() })).channel;
  for (const p of [MAYA, LEO]) await H["threads.members.add"]!(h.person(DANA), { threadId: c.mainThreadId, personId: p });
  return c.mainThreadId as string;
}
const left = (h: ReturnType<typeof world>, personId: string) => consumers["chat.person_left"].run(h.as({ kind: "service", id: "svc_host" }), { payload: { personId } });
const lines = (h: ReturnType<typeof world>, t: string) => h.rows(`SELECT body FROM chat_message WHERE "thread" = ? AND "kind" = 'system'`, t).map((r) => r["body"]);

test("the person who started a shared chat leaves: the next person owns it, they are off the list, and it says so once", async () => {
  const h = world();
  const t = await channel(h);
  h.clear();
  assert.deepEqual(await left(h, DANA), [t]);
  const row = h.rows(`SELECT "starter" FROM chat_thread WHERE "id" = ?`, t)[0]!;
  assert.equal(row["starter"], MAYA);
  assert.deepEqual(h.rows(`SELECT "principal" FROM chat_thread_member WHERE "thread" = ? AND "deleted_at" IS NULL`, t).map((r) => r["principal"]).sort(), [LEO, MAYA].sort());
  assert.deepEqual(lines(h, t), ["Dana left. Maya now owns this chat."]);
  assert.deepEqual(h.named("thread.updated").map((e) => e.payload["fields"]), [["starter"]], "the engine hears who pays from now on");
  assert.deepEqual(assertEventsConform(h), []);
  assert.deepEqual(await left(h, DANA), [], "a second delivery does nothing");
  assert.equal(lines(h, t).length, 1);
});

test("someone else leaving changes no owner, and a private chat of theirs is left to the removal plan", async () => {
  const h = world();
  const shared = await channel(h);
  const mine = (await H["chat.start"]!(h.person(MAYA), { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  assert.deepEqual(await left(h, MAYA), [shared]);
  assert.equal(h.rows(`SELECT "starter" FROM chat_thread WHERE "id" = ?`, shared)[0]!["starter"], DANA);
  assert.deepEqual(lines(h, shared), ["Maya left."]);
  assert.deepEqual(lines(h, mine), []);
  assert.equal(h.rows(`SELECT "starter" FROM chat_thread WHERE "id" = ?`, mine)[0]!["starter"], MAYA);
});

test("a deleted agent comes off every chat it was in, and the chat keeps one line about it", async () => {
  const h = world();
  const t = (await H["chat.start"]!(h.person(DANA), { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  h.clear();
  assert.deepEqual(await consumers["chat.agent_deleted"].run(h.as({ kind: "service", id: "svc_host" }), { payload: { agentId: INTAKE, name: "Intake" } }), [t]);
  assert.deepEqual((await H["threads.get"]!(h.person(DANA), { threadId: t })).thread.agents, []);
  assert.deepEqual(lines(h, t), ["Intake was deleted."]);
  assert.deepEqual(h.names(), ["agent.disengaged"]);
});
