// computers.browser.ask_signin (rc.44): an agent asks a person to sign in for it in its own browser. The chat gets the one sign-in card (a question with card kind signin, answers done and cannot) where the agent
// asked; only an agent asks. Every input and output is checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { sbrowserHandlers } from "../sbrowser/handlers.ts";
import { codeOf, DANA, harness } from "../fixtures/harness.ts";
import { contractErrors } from "../../terminal/fixtures/harness.ts";

type Ctx = ReturnType<typeof harness>["ctx"];
const ask = sbrowserHandlers["computers.browser.ask_signin"] as unknown as (
  ctx: Ctx,
  input: Record<string, unknown>,
) => Promise<unknown>;

function ctxOf(
  principal: { kind: "agent" | "person"; id: string },
  calls: Array<{ cap: string; input: Record<string, unknown> }>,
): Ctx {
  const h = harness({ principal, actingFor: DANA });
  return {
    ...h.ctx,
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input: input as Record<string, unknown> });
      return { blockId: "blk_1", messageId: "msg_1" };
    },
  } as Ctx;
}
const code = async (f: () => unknown): Promise<string> => {
  try {
    await f();
  } catch (e) {
    return codeOf(e);
  }
  return "no error";
};

test("an agent's ask becomes one sign-in card for its own browser, with the site when it knows it", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const input = {
    threadId: "thr_1",
    why: " Sign in to the county portal ",
    site: "records.example.gov",
    idempotencyKey: "k1",
  };
  assert.deepEqual(contractErrors("computers.browser.ask_signin", "in", input), []);
  const out = await ask(ctxOf({ kind: "agent", id: "agt_dex" }, calls), input);
  assert.deepEqual(out, { blockId: "blk_1", messageId: "msg_1" });
  assert.deepEqual(contractErrors("computers.browser.ask_signin", "out", out), []);
  const q = calls[0]!;
  assert.equal(q.cap, "chat.question.ask");
  assert.equal(q.input["prompt"], "Sign in to the county portal");
  assert.deepEqual(q.input["card"], {
    kind: "signin",
    surface: "browser",
    agentId: "agt_dex",
    site: "records.example.gov",
  });
  assert.deepEqual(
    (q.input["options"] as Array<{ key: string }>).map((o) => o.key),
    ["done", "cannot"],
  );
  assert.equal(q.input["idempotencyKey"], "k1:q");
  assert.deepEqual(contractErrors("chat.question.ask", "in", q.input), []);
});

test("a person does not ask, and a sign-in needs words", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  assert.equal(
    await code(() => ask(ctxOf({ kind: "person", id: DANA }, calls), { threadId: "thr_1", why: "Sign in" })),
    "permission.no_grant",
  );
  assert.equal(
    await code(() => ask(ctxOf({ kind: "agent", id: "agt_dex" }, calls), { threadId: "thr_1", why: "  " })),
    "validation.bad_input",
  );
  assert.equal(calls.length, 0);
});
