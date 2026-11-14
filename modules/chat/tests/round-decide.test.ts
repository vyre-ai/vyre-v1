// chat.round.decide (chat gap G57): go with one agent's answer after a message asked several. One quiet "Decided" line, only by the person who asked, only for an agent that answered after the message.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, DRAFTER, failure, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `rd-${++n}`;

async function world() {
  const hn = harness({
    calls: { "agents.get": () => ({ agent: {} }), "search.resolve": () => ({ hit: { title: "Intake Agent" } }) },
  });
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE, DRAFTER], idempotencyKey: key() }))
    .thread.threadId as string;
  const asked = (
    await h["chat.post"]!(hn.ctx, {
      threadId: t,
      body: "@Intake @Drafter which storage?",
      mentions: [
        { kind: "agent", id: INTAKE },
        { kind: "agent", id: DRAFTER },
      ],
      idempotencyKey: key(),
    })
  ).message.messageId as string;
  await h["chat.post"]!(hn.as({ kind: "agent", id: INTAKE }, DANA), {
    threadId: t,
    body: "Object storage.",
    idempotencyKey: key(),
  });
  return { hn, t, asked };
}
const lines = (hn: ReturnType<typeof harness>, t: string) =>
  hn.rows("SELECT body, author FROM chat_message WHERE thread = ? AND kind = 'system'", t);

test("the person who asked goes with an agent that answered: one Decided line, authored by them", async () => {
  const { hn, t, asked } = await world();
  const out = await h["chat.round.decide"]!(hn.ctx, {
    threadId: t,
    messageId: asked,
    agentId: INTAKE,
    idempotencyKey: key(),
  });
  assert.ok(out.messageId);
  assert.deepEqual(
    lines(hn, t).map((r) => [r["body"], r["author"]]),
    [["Decided: Going with Intake's answer", DANA]],
  );
});

test("an agent that has not answered, and a message that is not in the chat, are refused with no line", async () => {
  const { hn, t, asked } = await world();
  assert.equal(
    await failure(() =>
      h["chat.round.decide"]!(hn.ctx, { threadId: t, messageId: asked, agentId: DRAFTER, idempotencyKey: key() }),
    ),
    "validation.bad_input",
  );
  assert.equal(
    await failure(() =>
      h["chat.round.decide"]!(hn.ctx, { threadId: t, messageId: "msg_nope", agentId: INTAKE, idempotencyKey: key() }),
    ),
    "validation.not_found",
  );
  assert.deepEqual(lines(hn, t), []);
});
