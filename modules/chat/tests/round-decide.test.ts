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
    calls: {
      "agents.get": () => ({ agent: {} }),
      "search.resolve": (i: any) => ({ hit: { title: i.itemId === INTAKE ? "Intake Agent" : "Drafter Agent" } }),
    },
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

test("discuss: the thread under the ask gets one message from the person with both answers, tagging the first agent; one answer is too few", async () => {
  const posted: Array<Record<string, any>> = [];
  const hn = harness({
    calls: {
      "agents.get": () => ({ agent: {} }),
      "search.resolve": (i: any) => ({ hit: { title: i.itemId === INTAKE ? "Intake Agent" : "Drafter Agent" } }),
      "chat.thread": () => ({ thread: { threadId: "thr_disc" } }),
      "chat.post": (i: any) => {
        posted.push(i);
        return { message: { messageId: "msg_seed" } };
      },
    },
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
  const a = hn.as({ kind: "agent", id: INTAKE }, DANA);
  await h["chat.post"]!(a, { threadId: t, body: "Object storage.", idempotencyKey: key() });
  assert.equal(
    await failure(() => h["chat.round.discuss"]!(hn.ctx, { threadId: t, messageId: asked, idempotencyKey: key() })),
    "validation.bad_input",
    "one answer is not a discussion",
  );
  assert.deepEqual(posted, []);
  await h["chat.post"]!(hn.as({ kind: "agent", id: DRAFTER }, DANA), {
    threadId: t,
    body: "The server disk.",
    idempotencyKey: key(),
  });
  const out = await h["chat.round.discuss"]!(hn.ctx, { threadId: t, messageId: asked, idempotencyKey: "disc-1" });
  assert.deepEqual(out, { threadId: "thr_disc" });
  assert.equal(posted.length, 1);
  assert.equal(posted[0]!["threadId"], "thr_disc");
  assert.deepEqual(posted[0]!["mentions"], [{ kind: "agent", id: INTAKE }]);
  assert.match(posted[0]!["body"], /Intake: Object storage\./);
  assert.match(posted[0]!["body"], /Drafter: The server disk\./);
  assert.match(posted[0]!["body"], /Decided:/);
  assert.doesNotMatch(posted[0]!["body"], /you answered on your own/, "the seed is short: the answers and one request");
  assert.deepEqual(
    hn.rows("SELECT body FROM chat_message WHERE thread = ? AND kind = 'system'", t).map((r) => r["body"]),
    ["Discussion: Intake and Drafter are talking it over"],
    "one line in the chat says where the talk is",
  );
});

test("only a person presses: an agent acting for the asker cannot decide or start a discussion", async () => {
  const { hn, t, asked } = await world();
  const agent = hn.as({ kind: "agent", id: INTAKE }, DANA);
  assert.equal(
    await failure(() =>
      h["chat.round.decide"]!(agent, { threadId: t, messageId: asked, agentId: INTAKE, idempotencyKey: key() }),
    ),
    "permission.role_lacks_permission",
  );
  assert.equal(
    await failure(() => h["chat.round.discuss"]!(agent, { threadId: t, messageId: asked, idempotencyKey: key() })),
    "permission.role_lacks_permission",
  );
  assert.deepEqual(lines(hn, t), []);
});

test("one decision per round: the same agent again is quiet, the other agent replaces the line, and a round the asker has moved past cannot be decided", async () => {
  const { hn, t, asked } = await world();
  await h["chat.post"]!(hn.as({ kind: "agent", id: DRAFTER }, DANA), {
    threadId: t,
    body: "Disk.",
    idempotencyKey: key(),
  });
  const first = await h["chat.round.decide"]!(hn.ctx, {
    threadId: t,
    messageId: asked,
    agentId: INTAKE,
    idempotencyKey: key(),
  });
  const again = await h["chat.round.decide"]!(hn.ctx, {
    threadId: t,
    messageId: asked,
    agentId: INTAKE,
    idempotencyKey: key(),
  });
  assert.equal(again.messageId, first.messageId, "the same press again is the same line");
  assert.equal(lines(hn, t).length, 1);
  const other = await h["chat.round.decide"]!(hn.ctx, {
    threadId: t,
    messageId: asked,
    agentId: DRAFTER,
    idempotencyKey: key(),
  });
  assert.equal(other.messageId, first.messageId, "the line is replaced, not added");
  const now = lines(hn, t);
  assert.equal(now.length, 1);
  assert.match(String(now[0]!["body"]), /Drafter/);
  // the asker asks again: the old round is over
  await h["chat.post"]!(hn.ctx, { threadId: t, body: "Next question", idempotencyKey: key() });
  assert.equal(
    await failure(() =>
      h["chat.round.decide"]!(hn.ctx, { threadId: t, messageId: asked, agentId: INTAKE, idempotencyKey: key() }),
    ),
    "validation.bad_input",
  );
  assert.equal(lines(hn, t).length, 1);
});

test("one discussion per message: a second press opens the thread that is there and starts nothing", async () => {
  const holder: { ctx?: any } = {};
  let seeds = 0;
  const hn = harness({
    calls: {
      "agents.get": () => ({ agent: {} }),
      "search.resolve": () => ({ hit: { title: "Intake Agent" } }),
      "chat.thread": (i: any) => h["chat.thread"]!(holder.ctx, i),
      "chat.post": (i: any) => {
        seeds++;
        return h["chat.post"]!(holder.ctx, i);
      },
    },
  });
  holder.ctx = hn.ctx;
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
  seeds = 0;
  for (const who of [INTAKE, DRAFTER])
    await h["chat.post"]!(hn.as({ kind: "agent", id: who }, DANA), {
      threadId: t,
      body: `${who} says`,
      idempotencyKey: key(),
    });
  seeds = 0;
  const one = await h["chat.round.discuss"]!(hn.ctx, { threadId: t, messageId: asked, idempotencyKey: key() });
  const two = await h["chat.round.discuss"]!(hn.ctx, { threadId: t, messageId: asked, idempotencyKey: key() });
  assert.equal(two.threadId, one.threadId, "the same thread");
  assert.equal(seeds, 1, "the seed went in once");
  assert.equal(
    hn
      .rows("SELECT body FROM chat_message WHERE thread = ? AND kind = 'system'", t)
      .filter((r) => /Discussion/.test(String(r["body"]))).length,
    1,
    "one Discussion line",
  );
});
