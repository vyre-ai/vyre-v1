// The round table (chat gap G57): two agents answered one message; one card with a tab each, "Go with <name>" calls chat.round.decide, and the card folds once the person writes anything after.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom, mount, press, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import { ConversationDataProvider } from "../conversation/data.tsx";
import { createSample } from "../conversation/sample.ts";
import type { Message } from "../conversation/model.ts";
import { RoundTable } from "./RoundTable.tsx";
import { roundAnswers } from "./round-table-model.ts";

const names: Record<string, string> = { agt_dex: "Dex", agt_nova: "Nova" };
const nameOf = (id: string): string => names[id] ?? id;
const msg = (id: string, seq: number, kind: "person" | "agent", who: string, body: string): Message =>
  ({
    id,
    messageId: id,
    threadId: "c1",
    threadSeq: seq,
    author: { kind, id: who },
    kind: kind === "agent" ? "agent" : "text",
    body,
    blocks: [],
    depth: 0,
    attachments: [],
    reactions: [],
    pinned: false,
    createdAt: 1_760_000_000_000 + seq,
  }) as unknown as Message;
const ask = msg("q1", 1, "person", "usr_irfad", "@Dex @Nova which storage?");
const dex = msg("a1", 2, "agent", "agt_dex", "Object storage.");
const nova = msg("a2", 3, "agent", "agt_nova", "The server disk.");

test("answers: each tagged agent's first reply after the ask, nothing until two have answered, folded once the person writes", () => {
  const ids = ["agt_dex", "agt_nova"];
  assert.equal(roundAnswers([ask, dex] as never, "q1", "usr_irfad", ids), null);
  assert.deepEqual(
    roundAnswers([ask, dex, nova] as never, "q1", "usr_irfad", ids)?.map((a) => [a.agentId, a.text]),
    [
      ["agt_dex", "Object storage."],
      ["agt_nova", "The server disk."],
    ],
  );
  assert.equal(
    roundAnswers([ask, dex, nova, msg("p2", 4, "person", "usr_irfad", "ok")] as never, "q1", "usr_irfad", ids),
    null,
  );
  assert.equal(
    roundAnswers([ask, dex, nova, msg("a3", 4, "agent", "agt_sol", "me too")] as never, "q1", "usr_irfad", ids)?.length,
    2,
    "an agent that was not asked is not in the round",
  );
});

test("the card: a tab per agent, a press on a tab shows its answer, Go with calls chat.round.decide for that agent", async () => {
  installDom();
  const s = createSample("channel");
  s.replica.put("messages", [ask, dex, nova]);
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={{ ...s.data, threadId: "c1" }}>
      <RoundTable
        messageId="q1"
        threadId="c1"
        body={ask.body}
        mentions={[
          { kind: "agent", id: "agt_dex" },
          { kind: "agent", id: "agt_nova" },
        ]}
        nameOf={nameOf}
      />
    </ConversationDataProvider>,
  );
  await flush();
  assert.match(textOf(find(root, "round-table-q1-answer")), /Object storage/);
  await press(find(root, "round-table-q1-tab-agt_nova")!);
  assert.match(textOf(find(root, "round-table-q1-answer")), /server disk/);
  assert.match(textOf(find(root, "round-table-q1-go")), /Go with Nova/);
  await press(find(root, "round-table-q1-go")!);
  await flush();
  const call = s.calls.find((c) => c.cap === "chat.round.decide");
  assert.deepEqual(call?.input, {
    threadId: "c1",
    messageId: "q1",
    agentId: "agt_nova",
    idempotencyKey: "round-q1-agt_nova",
  });
  await act(async () => {
    s.replica.put("messages", [ask, dex, nova, msg("p2", 4, "person", "usr_irfad", "Decided")]);
  });
  await flush();
  assert.equal(find(root, "round-table-q1"), null, "folds once the person wrote after the answers");
});
