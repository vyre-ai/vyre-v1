// Per-message recall and the memory blocks of the system prompt (spec 2.15): the pointer is asked as the person who wrote, a failing memory never holds a turn up,
// the MAP.md block is stable and the recalled lines are volatile, and a CLI engine's prompt carries the same lines with their source.
import test from "node:test";
import assert from "node:assert/strict";
import { withRecall, recallFor } from "../recall.ts";
import { roleBlocks } from "../session.ts";
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
  assert.deepEqual(calls, [{ cap: "memory.pointer", input: { threadId: "thr_two", agentId: "agt_intake", text: "how long should answers be?" }, as: "usr_dana" }]);
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
