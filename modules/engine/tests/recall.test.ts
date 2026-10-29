// Per-message recall and the memory blocks of the system prompt (spec 2.15): the pointer is asked as the person who wrote, a failing memory never holds a turn up,
// the MAP.md block is stable and the recalled lines are volatile, and a CLI engine's prompt carries the same lines with their source.
import test from "node:test";
import assert from "node:assert/strict";
import { withRecall, recallFor } from "../recall.ts";
import { roleBlocks } from "../session.ts";
import { recallText } from "../../../agent/src/turn-engine/recall.ts";
import { defaultPrompt } from "../../../agent/src/drivers/cli/prompt.ts";
import type { EngineSession, StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";

const LINE = { title: "Preference", fact: "I prefer short answers.", path: "memory/person", sourceLink: "/chats/thr_one", trueSince: Date.UTC(2026, 9, 1) };
const msg = (body: string, kind = "person"): StoredMessage => ({ id: "msg_1", author: { kind, id: kind === "person" ? "usr_dana" : "agt_intake" }, body } as StoredMessage);
const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  threadId: "thr_two", turnId: "trn_1", agent: { id: "agt_intake" } as TurnInput["agent"], trigger: msg("how long should answers be?"), history: [], listeners: [], asker: "usr_dana", ...over,
});

test("recall asks memory.pointer as the asker with the message text, and keeps its lines", async () => {
  const calls: Array<{ cap: string; input: unknown; as?: string | undefined }> = [];
  const lines = await recallFor(async (cap, i, as) => { calls.push({ cap, input: i, as }); return { lines: [LINE] }; }, input());
  assert.deepEqual(lines, [LINE]);
  assert.deepEqual(calls.map((c) => [c.cap, c.as]), [["memory.pointer", "usr_dana"], ["memory.quote", "usr_dana"]]);
  assert.deepEqual(calls[0]!.input, { threadId: "thr_two", agentId: "agt_intake", text: "how long should answers be?" });
  // the quote lookup leaves out the chat the asker is in: the model already has it
  assert.deepEqual(calls[1]!.input, { q: "how long should answers be?", excludeThreadId: "thr_two", limit: 3, minCoverage: 0.6 });
});

test("quotes join the recall as exact words with their source id, who said them and when; a long one is cut and says so", async () => {
  const long = "x".repeat(400);
  const lines = await recallFor(async (cap) => (cap === "memory.pointer" ? { lines: [] } : {
    quotes: [
      { ref: "msg_9", text: "The retainer cap is 4,500 a month.", author: { id: "usr_maya", name: "Maya Cole" }, at: Date.UTC(2026, 9, 12), threadTitle: "Retainers", threadId: "thr_one", link: "vyre://thread/thr_one?m=msg_9" },
      { ref: "thr_two#7", text: `${long}\nnext line`, author: { id: "usr_dana" }, at: Date.UTC(2026, 9, 13), threadId: "thr_two", link: "vyre://thread/thr_two?step=7" },
    ],
  }), input());
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { kind: "quote", ref: "msg_9", title: "\"Retainers\"", fact: "The retainer cap is 4,500 a month.", path: "vyre://thread/thr_one?m=msg_9", sourceLink: "vyre://thread/thr_one?m=msg_9", by: "Maya Cole", at: Date.UTC(2026, 9, 12) });
  assert.equal(lines[1]!.cut, true);
  assert.equal(lines[1]!.by, "you", "the asker's own words are credited to you");
  assert.ok(!lines[1]!.fact!.includes("\n"), "a quote is one line of the block");
  const text = recallText(lines);
  assert.match(text, /- Quote \[msg_9\] Maya Cole, 2026-10-12, in "Retainers": "The retainer cap is 4,500 a month\." \(open: vyre:\/\/thread\/thr_one\?m=msg_9\)/);
  assert.match(text, /\(cut: memory_quote with the ref gives the whole line\)/);
});

test("a failing quote lookup leaves the facts, and a failing pointer leaves the quotes", async () => {
  const q = { quotes: [{ ref: "msg_9", text: "hello there", author: { id: "usr_dana" }, at: 1, threadId: "thr_one", link: "vyre://thread/thr_one?m=msg_9" }] };
  assert.deepEqual(await recallFor(async (cap) => { if (cap === "memory.quote") throw new Error("x"); return { lines: [LINE] }; }, input()), [LINE]);
  assert.equal((await recallFor(async (cap) => { if (cap === "memory.pointer") throw new Error("x"); return q; }, input())).length, 1);
});

test("no recall for a wake, a resumed call or a message an agent wrote, and a failing memory gives none", async () => {
  let asked = 0;
  const call = async (): Promise<unknown> => { asked++; return { lines: [LINE] }; };
  assert.deepEqual(await recallFor(call, input({ trigger: null })), []);
  assert.deepEqual(await recallFor(call, input({ trigger: msg("done", "agent") })), []);
  assert.deepEqual(await recallFor(call, input({ resumed: { taskId: "tsk_1", callId: "c", toolName: "t", approved: true, result: { ok: true, content: null } } })), []);
  assert.equal(asked, 0);
  assert.deepEqual(await recallFor(async () => { throw new Error("memory down"); }, input()), []);
});

test("a wrapped session sends the recall on the turn input and leaves the session's own members alone", async () => {
  const seen: TurnInput[] = [];
  const inner = { warm: true, send: async function* (i: TurnInput) { seen.push(i); yield { type: "text" as const, text: "ok" }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} } as unknown as EngineSession;
  const open = withRecall(async () => inner, async () => ({ lines: [LINE] }));
  const s = await open({} as never);
  assert.equal(s.warm, true);
  const out: unknown[] = [];
  for await (const e of s.send(input())) out.push(e);
  assert.deepEqual(out, [{ type: "text", text: "ok" }]);
  assert.deepEqual(seen[0]?.recall, [LINE]);
});

test("the system prompt has stable role, rules and MAP.md, then the recalled lines as a volatile block", async () => {
  const call = async (cap: string): Promise<unknown> => (cap === "agents.get" ? { agent: { name: "Intake", role: "You answer intake questions." } } : { map: { body: "# Memory map\n- Billing (notes/billing.md)" } });
  const blocks = await roleBlocks(call)({ agent: { id: "agt_intake" }, asker: "usr_dana" } as never, input({ recall: [LINE] }));
  assert.deepEqual(blocks.map((b) => b.stable), [true, true, true, false]);
  assert.match(blocks[0]!.text, /You are Intake/);
  assert.match(blocks[2]!.text, /Billing \(notes\/billing.md\)/);
  assert.match(blocks[3]!.text, /I prefer short answers\. \(source: \/chats\/thr_one, true since 2026-10-01\)/);
  const none = await roleBlocks(async (cap) => { if (cap === "memory.map.get") throw new Error("nope"); return { agent: { name: "Intake" } }; })({ agent: { id: "agt_intake" }, asker: "usr_dana" } as never, input());
  assert.deepEqual(none.map((b) => b.stable), [true, true], "no map and nothing recalled: only the stable blocks");
});

test("a CLI engine's prompt carries the recalled lines with their source, before the message", () => {
  const p = defaultPrompt(input({ recall: [LINE] }), true);
  assert.match(p, /\(source: \/chats\/thr_one/);
  assert.ok(p.indexOf("From memory") < p.indexOf("how long should answers be?"));
  assert.doesNotMatch(defaultPrompt(input(), true), /From memory/);
});
