// The round row (chat gap G56): a message that asked two agents shows each agent and its state at once; a one-agent ask draws nothing; the row folds when every agent has replied.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom, mount, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import { ConversationDataProvider } from "../conversation/data.tsx";
import { createSample } from "../conversation/sample.ts";
import { RoundRow } from "./RoundRow.tsx";
import { asksSeveral, keepReading, stateWords, visibleRound } from "./round-model.ts";

const names: Record<string, string> = { agt_dex: "Dex", agt_nova: "Nova" };
const nameOf = (id: string): string => names[id] ?? id;

test("asks several: two tagged agents or words to all, never one agent", () => {
  const two = [
    { kind: "agent", id: "agt_dex" },
    { kind: "agent", id: "agt_nova" },
  ];
  assert.equal(asksSeveral({ body: "@Dex @Nova look", mentions: two }), true);
  assert.equal(asksSeveral({ body: "both of you look", mentions: [] }), true);
  assert.equal(asksSeveral({ body: "@Dex look", mentions: [two[0]!] }), false);
  assert.equal(
    asksSeveral({ body: "@Dex @Dex", mentions: [two[0]!, two[0]!] }),
    false,
    "one agent tagged twice is one agent",
  );
});

test("the words and the fold: waiting names who is in front, a finished round shows nothing, one agent is no round", () => {
  assert.equal(stateWords({ agentId: "agt_nova", state: "waiting", on: "agt_dex" }, nameOf), "Next after Dex");
  assert.deepEqual(visibleRound([{ agentId: "agt_dex", state: "working" }]), []);
  assert.deepEqual(
    visibleRound([
      { agentId: "agt_dex", state: "replied" },
      { agentId: "agt_nova", state: "replied" },
    ]),
    [],
  );
  assert.equal(keepReading(1000, []), true, "no round seen yet: keep looking");
  assert.equal(keepReading(200_000, []), false, "an old message is history");
  assert.equal(keepReading(1000, [{ agentId: "agt_dex", state: "replied" }]), false);
});

test("two agents asked: each shows with its state, and the row is gone once both have replied", async () => {
  installDom();
  const s = createSample("channel");
  let agents: unknown[] = [
    { agentId: "agt_dex", state: "working" },
    { agentId: "agt_nova", state: "waiting", on: "agt_dex" },
  ];
  const data = {
    ...s.data,
    call: (cap: string, input: unknown) =>
      cap === "engine.round.get"
        ? Promise.resolve({ rounds: [{ messageId: "m1", agents }] })
        : s.data.call(cap as never, input as never),
  } as typeof s.data;
  const now = data.clock().now;
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={data}>
      <RoundRow
        messageId="m1"
        threadId="c1"
        body="@Dex @Nova look"
        mentions={[
          { kind: "agent", id: "agt_dex" },
          { kind: "agent", id: "agt_nova" },
        ]}
        createdAt={now}
        nameOf={nameOf}
      />
    </ConversationDataProvider>,
  );
  await flush();
  assert.match(textOf(find(root, "round-m1-agt_dex")), /Dex\s+Working/);
  assert.match(textOf(find(root, "round-m1-agt_nova")), /Nova\s+Next after Dex/);
  agents = [
    { agentId: "agt_dex", state: "replied" },
    { agentId: "agt_nova", state: "replied" },
  ];
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1100));
  });
  await flush();
  assert.equal(find(root, "round-m1"), null, "folded away");
});
