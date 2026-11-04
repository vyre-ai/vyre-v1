// The turn's built-in recall block (rc.22 blocker, rule 2 and 8): the lines the engine puts in the prompt of a turn, built by engine/recall.ts recallFor through memory.pointer as the asker. In a place where
// anyone besides the owner can read the reply, the block holds none of the owner's person-layer facts, and none of what a chat or one-person channel learned before its second person arrived.
// The gate is makeAccess in memory/projections.ts (a person layer is read only where nobody else reads, a place's memory only against who may open it now) and, for the pointer, hidePersonal in handlers/facts.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { recallFor } from "../../engine/recall.ts";
import { pointer } from "../handlers/facts.ts";
import { remember } from "../handlers/tools.ts";
import { harness, openRaw, NOW } from "../fixtures/harness.ts";
import type { TurnInput } from "../../../agent/src/turn-engine/types.ts";

const AGENT = "agt_intake", MAYA = "usr_maya", OMAR = "usr_omar";
const person = (id: string) => ({ kind: "person", id });

/** The engine's `call` for recall: memory.pointer as the asker, over the real handler and a real store. */
function engineCall(raw: ReturnType<typeof openRaw>, members: string[], asker: string, sharedAt?: number) {
  const h = harness({ raw, principal: person(asker) as never, respond: {
    "threads.get": (b) => { const id = String(b["threadId"]); if (id !== "thr_plans") throw new Error("not found"); return { thread: { threadId: id, kind: "channel", channelId: "chn_plans", starter: MAYA, members: members.map(person), agents: [{ agentId: AGENT, mode: "lead" }], ...(sharedAt ? { sharedAt } : {}) } }; },
    "channels.get": () => ({ channel: { channelId: "chn_plans", visibility: "invite", members: members.map(person) } }), "agents.get": () => ({ agent: { folderId: "fld_intake", captureMode: "auto", ownerId: MAYA } }),
  } });
  return (cap: string, input: unknown) => (cap === "memory.pointer" ? pointer(h.ctx, input as never) : Promise.resolve({}));
}
const turn = (asker: string, body: string): TurnInput => ({
  threadId: "thr_plans", asker, agent: { id: AGENT }, trigger: { id: "msg_t", author: { kind: "person", id: asker }, body },
} as unknown as TurnInput);

test("the recall block of a turn in a room with someone else holds none of the asker's own person-layer facts", async () => {
  const raw = openRaw();
  // Maya alone with the agent: it keeps her note, in her own layer
  const alone = harness({ raw, principal: { kind: "agent", id: AGENT }, actingFor: MAYA, respond: {
    "threads.get": () => ({ thread: { threadId: "thr_plans", kind: "channel", channelId: "chn_plans", starter: MAYA, members: [person(MAYA)], agents: [{ agentId: AGENT, mode: "lead" }] } }),
    "channels.get": () => ({ channel: { visibility: "invite", members: [person(MAYA)] } }), "agents.get": () => ({ agent: { folderId: "fld_intake", captureMode: "auto", ownerId: MAYA } }),
  } });
  (alone.ctx as { thread?: string }).thread = "thr_plans";
  const saved = await remember(alone.ctx, { text: "Maya's budget ceiling for the Acme deal is eighty thousand dollars.", agentId: AGENT, threadId: "thr_plans" });
  assert.equal(saved.fact.layer, "person");
  const ask = "what is the budget ceiling for the Acme deal in dollars";
  // alone, her own turn recalls it
  assert.match(JSON.stringify(await recallFor(engineCall(raw, [MAYA], MAYA), turn(MAYA, ask))), /eighty thousand/);
  // Omar is in the room: neither Maya's turn nor Omar's recalls it
  for (const who of [MAYA, OMAR]) {
    const block = await recallFor(engineCall(raw, [MAYA, OMAR], who, NOW + 1000), turn(who, ask));
    assert.doesNotMatch(JSON.stringify(block), /eighty thousand/, `${who}'s turn in the shared room`);
  }
});

test("the recall block holds nothing a one-person channel learned before its second person arrived, whoever asks", async () => {
  const raw = openRaw();
  const sharedAt = NOW + 1000;
  const clock = { t: NOW };
  const keep = harness({ raw, clock, principal: { kind: "agent", id: AGENT }, actingFor: MAYA, respond: {
    "threads.get": () => ({ thread: { threadId: "thr_plans", kind: "channel", channelId: "chn_plans", starter: MAYA, members: [person(MAYA)], agents: [{ agentId: AGENT, mode: "lead" }] } }),
    "channels.get": () => ({ channel: { visibility: "invite", members: [person(MAYA)] } }), "agents.get": () => ({ agent: { folderId: "fld_intake", captureMode: "auto", ownerId: MAYA } }), "chat.noted": () => ({ posted: true }),
  } });
  (keep.ctx as { thread?: string }).thread = "thr_plans";
  await remember(keep.ctx, { text: "The cobalt reserve is sixty one thousand dollars.", layer: "agent", agentId: AGENT, threadId: "thr_plans" });
  clock.t = sharedAt + 1000;
  const ask = "what is the cobalt reserve in dollars";
  for (const who of [MAYA, OMAR]) {
    const block = await recallFor(engineCall(raw, [MAYA, OMAR], who, sharedAt), turn(who, ask));
    assert.doesNotMatch(JSON.stringify(block), /sixty one/, `${who}'s turn`);
  }
});
