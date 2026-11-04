// The Island in the real Conversation (static markup): with an agent writing, the pill is there above the composer (Working); an agent's question, with no page to find its card on, is the pill; the
// recommended choice alone is offered. With nobody writing there is no pill. Pressing and answering are in IslandQuestion.test.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createStreamStore } from "../../../../../../ui/src/stream/index.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "./Conversation.tsx";
import { createSample } from "./sample.ts";
import type { ConversationData } from "./data.tsx";
import type { Message } from "./model.ts";

installComposerForTests(Composer);

function world(writing: boolean, question = true) {
  const s = createSample("idle");
  const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
  const last = rows[rows.length - 1]!;
  const ask = { messageId: "msg_ask", threadId: s.data.threadId, threadSeq: last.threadSeq + 1, author: { kind: "agent", id: "agt_intake" }, kind: "agent", body: "", depth: 0, attachments: [], reactions: [], pinned: false, createdAt: last.createdAt + 1000,
    blocks: [{ type: "question", v: 1, id: "blk_size", state: "waiting", traceId: "tr", data: { prompt: "How large can an upload be?", mode: "single", options: [{ key: "2gb", label: "2 GB" }, { key: "10gb", label: "10 GB" }], recommended: 0, allowOther: true } }] } as unknown as Message;
  if (question) s.replica.put("messages", [{ id: ask.messageId, ...ask }]);
  const turns = writing ? [{ turnId: "trn_1", threadId: s.data.threadId, agentId: "agt_intake", store: createStreamStore(), state: "writing" as const, startedAt: s.data.clock().now - 20_000 }] : [];
  const answers: unknown[] = [];
  const data = { ...s.data, call: async (cap: string, input: unknown) => { if (cap === "chat.answer_block") { answers.push(input); return { ok: true }; } return s.data.call(cap, input); },
    live: { turnsOf: () => turns, subscribe: () => () => undefined, settle: () => undefined, seed: () => undefined, onGap: () => () => undefined } } as ConversationData;
  return { data, answers };
}
const html = (data: ConversationData): string => renderToStaticMarkup(<Conversation data={data} />).replaceAll("<!-- -->", "");

test("with an agent writing, the Island pill is above the composer; with nobody writing it is not", () => {
  const on = html(world(true, false).data);
  assert.match(on, /data-testid="island-pill"/);
  assert.match(on, /data-testid="island-word"/);
  assert.doesNotMatch(html(world(false, false).data), /data-testid="island"/);
});

test("an agent's question is the pill when its card cannot be seen: the question, the recommended choice alone, and Other", () => {
  const out = html(world(true).data);
  assert.match(out, /data-testid="island-question"/);
  assert.match(out, /How large can an upload be\?/);
  assert.match(out, /data-testid="island-choice-2gb"/);
  assert.doesNotMatch(out, /data-testid="island-choice-10gb"/, "only the recommended choice is in the pill");
  assert.match(out, /data-testid="island-other"/);
  assert.doesNotMatch(out, /data-testid="island-pill"/, "the question replaces the Working pill");
});
