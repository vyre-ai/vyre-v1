// A card in a message carries the reader's level when the message is served (owner, 4 Nov): the first draw of a link is already right, so no link flips after it draws.
import test from "node:test";
import assert from "node:assert/strict";
import { attachReach } from "../handlers/reach-attach.ts";
import type { ChatCtx } from "../projections.ts";

const card = (target: { type: string; id: string } | undefined) => ({ type: "link_card", v: 1, id: "blk_1", data: { icon: "task", lead: "Task created", title: "Send the retainer", ...(target ? { target } : {}) } });
const msg = (...blocks: unknown[]) => ({ messageId: "msg_1", blocks });

function ctxOf(levels: Record<string, string>, calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }>): ChatCtx {
  return { call: async (cap: string, input: unknown) => { const i = input as { items: Array<{ type: string; id: string }> }; calls.push({ cap, input: i }); return { items: i.items.map((x) => ({ ...x, level: levels[`${x.type}:${x.id}`] ?? "none" })) }; } } as unknown as ChatCtx;
}

test("each card that names a thing carries the reader's level, from one access.reach call for the whole page", async () => {
  const calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }> = [];
  const ctx = ctxOf({ "task:tsk_1": "view", "file:fil_2": "none" }, calls);
  const stored = [msg(card({ type: "task", id: "tsk_1" })), msg(card({ type: "file", id: "fil_2" }), card({ type: "task", id: "tsk_1" }))];
  const out = await attachReach(ctx, stored);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.input.items.map((x) => `${x.type}:${x.id}`).sort(), ["file:fil_2", "task:tsk_1"], "each thing once");
  const levels = out.flatMap((m) => (m.blocks as Array<{ data: { reach?: string } }>).map((b) => b.data.reach));
  assert.deepEqual(levels, ["view", "none", "view"]);
  assert.equal((stored[0]!.blocks[0] as { data: { reach?: string } }).data.reach, undefined, "the stored message is untouched");
});

test("a page with no card, a card with no target, or a thing the Space's access does not judge makes no call", async () => {
  const calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }> = [];
  const ctx = ctxOf({}, calls);
  const out = await attachReach(ctx, [msg({ type: "text", data: {} }), msg(card(undefined)), msg(card({ type: "fact", id: "fct_1" }))]);
  assert.equal(calls.length, 0);
  assert.equal(out.length, 3);
});

test("a call that fails leaves the cards as they were", async () => {
  const ctx = { call: async () => { throw new Error("down"); } } as unknown as ChatCtx;
  const m = msg(card({ type: "task", id: "tsk_1" }));
  const out = await attachReach(ctx, [m]);
  assert.deepEqual(out[0], m);
});
