// The owner walk's model stand-in (test/ownerwalk-kit.test.ts uses it): a short plain reply streamed word by word, a LONG ask that runs long enough to press Stop, a title for the title request,
// and `TOOL <name> <json>` as a real tool call (found with tool_search first, as a model must).
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../../agent/src/turn-engine/types.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The reply a person reads: one short sentence that names what was asked, streamed a word at a time. "LONG" in the message makes a reply of about ten seconds, for Stop. */
export function replyFor(body: string): string {
  const asked = body.replace(/\s+/g, " ").trim().slice(0, 80);
  if (/LONG/.test(body)) return Array.from({ length: 60 }, (_, i) => `Step ${i + 1} of the plan is written out here in plain words.`).join(" ");
  return `Sure. Here is what I found about "${asked}": the three items are ready, and I put a short summary in the project notes.`;
}

/** The stand-in model: plain streamed text, or a tool call for `TOOL <name> <json>` (found with tool_search first, as a model must). */
export const walkModel: OpenSession = async () => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  let stopped = false;
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      stopped = false;
      const body = String(input.trigger?.body ?? "");
      const m = /TOOL (\w+) (\{.*\})/.exec(body);
      if (!m && body.startsWith("The request:")) { yield { type: "text", text: "Launch week plan" }; yield { type: "done" }; return; }
      if (!m) {
        for (const w of replyFor(body).split(" ")) { if (stopped) break; yield { type: "text", text: `${w} ` }; await sleep(/LONG/.test(body) ? 40 : 25); }
        yield { type: "usage", inputTokens: 900, outputTokens: 60 };
        yield { type: "done" };
        return;
      }
      const first = `call_${waiting.size + 1}`;
      const found = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(first, resolve));
      yield { type: "tool_call", id: first, name: "tool_search", input: { query: m[1]! } };
      await found;
      const id = `call_${waiting.size + 1}`;
      const result = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(id, resolve));
      yield { type: "tool_call", id, name: m[1]!, input: JSON.parse(m[2]!) };
      const r = await result;
      yield { type: "text", text: r.ok ? "Done. It worked." : `That did not work: ${JSON.stringify(r.content).slice(0, 120)}` };
      yield { type: "done" };
    },
    sendToolResult(callId: string, result: { ok: boolean; content: unknown }) { waiting.get(callId)?.(result); },
    inject() {}, async cancel() { stopped = true; }, async close() {},
  } as EngineSession;
};

