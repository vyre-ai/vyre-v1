// automations.step_ask is the step engine's marker: a chat post that a step is set to ask about passes the Gate here first, and the call itself does nothing. Only a call another capability made (the
// step engine's) may use it: a member or an agent calling it themselves is refused, so no one can raise a held "post a chat message" card with words of their own.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";

const ctx = (principal: { kind: string; id: string }, depth: number) =>
  ({ space: "spc_t", principal, trace: { traceId: "0123456789abcdef0123456789abcdef" }, depth, now: () => 1 }) as never;
const ask = handlers["automations.step_ask"] as (c: never, i: unknown) => unknown;

test("a call from a person or an agent, straight from the gateway, is refused", () => {
  for (const who of [
    { kind: "agent", id: "agt_scout" },
    { kind: "person", id: "usr_mia" },
  ])
    assert.throws(
      () => ask(ctx(who, 0), { act: "post", text: "Wire the money now" }),
      (e: { error?: { code?: string } }) => e.error?.code === "permission.no_grant",
      who.kind,
    );
});

test("the step engine's own call (another capability made it) still goes through", () => {
  assert.deepEqual(ask(ctx({ kind: "service", id: "aut_1" }, 1), { act: "post", text: "Hello" }), { ok: true });
  assert.deepEqual(
    ask(ctx({ kind: "person", id: "usr_mia" }, 2), { act: "post" }),
    { ok: true },
    "a step run as its owner is still a call another capability made",
  );
});
