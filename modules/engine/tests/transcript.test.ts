// The engine writes the canonical transcript (modules/engine/transcript.ts): the person's words and the agent's turn become rows through chat.transcript.append as the asker, tool results are
// matched to their calls, the summary is refreshed every few turns, and a transcript that cannot be written never fails the turn.
import test from "node:test";
import assert from "node:assert/strict";
import { rowsOf, turnIdOf, withTranscript, SUMMARIZE_EVERY } from "../transcript.ts";
import { createContextBuilder, KEEP_TURNS, noteHandoff, takeHandoff, withTurnContext } from "../context.ts";
import type { DriverEvent, EngineSession, OpenSession, StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";

const msg = (id: string, body: string): StoredMessage => ({ id, threadId: "thr_1", threadSeq: 1, author: { kind: "person", id: "usr_maya" }, mentions: [], depth: 0, body });
const input = (n: number, over: Partial<TurnInput> = {}): TurnInput => ({ threadId: "thr_1", turnId: `trn_${n}`, agent: { id: "agt_x", mode: "lead" }, trigger: msg(`msg_${n}`, `ask ${n}`), history: [], listeners: [], asker: "usr_maya", ...over });
const session = (events: DriverEvent[]): { open: OpenSession; results: string[] } => {
  const results: string[] = [];
  const open: OpenSession = async () => ({ warm: true, async *send() { for (const e of events) yield e; }, sendToolResult(id: string) { results.push(id); }, inject() {}, async cancel() {}, async close() {} }) as EngineSession;
  return { open, results };
};
const drain = async (s: EngineSession, i: TurnInput): Promise<void> => { for await (const _ of s.send(i)) void _; };

test("turn ids are valid transcript ids and differ for the person and the agent", () => {
  assert.match(turnIdOf("p", "msg_01A-b"), /^trn_p[a-z0-9]+$/);
  assert.notEqual(turnIdOf("p", "x_1"), turnIdOf("a", "x_1"));
});

test("a turn writes the person's words, then the agent's words, calls and results, as the asker", async () => {
  const calls: Array<{ cap: string; input: any; as?: string | undefined }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const { open, results } = session([
    { type: "text", text: "Looking." }, { type: "tool_call", id: "call_1", name: "records_query", input: { type: "contact" } }, { type: "text", text: "Found three." }, { type: "done" },
  ]);
  const s = await withTranscript(open, async (cap, i, as) => { calls.push({ cap, input: i, as }); return {}; })({} as never);
  const gen = s.send(input(1));
  for await (const e of gen) if (e.type === "tool_call") s.sendToolResult(e.id, { ok: true, content: { data: { rows: [] } } });
  assert.deepEqual(results, ["call_1"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.cap === "chat.transcript.append" && c.as === "usr_maya"));
  assert.deepEqual(calls[0]!.input.rows, [{ role: "user", kind: "text", content: "ask 1" }]);
  const kinds = calls[1]!.input.rows.map((r: { kind: string; role: string }) => `${r.role}:${r.kind}`);
  assert.deepEqual(kinds, ["assistant:text", "assistant:tool_call", "tool:tool_result", "assistant:text"]);
  assert.ok(kinds.includes("assistant:tool_call") && kinds.includes("tool:tool_result"));
});

test("a woken turn with no message writes only the agent's side, and a failing transcript never fails the turn", async () => {
  const { open } = session([{ type: "text", text: "Done." }, { type: "done" }]);
  let n = 0;
  const s = await withTranscript(open, async () => { n++; throw new Error("down"); })({} as never);
  const seen: string[] = [];
  for await (const e of s.send(input(2, { trigger: null }))) seen.push(e.type);
  assert.deepEqual(seen, ["text", "done"]);
  assert.equal(n, 1);
});

test("the rolling summary is refreshed every few turns of a thread", async () => {
  const caps: string[] = [];
  const { open } = session([{ type: "text", text: "ok" }, { type: "done" }]);
  const s = await withTranscript(open, async (cap) => { caps.push(cap); return {}; })({} as never);
  for (let i = 1; i <= SUMMARIZE_EVERY; i++) await drain(s, input(100 + i, { threadId: "thr_sum" }));
  assert.equal(caps.filter((c) => c === "chat.transcript.summarize").length, 1);
  assert.equal(caps.filter((c) => c === "chat.transcript.append").length, SUMMARIZE_EVERY * 2);
});

test("rowsOf drops empty text and keeps calls and results in order", () => {
  assert.deepEqual(rowsOf([{ kind: "text", text: " " }, { kind: "tool_call", id: "c", name: "n", tool: "run", summary: "did n", args: {}, links: [] }, { kind: "tool_result", id: "c", ok: true, output: "out", cut: false }]).map((r) => r.kind), ["tool_call", "tool_result"]);
});

test("with a summary, only the newest turns go word for word and the earlier section carries the summary; the handoff is taken once", async () => {
  const history = Array.from({ length: 40 }, (_, i) => msg(`m${i}`, `line ${i}`));
  const call = async (cap: string): Promise<unknown> => { if (cap === "chat.transcript.summary") return { summary: "Asked about the Smith matter." }; throw new Error("no"); };
  noteHandoff("thr_1", "This chat was running on Claude Code and moved to Codex.");
  const seen: TurnInput[] = [];
  const open: OpenSession = async () => ({ warm: true, async *send(i: TurnInput) { seen.push(i); yield { type: "done" as const }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} }) as EngineSession;
  const b = createContextBuilder({ call, handoff: takeHandoff });
  const s = await withTurnContext(open, b)({} as never);
  await drain(s, input(1, { history }));
  assert.equal(seen[0]!.history.length, KEEP_TURNS);
  assert.equal(seen[0]!.history.at(-1)!.body, "line 39");
  assert.match(seen[0]!.context!.sections.find((x) => x.id === "earlier")!.text, /^Asked about the Smith matter\./);
  assert.match(seen[0]!.context!.sections.find((x) => x.id === "handoff")!.text, /moved to Codex/);
  await drain(s, input(2, { history }));
  assert.ok(!seen[1]!.context!.sections.some((x) => x.id === "handoff"));
});

test("with no summary the whole history stays", async () => {
  const history = Array.from({ length: 30 }, (_, i) => msg(`m${i}`, `line ${i}`));
  const seen: TurnInput[] = [];
  const open: OpenSession = async () => ({ warm: true, async *send(i: TurnInput) { seen.push(i); yield { type: "done" as const }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} }) as EngineSession;
  const s = await withTurnContext(open, createContextBuilder({ call: async () => ({ summary: "" }) }))({} as never);
  await drain(s, input(3, { history }));
  assert.equal(seen[0]!.history.length, 30);
});
