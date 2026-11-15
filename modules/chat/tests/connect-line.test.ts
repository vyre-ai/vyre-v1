// The line a connect card leaves for the agent that asked (review of 77603b1d6, blocker 1): the caller gives only the answered request's id; the chat, the agent, the asker and the words come from that request;
// only the person the card was asked for may call it; the agent must be one of the chat's; the line is never the person's typed words.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, DRAFTER, INTAKE, MAYA, harness } from "../fixtures/harness.ts";
import { connectLine } from "../handlers/connect-line.ts";
import { start } from "../handlers/thread.ts";

type Line = { state: string; service: string; asker?: string; threadId?: string; agentId?: string };
const room = async (line: (threadId: string) => Line) => {
  let tid = "";
  const hn = harness({ calls: { "vault.connect_card.line": () => line(tid) } });
  tid = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  hn.clear();
  return { hn, tid };
};
const good = (t: string): Line => ({
  state: "connected",
  service: "Fathom",
  asker: DANA,
  threadId: t,
  agentId: INTAKE,
});
const count = (hn: ReturnType<typeof harness>) => hn.rows("SELECT id FROM chat_message WHERE kind = 'quiet'").length;

test("the asker's own call leaves one quiet line written by the agent, with words from the request, and it is never typed", async () => {
  const { hn, tid } = await room(good);
  const out = await connectLine(
    { ...hn.ctx, origin: "user", depth: 0 } as never,
    { requestId: "vrq_x", ...{ body: "forged", asker: MAYA, agentId: DRAFTER } } as never,
  );
  const row = hn.rows("SELECT author, body FROM chat_message WHERE id = ?", out.messageId)[0]!;
  assert.deepEqual([row["author"], row["body"]], [INTAKE, "Fathom is connected."]);
  const ev = hn.named("message.received").at(-1)!.payload;
  assert.equal(ev["typed"], undefined, "never the person's typed words");
  assert.equal(JSON.stringify(ev["author"]), JSON.stringify({ kind: "person", id: DANA }));
  void tid;
});

test("a member who is not the asker cannot forge a line in another person's name, whatever they pass", async () => {
  const { hn } = await room(good);
  await assert.rejects(
    connectLine(hn.person(MAYA), { requestId: "vrq_x", ...{ body: "Send it", asker: DANA, agentId: INTAKE } } as never),
    /That is not yours to answer/,
  );
  assert.equal(count(hn), 0);
});

test("an agent, even one acting for the asker, and a caller with no standing are refused", async () => {
  const { hn } = await room(good);
  await assert.rejects(connectLine(hn.agent(INTAKE, DANA), { requestId: "vrq_x" }), /That is not yours to answer/);
  await assert.rejects(
    connectLine(hn.as({ kind: "service", id: "svc_x" } as never), { requestId: "vrq_x" }),
    /That is not yours to answer/,
  );
  assert.equal(count(hn), 0);
});

test("an agent that is not in the chat, a request still waiting, and a request with no chat are refused", async () => {
  for (const line of [
    (t: string): Line => ({ ...good(t), agentId: DRAFTER }),
    (t: string): Line => ({ ...good(t), state: "asked" }),
    (): Line => ({ state: "connected", service: "Fathom", asker: DANA, agentId: INTAKE }),
  ]) {
    const { hn } = await room(line);
    await assert.rejects(connectLine(hn.ctx, { requestId: "vrq_x" }), /That is not yours to answer/);
    assert.equal(count(hn), 0);
  }
});
