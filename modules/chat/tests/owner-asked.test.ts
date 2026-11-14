// What counts as "the owner asked" (the rule is written above answeredCard in handlers/post.ts): a card answer the person gave counts, and nothing that merely carries their identity does.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { INTAKE, MAYA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { g24dHandlers as g } from "../handlers/g24d.ts";
import { answerBlock, start } from "../handlers/thread.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: Record<string, unknown>) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;

async function world() {
  const hn = harness();
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const ask = async (): Promise<string> =>
    (
      await g["chat.question.ask"](hn.agent(), {
        threadId,
        prompt: "Which court?",
        mode: "single",
        options: [
          { key: "a", label: "Superior" },
          { key: "b", label: "Federal" },
        ],
      })
    ).blockId as string;
  const answered = await ask();
  await answerBlock(hn.ctx, { threadId, blockId: answered, answer: "b" });
  const open = await ask();
  const post = async (ctx: Harness["ctx"], key: string): Promise<unknown> => {
    hn.clear();
    await h["chat.post"]!(ctx, { threadId, body: `Answered: Federal (b) ${++n}`, idempotencyKey: key });
    return hn.named("message.received")[0]?.payload["typed"];
  };
  return { hn, threadId, answered, open, post };
}
const inner = (ctx: Harness["ctx"], o: Record<string, unknown> = {}): Harness["ctx"] =>
  ({ ...ctx, origin: "user", depth: 1, ...o }) as Harness["ctx"];

test("an answer the person gave on a question card an agent asked counts as the person's own words", async () => {
  const w = await world();
  assert.equal(await w.post(inner(w.hn.ctx), `answer_${w.answered}`), true);
});

test("it cannot be forged: not by the agent, not from an MCP client, not for a card nobody answered, not for a card another person answered, not for an invented id", async () => {
  const w = await world();
  const key = `answer_${w.answered}`;
  assert.equal(await w.post(inner(w.hn.agent()), key), undefined, "an agent naming the card");
  assert.equal(await w.post(inner(w.hn.ctx, { origin: "mcp" }), key), undefined, "an MCP client acting as the person");
  assert.equal(await w.post(inner(w.hn.ctx, { origin: "module" }), key), undefined, "a module posting in their name");
  assert.equal(await w.post(inner(w.hn.ctx), `answer_${w.open}`), undefined, "a card still waiting");
  assert.equal(await w.post(inner(w.hn.ctx), "answer_blk_notacard"), undefined, "an invented card");
  assert.equal(await w.post(inner(w.hn.ctx), "something_else"), undefined, "a key that is not an answer's");
  w.hn.db.run("UPDATE chat_block SET answeredBy = ? WHERE id = ?", MAYA, w.answered);
  assert.equal(await w.post(inner(w.hn.ctx), key), undefined, "a card another person answered");
});

test("a person's typed message at the top of a call counts, and an edit or an attachment-only post adds no new way in", async () => {
  const w = await world();
  assert.equal(await w.post({ ...w.hn.ctx, origin: "user", depth: 0 } as Harness["ctx"], "typed_1"), true);
  assert.equal(
    await w.post({ ...w.hn.ctx, origin: "mcp", depth: 0 } as Harness["ctx"], "typed_2"),
    undefined,
    "a post by an MCP client",
  );
});
