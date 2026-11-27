// terminal.ask_signin (rc.44): an agent asks a person to finish a login in its own terminal. The chat gets the one sign-in card (a question with card kind signin, answers done and cannot) where the agent
// asked; only an agent asks, and only about a terminal of its own computer. Real SQLite, a scripted machine, every input and output checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OWN = { kind: "agent" as const, id: "agt_intake" };
const OTHER = { kind: "agent" as const, id: "agt_other" };
let keys = 0;
const idem = (): string => `idem_signin_${++keys}`;

function setup() {
  reset();
  const hn = harness();
  bindHost(fakeHost({}).host);
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const asAgent = (who: typeof OWN) => {
    const ctx = hn.as(who, "usr_dana", "run_1");
    return {
      ...ctx,
      call: async (cap: string, input: unknown) => {
        calls.push({ cap, input: input as Record<string, unknown> });
        return { blockId: "blk_1", messageId: "msg_1" };
      },
    } as Harness["ctx"];
  };
  return { hn, calls, asAgent };
}
const ask = async (ctx: Harness["ctx"], input: Record<string, unknown>): Promise<any> => {
  assert.deepEqual(contractErrors("terminal.ask_signin", "in", input), [], "input");
  const out = await h["terminal.ask_signin"]!(ctx, input);
  assert.deepEqual(contractErrors("terminal.ask_signin", "out", out), [], "output");
  return out;
};
const code = async (f: () => unknown): Promise<string> => {
  try {
    await f();
  } catch (e) {
    return codeOf(e);
  }
  return "no error";
};

test("an agent's own terminal becomes one sign-in card: the question, the two answers and where it is", async () => {
  const { hn, calls, asAgent } = setup();
  const t = (await h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: OWN.id, idempotencyKey: idem() }))
    .terminal;
  const out = await ask(asAgent(OWN), {
    threadId: "thr_1",
    terminalId: t.terminalId,
    why: "  Sign in to GitHub: the terminal shows a one-time code  ",
    idempotencyKey: "k1",
  });
  assert.deepEqual(out, { blockId: "blk_1", messageId: "msg_1" });
  assert.equal(calls.length, 1);
  const q = calls[0]!;
  assert.equal(q.cap, "chat.question.ask");
  assert.equal(q.input["threadId"], "thr_1");
  assert.equal(q.input["prompt"], "Sign in to GitHub: the terminal shows a one-time code");
  assert.deepEqual(
    (q.input["options"] as Array<{ key: string }>).map((o) => o.key),
    ["done", "cannot"],
  );
  assert.deepEqual(q.input["card"], { kind: "signin", surface: "terminal", agentId: OWN.id, terminalId: t.terminalId });
  assert.equal(q.input["idempotencyKey"], "k1:q");
  assert.deepEqual(contractErrors("chat.question.ask", "in", q.input), [], "the chat accepts what was sent");
});

test("a person does not ask, another agent's terminal is refused (its tab is not yours), a missing terminal is not found, and a sign-in needs words", async () => {
  const { hn, calls, asAgent } = setup();
  const t = (await h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: OWN.id, idempotencyKey: idem() }))
    .terminal;
  assert.equal(
    await code(() => ask(hn.ctx, { threadId: "thr_1", terminalId: t.terminalId, why: "Sign in" })),
    "permission.no_grant",
  );
  assert.equal(
    await code(() => ask(asAgent(OTHER), { threadId: "thr_1", terminalId: t.terminalId, why: "Sign in" })),
    "permission.role_lacks_permission",
  );
  assert.equal(
    await code(() => ask(asAgent(OWN), { threadId: "thr_1", terminalId: "trm_nope", why: "Sign in" })),
    "validation.not_found",
  );
  assert.equal(
    await code(() => ask(asAgent(OWN), { threadId: "thr_1", terminalId: t.terminalId, why: "   " })),
    "validation.bad_input",
  );
  assert.equal(calls.length, 0, "no card for any of them");
});
