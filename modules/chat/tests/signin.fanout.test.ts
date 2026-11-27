// A sign-in card reaches everyone who may take the computer over (rc.44): the owner, and the Space's owners and admins when the agent is shared with the Space; each gets the task (Needs you, with its notification), the
// one the chat already had is not doubled, every task names the same block so answering any of them answers the question, and a card for a routine nobody reads (no person behind it) still reaches them.
import test from "node:test";
import assert from "node:assert/strict";
import { INTAKE, MAYA, DANA, harness } from "../fixtures/harness.ts";
import { g24dHandlers as g } from "../handlers/g24d.ts";
import { start } from "../handlers/thread.ts";

const card = { kind: "signin" as const, surface: "terminal" as const, agentId: INTAKE, terminalId: "trm_a1b2c3" };
const ask = (ctx: ReturnType<typeof harness>["ctx"], threadId: string) =>
  g["chat.question.ask"](ctx, {
    threadId,
    prompt: "Sign in to GitHub with the code the terminal shows",
    mode: "single",
    options: [
      { key: "done", label: "Done, I signed in" },
      { key: "cannot", label: "I can't sign in" },
    ],
    card,
  });
const tasksOf = (hn: ReturnType<typeof harness>) =>
  hn.callLog
    .filter((c) => c.cap === "tasks.create")
    .map((c) => ({
      to: (c.input["assigned"] as { id: string }).id,
      key: c.input["idempotencyKey"] as string,
      block: (c.input["notes"] as Record<string, string>)["chat.block"],
    }));

function world(share: "space" | "personal", owner = DANA) {
  const hn = harness({
    calls: {
      "tasks.create": (i) => ({ task: { id: `tsk_${String(i["idempotencyKey"]).slice(-6)}` } }),
      "agents.share_class": () => ({ class: share, ownerId: owner, people: [] }),
      "access.deciders": () => ({ people: [DANA, MAYA, "svc_x"] }),
    },
  });
  return hn;
}

test("shared with the Space: the person the chat has keeps the ordinary task, every other owner and admin gets one for the same block, and no one is doubled", async () => {
  const hn = world("space");
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  hn.clear();
  const out = await ask(hn.agent(INTAKE, DANA), threadId);
  const made = tasksOf(hn);
  assert.deepEqual(made.map((t) => t.to).sort(), [DANA, MAYA], "the asker, and the other admin; not a service");
  assert.equal(made.find((t) => t.to === DANA)!.key, `ask:${out.blockId}`, "the chat's own task is the ordinary one");
  assert.equal(made.find((t) => t.to === MAYA)!.key, `signin:${out.blockId}:${MAYA}`);
  assert.ok(
    made.every((t) => t.block === out.blockId),
    "one block, so answering any task answers the question",
  );
});

test("a routine nobody reads (no person behind the chat) still reaches the owner and the admins", async () => {
  const hn = world("space");
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  // the chat's own person is not there: the agent asks with no one acting for it and the starter is an agent
  hn.raw.run("UPDATE chat_thread SET starter = ? WHERE id = ?", INTAKE, threadId);
  hn.clear();
  await ask({ ...hn.agent(INTAKE), actingFor: undefined } as never, threadId);
  assert.deepEqual(
    tasksOf(hn)
      .map((t) => t.to)
      .sort(),
    [DANA, MAYA],
  );
});

test("a personal agent's card goes to its owner only; an ordinary question gets no extra tasks", async () => {
  const hn = world("personal", MAYA);
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  hn.clear();
  await ask(hn.agent(INTAKE, DANA), threadId);
  assert.deepEqual(
    tasksOf(hn)
      .map((t) => t.to)
      .sort(),
    [DANA, MAYA],
    "the asker's own task, and the owner's (a personal agent: nobody else)",
  );
  hn.clear();
  await g["chat.question.ask"](hn.agent(INTAKE, DANA), {
    threadId,
    prompt: "Which court should I file in?",
    mode: "single",
    options: [{ key: "a", label: "Superior" }],
  });
  assert.equal(tasksOf(hn).length, 1, "only the chat's own task");
});

test("only the people who may take the computer over can answer the card: another person in the chat is refused and the question stays open", async () => {
  // the agent is Maya's personal agent; Dana is in the chat but may not take its computer over
  const hn = harness({
    calls: {
      "tasks.create": (i) => ({ task: { id: `tsk_${String(i["idempotencyKey"]).slice(-6)}` } }),
      "agents.share_class": () => ({ class: "personal", ownerId: MAYA, people: [] }),
      "access.deciders": () => ({ people: [MAYA] }),
    },
  });
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const out = await ask(hn.agent(INTAKE, DANA), threadId);
  const { answerBlock } = await import("../handlers/thread.ts");
  await assert.rejects(
    () => answerBlock(hn.ctx, { threadId, blockId: out.blockId, answer: "done" }),
    (e: unknown) => (e as { error?: { code?: string } }).error?.code === "permission.no_grant",
  );
  assert.equal(hn.rows("SELECT state FROM chat_block WHERE id = ?", out.blockId)[0]!["state"], "waiting");
});
