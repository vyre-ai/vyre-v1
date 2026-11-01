// Live replies in the conversation: a reply that is being written shows as an agent row built from the live stream before any message exists, the Stop controls see it as working,
// and when the saved message arrives under the same id there is one row, not two.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "./Conversation.tsx";
import { ghostMessages } from "./model.ts";
import { createSample } from "./sample.ts";
import type { ConversationData } from "./data.tsx";
import { createTurnStreams } from "../../../shell/session/turn-streams.ts";

installComposerForTests(Composer);

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const count = (s: string, n: string): number => s.split(n).length - 1;

function withLive() {
  const s = createSample("idle");
  const turns = createTurnStreams();
  const data: ConversationData = {
    ...s.data,
    streamOf: (id) => turns.streamOf(id) ?? s.data.streamOf(id),
    live: { turnsOf: (t) => turns.turnsOf(t), subscribe: (l) => turns.subscribe(l), settle: (id) => turns.settle(id) },
  };
  const frame = (turn: string, delta: Record<string, unknown>) => turns.onFrame({ t: "turn", turn, delta: { threadId: data.threadId, agentId: "agt_intake", ...delta } });
  return { s, turns, data, frame };
}

test("a reply being written is a row on the page with its words, before the message exists", () => {
  const w = withLive();
  w.frame("trn_1", { kind: "start" });
  w.frame("trn_1", { kind: "delta", text: "Checking the calendar now." });
  w.frame("trn_1", { kind: "end", state: "done" });   // the words are released a few at a time; ending the turn shows what is waiting, and the next animation frame draws it
  const out = clean(renderToStaticMarkup(<Conversation data={w.data} />));
  assert.equal(count(out, 'data-testid="msg-turn:trn_1"'), 1);
  assert.ok(out.includes("Checking the calendar now."));
});

test("once the host names the saved message, the row takes that id; when the message is in the list there is one row", () => {
  const w = withLive();
  w.frame("trn_1", { kind: "start" });
  w.frame("trn_1", { kind: "delta", text: "All booked." });
  w.frame("trn_1", { kind: "end", state: "done" });
  w.frame("trn_1", { kind: "final", messageId: "msg_new" });
  const before = clean(renderToStaticMarkup(<Conversation data={w.data} />));
  assert.equal(count(before, 'data-testid="msg-msg_new"'), 1);
  assert.ok(before.includes("All booked."));
  const turn = w.turns.turnsOf(w.data.threadId)[0]!;
  const have = [{ messageId: "msg_new", threadSeq: 99 }] as never;
  assert.deepEqual(ghostMessages([turn], have, w.data.threadId), [], "a turn whose message is already listed shows no row of its own");
});

test("a chat with no live link draws exactly what it drew before", () => {
  const s = createSample("idle");
  const a = clean(renderToStaticMarkup(<Conversation data={s.data} />));
  const b = clean(renderToStaticMarkup(<Conversation data={{ ...s.data }} />));
  assert.equal(a, b);
  assert.equal(count(a, 'data-testid="msg-turn:'), 0);
});

test("ghost rows go last, after every listed message, and are agent messages from the turn's agent", () => {
  const turns = [{ turnId: "t1", agentId: "agt_a", startedAt: 5 }, { turnId: "t2", agentId: "agt_b", messageId: "msg_9", startedAt: 6 }];
  const out = ghostMessages(turns, [{ messageId: "m1", threadSeq: 4 }] as never, "thr_x");
  assert.deepEqual(out.map((m) => [m.messageId, m.threadSeq, m.author.kind, m.author.id]), [["turn:t1", 5, "agent", "agt_a"], ["msg_9", 6, "agent", "agt_b"]]);
});
