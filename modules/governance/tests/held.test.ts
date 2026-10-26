// The removal wizard asks governance which of a person's items are on legal hold (members.owned.holds): the owning modules' ids, plus a hold on the person themselves.
// @reads /modules/governance/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { hostCalls } from "../impl.ts";

const ctxOf = (holds: { kind: string; targetId: string }[]): Ctx => ({ db: { all: () => holds, run: () => ({ changes: 0 }) } }) as unknown as Ctx;
const held = hostCalls["governance.held_among"];

test("held_among counts the person's items that are on hold and a hold on the person", () => {
  const ctx = ctxOf([{ kind: "file", targetId: "fil_1" }, { kind: "thread", targetId: "thr_9" }, { kind: "person", targetId: "usr_a" }]);
  assert.equal(held(ctx, { person: "usr_b", ids: ["fil_1", "agt_2"] }), 1, "one item on hold");
  assert.equal(held(ctx, { person: "usr_a", ids: [] }), 1, "the person is on hold");
  assert.equal(held(ctx, { person: "usr_a", ids: ["fil_1", "thr_9"] }), 3);
  assert.equal(held(ctx, { person: "usr_b", ids: ["agt_2"] }), 0);
});

test("a person-kind hold on someone else, or a plain id that looks like the person, does not count", () => {
  const ctx = ctxOf([{ kind: "person", targetId: "usr_other" }]);
  assert.equal(held(ctx, { person: "usr_b", ids: ["usr_other"] }), 0);
});

test("a governance store that is not set up yet holds nothing", () => {
  const ctx = { db: { all: () => { throw new Error("no such table"); } } } as unknown as Ctx;
  assert.equal(held(ctx, { person: "usr_a", ids: ["fil_1"] }), 0);
});
