// A chat nobody named takes its name from the first thing a person says in it; a name given up front, or a later message, leaves it alone.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { INTAKE, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { titleFrom } from "../handlers/post.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const start = async (hn: Harness, extra: Record<string, unknown> = {}) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `s${++n}`, ...extra })).thread.threadId as string;
const say = (hn: Harness, threadId: string, body: string) => h["chat.post"]!(hn.ctx, { threadId, body, idempotencyKey: `p${++n}` });
const titleOf = async (hn: Harness, threadId: string) => (await h["threads.get"]!(hn.ctx, { threadId })).thread.title as string | undefined;

test("a short first message is the name, a long one is cut at a word, mentions and markup are dropped", () => {
  assert.equal(titleFrom("Draft the letter to Maya."), "Draft the letter to Maya");
  assert.equal(titleFrom("@Billing **what** does the `lease` say?"), "what does the lease say?");
  assert.equal(titleFrom("a"), null);
  assert.equal(titleFrom("   \n  "), null);
  const long = titleFrom("Please go through every invoice from the third quarter and flag the ones that are overdue by more than a month");
  assert.ok(long!.endsWith("…") && long!.length <= 49, long!);
  assert.equal(titleFrom("\n\nsecond line is the first with words\nmore"), "second line is the first with words");
});

test("the first message names an unnamed chat, and only the first", async () => {
  const hn = harness();
  const t = await start(hn);
  assert.equal(await titleOf(hn, t), undefined);
  await say(hn, t, "Summarise the Rivera matter for Friday");
  assert.equal(await titleOf(hn, t), "Summarise the Rivera matter for Friday");
  await say(hn, t, "and add the invoices");
  assert.equal(await titleOf(hn, t), "Summarise the Rivera matter for Friday");
});

test("a chat that was given a name keeps it", async () => {
  const hn = harness();
  const t = await start(hn, { title: "Q4 billing" });
  await say(hn, t, "something else entirely");
  assert.equal(await titleOf(hn, t), "Q4 billing");
});
