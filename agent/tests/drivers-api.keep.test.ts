// "Keep this every time" in an API engine's own compaction (lane l-sessions): the words head the summary that stands for the dropped messages, word for word, and go to the summarizer.
import test from "node:test";
import assert from "node:assert/strict";
import { compact } from "../src/drivers/api/index.ts";
import type { Msg } from "../src/drivers/api/index.ts";

const big = (n: number, role: "user" | "assistant" = "user"): Msg => (role === "user" ? { role: "user", text: "x".repeat(n) } : { role: "assistant", text: "y".repeat(n), calls: [] });
const thread = (): Msg[] => { const m: Msg[] = []; for (let i = 0; i < 12; i++) { m.push(big(3_200)); m.push(big(3_200, "assistant")); } m.push(big(400)); return m; };

test("the chat's keep text heads the summary of an automatic compaction and reaches the summarizer", async () => {
  let asked: string | undefined;
  const out = await compact(0, thread(), 10_000, async (_dropped, keep) => { asked = keep; return "SUMMARY"; }, "  the lease dates  ");
  assert.ok(out.dropped > 0);
  assert.equal(asked, "the lease dates");
  assert.match((out.messages[0] as { text: string }).text, /\nThe person asked to keep this through every compaction: the lease dates\nSUMMARY$/);
});

test("with no keep text the summary is as before, and the extract stands in when there is no summarizer", async () => {
  const plain = await compact(0, thread(), 10_000, async (_d, keep) => { assert.equal(keep, undefined); return "SUMMARY"; }, "");
  assert.doesNotMatch((plain.messages[0] as { text: string }).text, /asked to keep/);
  const extract = await compact(0, thread(), 10_000, undefined, "dates");
  assert.match((extract.messages[0] as { text: string }).text, /keep this through every compaction: dates\nAsked: x+/);
});
