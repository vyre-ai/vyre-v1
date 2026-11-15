// The door rule of a chat (owner, 15 Nov 2026): an agent that belongs to a chat may be asked THERE by whoever may post there, though they may not use it anywhere else. Outside the chat nothing changes: no
// one-to-one chat with it, no @mention in another chat. And whoever adds an agent to a chat must be able to use it themselves.
import test from "node:test";
import assert from "node:assert/strict";
import { channelsCreate } from "../handlers/thread.ts";
import { handlers } from "../impl.ts";
import { DANA, LEO, MAYA, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
const WREN = "agt_wren";
/** Dana may use every agent; Maya and Leo may use none (nobody shared Wren with them). */
const denyFor = (who: string[]) => (_a: unknown, r: { type: string; id: string | null }) =>
  r.type === "agent" && who.includes(String(r.id)) ? { effect: "deny" } : { effect: "allow" };
const gone = (): never => {
  throw Object.assign(new Error("That agent does not exist."), { code: "validation.not_found" });
};

async function world() {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }) } });
  const ch = (
    await channelsCreate(hn.ctx, {
      name: "open",
      visibility: "public",
      memberIds: [MAYA],
      agentIds: [WREN],
      idempotencyKey: "door-ch",
    } as any)
  ).channel;
  const reader = {
    ...hn.person(MAYA),
    authorize: ((_a: unknown, r: { type: string; id: string }) =>
      r.type === "agent" ? { effect: "deny" } : { effect: "allow" }) as any,
  };
  return { hn, ch, reader };
}

test("a reader asks the chat's agent in the chat, though nobody shared it with them", async () => {
  const { ch, reader } = await world();
  const said = await h["chat.post"]!(reader, {
    threadId: ch.mainThread ?? ch.mainThreadId,
    body: "hi Wren",
    mentions: [{ kind: "agent", id: WREN }],
    idempotencyKey: "door-1",
  });
  assert.ok(said.message);
});

test("the same person cannot start a chat with it, nor @mention it in another chat", async () => {
  const { hn, reader } = await world();
  await assert.rejects(
    h["chat.start"]!(reader, { kind: "chat", agentIds: [WREN], idempotencyKey: "door-2" }),
    (e) => codeOf(e) === "validation.not_found",
  );
  const mine = await h["chat.start"]!(hn.person(MAYA), {
    kind: "chat",
    agentIds: [INTAKE_OK],
    idempotencyKey: "door-3",
  });
  await assert.rejects(
    h["chat.post"]!(reader, {
      threadId: mine.thread.threadId,
      body: "hi",
      mentions: [{ kind: "agent", id: WREN }],
      idempotencyKey: "door-4",
    }),
    (e) => codeOf(e) === "validation.not_found",
  );
});

test("someone who is not in the chat gets no door through it", async () => {
  const { ch } = await world();
  const outsider = { ...harness({ calls: { "agents.get": gone } }).person(LEO), authorize: denyFor([WREN]) as any };
  await assert.rejects(
    h["chat.post"]!(outsider, {
      threadId: ch.mainThread ?? ch.mainThreadId,
      body: "hi",
      mentions: [{ kind: "agent", id: WREN }],
      idempotencyKey: "door-5",
    }),
    (e) => ["validation.not_found", "permission.no_grant", "validation.bad_input"].includes(codeOf(e) as string),
  );
});

test("adding an agent to a channel needs the adder to be able to use it", async () => {
  const { hn, ch, reader } = await world();
  assert.ok(hn && ch);
  await assert.rejects(
    h["channels.agents.add"]!(reader, {
      channelId: ch.channelId ?? ch.id,
      agentId: "agt_other",
      idempotencyKey: "door-6",
    }),
    (e) => codeOf(e) === "validation.not_found",
  );
});

const INTAKE_OK = "agt_intake";

test("a context without the access function refuses an agent that is not of this chat unless access.check says yes", async () => {
  const none = harness({ calls: { "agents.get": () => ({ agent: {} }), "access.check": () => ({ decision: { effect: "deny" } }) } });
  await assert.rejects(
    h["chat.start"]!({ ...none.ctx, authorize: undefined }, { kind: "chat", agentIds: [WREN], idempotencyKey: "door-bare" }),
    (e) => codeOf(e) === "validation.not_found",
  );
  const broken = harness({
    calls: {
      "agents.get": () => ({ agent: {} }),
      "access.check": () => {
        throw new Error("down");
      },
    },
  });
  await assert.rejects(
    h["chat.start"]!({ ...broken.ctx, authorize: undefined }, { kind: "chat", agentIds: [WREN], idempotencyKey: "door-bare2" }),
    (e) => codeOf(e) === "validation.not_found",
    "an access function that cannot answer is a refusal, never a pass",
  );
});
