// Helpers of one parent share a cached prefix (r42-runtime-tokens, DIRECTION-agent-runtime C). Anthropic reads a cached system prefix only when its bytes up to the marker are the same, so
// anything that differs between two helpers (their thread id, their title) must sit outside the stable sections. This builds the context of two helpers of one parent as the engine does and compares
// what the API driver would send: the stable system blocks are byte-identical, the part that differs is small and unstable.
import test from "node:test";
import assert from "node:assert/strict";
import { createContextBuilder } from "../context.ts";
import type { SkillsPort } from "../context.ts";
import { contextBlocks } from "../../../agent/src/turn-engine/context.ts";
import { orderSystem } from "../../../agent/src/drivers/api/prefix.ts";
import type { StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";

const skills: SkillsPort = {
  async index() {
    return [{ name: "working-in-vyre", description: "How an agent works inside Vyre.", tier: "builtin" }];
  },
  async load(name) {
    return name === "working-in-vyre" ? { name, body: "# Working in Vyre\nThe manual." } : null;
  },
};
const helperThread = (id: string, title: string) => ({
  thread: {
    kind: "helper",
    title,
    parentThreadId: "thr_parent",
    members: [{ kind: "person", id: "usr_maya" }],
    agents: [{ agentId: "agt_intake", mode: "lead" }],
    planMode: false,
    mode: "auto",
    threadId: id,
  },
});
const call = async (cap: string, input: unknown): Promise<unknown> => {
  switch (cap) {
    case "threads.get":
      return (input as { threadId: string }).threadId === "thr_h1"
        ? helperThread("thr_h1", "Read the lease")
        : helperThread("thr_h2", "Price the policy");
    case "agents.get":
      return {
        agent: { agentId: "agt_intake", name: "Intake", role: "You answer intake questions.", toolsAllowed: [] },
      };
    case "access.principals.list":
      return { principals: [{ id: "usr_maya", kind: "person", name: "Maya Chen" }] };
    case "spaces.get":
      return { space: { name: "Northwind", kind: "team" } };
    case "settings.get":
      return { row: { value: "Asia/Karachi" } };
    default:
      throw new Error(`no such capability ${cap}`);
  }
};
const input = (threadId: string): TurnInput => ({
  threadId,
  turnId: `trn_${threadId}`,
  agent: { id: "agt_intake", mode: "lead" },
  trigger: {
    id: "m1",
    threadId,
    threadSeq: 1,
    author: { kind: "agent", id: "agt_intake" },
    mentions: [],
    depth: 1,
    body: "Do the thing.",
  } as StoredMessage,
  history: [],
  listeners: [],
  asker: "usr_maya",
});

test("two helpers of one parent send the same stable system blocks, and which thread each is rides in a block after them", async () => {
  const build = createContextBuilder({ call, skills, now: () => Date.UTC(2026, 10, 19, 9, 0) });
  const a = await build.build(input("thr_h1"));
  const b = await build.build(input("thr_h2"));
  const wire = (c: typeof a) => orderSystem(contextBlocks(c));
  const sa = wire(a),
    sb = wire(b);
  const stableA = sa.filter((x) => x.stable).map((x) => x.text),
    stableB = sb.filter((x) => x.stable).map((x) => x.text);
  assert.ok(stableA.length >= 4, "identity, rules, where, person or skills, can are all stable blocks");
  assert.deepEqual(stableA, stableB, "the cached prefix is the same bytes for both helpers");
  for (const t of stableA)
    assert.doesNotMatch(t, /thr_h[12]|Read the lease|Price the policy/, "nothing of one helper in the shared prefix");
  const hereA = sa.find((x) => !x.stable && /thr_h1/.test(x.text));
  const hereB = sb.find((x) => !x.stable && /thr_h2/.test(x.text));
  assert.ok(hereA && hereB, "each helper still knows its own thread id");
  assert.match(hereA!.text, /Read the lease/);
  // the helper's thread id is told where the helper_note instruction points
  assert.match(stableA.join("\n"), /helper_note \{threadId \(your own, under This chat\)/);
});
