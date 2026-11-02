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

test("a helper's result is a Job's line: the mark needs the real thread and its own agent, and an ordinary line never has it", async () => {
  const hn = harness({ calls: { "settings.get": () => ({ row: { value: 20 } }) } });
  const threadId = await chatOf(hn);
  const crew = await helperOf(hn, threadId, true);
  const plain = await helperOf(hn, threadId, false);
  const marked = (messageId: unknown): unknown => hn.named("message.received").find((e) => e.payload["messageId"] === messageId)?.payload["job"];
  await post(hn.agent(INTAKE), { threadId, body: "Started the helper." });
  const result = (status: string, data: string = plain) => [{ type: "helper", v: 1, data: { threadId: data, status } }];
  const done = await post(hn.agent(DRAFTER), { threadId, body: "It found the dates.", blocks: result("done") });
  assert.equal(done.message["depth"], 0, "work coming back is no hop");
  assert.equal(marked(done.message["messageId"]), true);
  const failed = await post(hn.agent(DRAFTER), { threadId, body: "It could not finish.", blocks: result("failed") });
  assert.equal(marked(failed.message["messageId"]), true);
  assert.equal(marked((await post(hn.agent(REVIEWER), { threadId, body: "Trust me.", blocks: result("done") })).message["messageId"]), undefined, "not the helper's agent");
  assert.equal(marked((await post(hn.agent(DRAFTER), { threadId, body: "Still going.", blocks: result("running") })).message["messageId"]), undefined, "not an ending");
  assert.equal(marked((await post(hn.agent(DRAFTER), { threadId, body: "Crew.", blocks: result("done", crew) })).message["messageId"]), undefined, "a teammate reports with its card");
  assert.equal(marked((await post(hn.agent(DRAFTER), { threadId, body: "Plain." })).message["messageId"]), undefined);
});

test("a brief an agent gives itself carries the mark and stays its own words; a brief to another agent names it instead", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const own = (await g["chat.helper.start"](hn.agent(INTAKE), { threadId, title: "Dates", instruction: "Do the work.", agentId: INTAKE })).helper["threadId"] as string;
  const brief = hn.named("message.received").find((e) => e.payload["threadId"] === own)!.payload as { job?: boolean; author: { kind: string; id: string } };
  assert.equal(brief.job, true);
  assert.deepEqual([brief.author.kind, brief.author.id], ["agent", INTAKE]);
  const other = await helperOf(hn, threadId, false);
  assert.equal(hn.named("message.received").find((e) => e.payload["threadId"] === other)!.payload["job"], undefined);
});
