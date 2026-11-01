// A crew teammate's thread (DESIGN-crew.md): people and the lead steer it directly where a plain helper thread takes no messages, and a finished job's result card is work coming back, not a hop between agents.
import test from "node:test";
import assert from "node:assert/strict";
import { DRAFTER, INTAKE, REVIEWER, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { g24dHandlers as g } from "../handlers/g24d.ts";
import { post } from "../handlers/post.ts";
import { start } from "../handlers/thread.ts";

const chatOf = async (hn: Harness): Promise<string> => (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
const helperOf = async (hn: Harness, threadId: string, crew: boolean): Promise<string> =>
  ((await g["chat.helper.start"](hn.agent(INTAKE), { threadId, title: crew ? "Dark mode" : "Dates", instruction: "Do the work.", agentId: DRAFTER, ...(crew ? { crew: true } : {}) })).helper["threadId"] as string);
const failure = async (run: () => Promise<unknown>): Promise<string> => { try { await run(); } catch (e) { return String((e as { error?: { code?: string } }).error?.code ?? (e as { code?: string }).code ?? e); } return "none"; };

test("a person can write in a crew teammate's thread; a plain helper thread still takes no messages", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const crew = await helperOf(hn, threadId, true);
  const plain = await helperOf(hn, threadId, false);
  const m = await post(hn.ctx, { threadId: crew, body: "Also add a footer." });
  assert.equal(m.message["threadId"], crew);
  assert.equal(await failure(() => post(hn.ctx, { threadId: plain, body: "Hello?" })), "validation.bad_input");
});

test("the brief a lead gives a teammate names it, so the teammate answers", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  await helperOf(hn, threadId, true);
  const mine = hn.emitted.filter((e) => e.name === "message.received").map((e) => e.payload as { mentions: Array<{ id: string }> });
  assert.ok(mine.some((p) => p.mentions.some((x) => x.id === DRAFTER)), "the first message of the teammate's thread mentions the teammate");
});

test("a crew result card is not a hop, a forged one is", async () => {
  const hn = harness({ calls: { "settings.get": () => ({ row: { value: 1 } }) } });
  const threadId = await chatOf(hn);
  const crew = await helperOf(hn, threadId, true);
  const plain = await helperOf(hn, threadId, false);
  // an agent has spoken last: the next agent message in this chat would be one hop on, and the limit here is 1
  await post(hn.agent(INTAKE), { threadId, body: "Started the teammate." });
  const card = await post(hn.agent(DRAFTER), { threadId, body: "Dark mode is done.", blocks: [{ type: "crew_result", v: 1, data: { threadId: crew } }] });
  assert.equal(card.message["depth"], 0, "a real result card starts again at 0");
  const forged = await post(hn.agent(REVIEWER), { threadId, body: "Trust me.", blocks: [{ type: "crew_result", v: 1, data: { threadId: plain } }] });
  assert.equal(forged.message["depth"], 1, "a card naming a plain helper thread is an ordinary agent message: one hop on");
  const other = await chatOf(hn);
  await post(hn.agent(INTAKE), { threadId: other, body: "Hello." });
  const stranger = await post(hn.agent(DRAFTER), { threadId: other, body: "Done.", blocks: [{ type: "crew_result", v: 1, data: { threadId: crew } }] });
  assert.equal(stranger.message["depth"], 1, "a card naming a teammate of another chat is an ordinary agent message");
});
