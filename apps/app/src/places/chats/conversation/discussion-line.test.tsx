// The discussion's seed is a quiet line in the thread: "Dex and Nova are talking it over". The instruction in its body is for the agents and is never what is drawn.
import test from "node:test";
import assert from "node:assert/strict";
import { discussionLine, isCard } from "./model.ts";

const names: Record<string, string> = { agt_dex: "Dex", agt_nova: "Nova", agt_sol: "Sol Ops" };
const nameOf = (id: string): string => names[id] ?? id;
const seed = (ids: string[]) => ({
  blocks: [{ type: "discussion_seed", v: 1, id: "blk_1", data: { agentIds: ids }, state: "done", traceId: "t" }],
});

test("the seed reads as who is talking, never as the instruction", () => {
  assert.equal(discussionLine(seed(["agt_dex", "agt_nova"]) as never, nameOf), "Dex and Nova are talking it over");
  assert.equal(
    discussionLine(seed(["agt_dex", "agt_nova", "agt_sol"]) as never, nameOf),
    "Dex, Nova and Sol are talking it over",
  );
  assert.equal(discussionLine(seed(["agt_dex"]) as never, nameOf), "Dex is talking it over");
  assert.equal(discussionLine({ blocks: [] } as never, nameOf), null, "an ordinary message is not a seed");
});

test("the seed block is never drawn as a card", () => {
  assert.equal(isCard(seed(["agt_dex"]).blocks[0] as never), false);
});
