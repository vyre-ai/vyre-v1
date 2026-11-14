// A long chat's chapters are headed after a completed turn, in the background, as the asker, on the account the turn ran on; a failed turn, a routine and a turn with no account do nothing, and a failing call is logged and never thrown.
import test from "node:test";
import assert from "node:assert/strict";
import { chaptersAfterTurn } from "../chapters-after.ts";
import type { ResolvedAccount, TurnRow } from "../../../agent/src/turn-engine/types.ts";

const turn = (o: Partial<TurnRow> = {}): TurnRow =>
  ({
    id: "trn_1",
    threadId: "thr_1",
    asker: "usr_dana",
    state: "completed",
    routine: false,
    ...o,
  }) as unknown as TurnRow;
const account = {
  ref: "#Dana",
  driver: "claude_code",
  kind: "subscription",
  payer: "usr_dana",
} as unknown as ResolvedAccount;
const wait = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("a completed turn hands the chat to chat.chapters_write once, as the asker, with the account, and returns at once", async () => {
  const seen: Array<{ cap: string; input: any; as?: string | undefined }> = [];
  const h = {
    call: async (cap: string, input: unknown, as?: string) => {
      seen.push({ cap, input, as });
      return { written: 0 };
    },
  };
  assert.equal(chaptersAfterTurn(h, turn(), account), true);
  assert.equal(seen.length, 0, "scheduled, not run inside the turn");
  await wait();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {
    cap: "chat.chapters_write",
    input: { threadId: "thr_1", account: { ref: "#Dana", driver: "claude_code", kind: "subscription" } },
    as: "usr_dana",
  });
});

test("a failed turn, a routine, an agent as asker and no account do nothing; a call that fails is logged, never thrown", async () => {
  let n = 0;
  const logs: string[] = [];
  const h = {
    call: async () => {
      n++;
      throw new Error("down");
    },
    log: (m: string) => void logs.push(m),
  };
  assert.equal(chaptersAfterTurn(h, turn({ state: "failed" } as never), account), false);
  assert.equal(chaptersAfterTurn(h, turn({ routine: true } as never), account), false);
  assert.equal(chaptersAfterTurn(h, turn({ asker: "agt_x" }), account), false);
  assert.equal(chaptersAfterTurn(h, turn(), null), false);
  await wait();
  assert.equal(n, 0);
  assert.equal(chaptersAfterTurn(h, turn(), account), true);
  await wait();
  assert.equal(n, 1);
  assert.deepEqual(logs, ["chapters were not written after a turn"]);
});
