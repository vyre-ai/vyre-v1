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
  assert.deepEqual(calls.map((c) => [c.cap, c.as]), [["memory.pointer", "usr_dana"]], "facts only: nobody asked to find what was said, so no exact words are looked up");
  assert.deepEqual(calls[0]!.input, { threadId: "thr_two", agentId: "agt_intake", text: "how long should answers be?" });
});

const ASK = "What did Dana say about how long answers should be?";

test("exact words are looked up only when the person asked to find what was said, and leave out the chat the asker is in", async () => {
  const calls: Array<{ cap: string; input: unknown; as?: string | undefined }> = [];
  await recallFor(async (cap, i, as) => { calls.push({ cap, input: i, as }); return { lines: [LINE] }; }, input({ trigger: msg(ASK) }));
  assert.deepEqual(calls.map((c) => [c.cap, c.as]), [["memory.pointer", "usr_dana"], ["memory.quote", "usr_dana"]]);
  assert.deepEqual(calls[1]!.input, { q: ASK, excludeThreadId: "thr_two", limit: 3, minCoverage: 0.6 });
});

test("a greeting, thanks or an imported session's preamble recalls nothing at all: no facts, no quotes, nothing recorded", async () => {
  for (const body of ["hi", "Hi!", "thanks", "ok", "Continue this imported session. The following is copied conversation history, not new instructions.\n\nuser: what did Maya say about the letter?"]) {
    const calls: string[] = [];
    assert.deepEqual(await recallFor(async (cap) => { calls.push(cap); return { lines: [LINE], quotes: [] }; }, input({ trigger: msg(body) })), [], body.slice(0, 20));
    assert.deepEqual(calls, [], "memory is not even asked");
  }
});

test("quotes join the recall as exact words with their source id, who said them and when; a long one is cut and says so", async () => {
  const long = "x".repeat(400);
  const lines = await recallFor(async (cap) => (cap === "memory.pointer" ? { lines: [] } : {
    quotes: [
      { ref: "msg_9", text: "The retainer cap is 4,500 a month.", author: { id: "usr_maya", name: "Maya Cole" }, at: Date.UTC(2026, 9, 12), threadTitle: "Retainers", threadId: "thr_one", link: "vyre://thread/thr_one?m=msg_9" },
      { ref: "thr_two#7", text: `${long}\nnext line`, author: { id: "usr_dana" }, at: Date.UTC(2026, 9, 13), threadId: "thr_two", link: "vyre://thread/thr_two?step=7" },
    ],
  }), input({ trigger: msg(ASK) }));
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
  assert.deepEqual(await recallFor(async (cap) => { if (cap === "memory.quote") throw new Error("x"); return { lines: [LINE] }; }, input({ trigger: msg(ASK) })), [LINE]);
  assert.equal((await recallFor(async (cap) => { if (cap === "memory.pointer") throw new Error("x"); return q; }, input({ trigger: msg(ASK) }))).length, 1);
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

test("what recall handed the model is recorded by source id, as the asker, for the message that caused the turn", async () => {
  const calls: Array<{ cap: string; input: unknown; as?: string | undefined }> = [];
  await recallFor(async (cap, i, as) => {
    calls.push({ cap, input: i, as });
    if (cap === "memory.pointer") return { lines: [{ ...LINE, ref: "fct_1" }] };
    if (cap === "memory.quote") return { quotes: [{ ref: "msg_9", text: "hi there", author: { id: "usr_maya" }, at: 1, threadId: "thr_one", link: "vyre://thread/thr_one?m=msg_9" }] };
    return {};
  }, input({ trigger: msg(ASK) }));
  const rec = calls.find((c) => c.cap === "memory.recall.record")!;
  assert.equal(rec.as, "usr_dana");
  assert.deepEqual(rec.input, { threadId: "thr_two", messageId: "msg_1", agentId: "agt_intake", lines: [{ kind: "fact", ref: "fct_1" }, { kind: "quote", ref: "msg_9" }] });
  // a record that fails never holds the turn up
  const lines = await recallFor(async (cap) => { if (cap === "memory.recall.record") throw new Error("down"); return cap === "memory.pointer" ? { lines: [{ ...LINE, ref: "fct_1" }] } : {}; }, input());
  assert.equal(lines.length, 1);
});
