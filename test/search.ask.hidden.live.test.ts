// Ask the Space must not put a field the asker's grant hides in front of the model. A member whose grant hides a contact's email and phone asks "what is the email of <the visible name>" and asks a question that matches
// the hidden email text itself; a stand-in model captures every prompt and echoes its sources back as the answer. Neither the prompt nor the answer may hold a hidden word, fragment or digit run. The control: the owner's
// ask does put the email in its prompt, so the probe is not empty.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";
import type { DriverEvent, EngineSession, OpenSession, ToolResult, TurnInput } from "../agent/src/turn-engine/types.ts";

const prompts: Array<{ asker: string; prompt: string }> = [];
const capture: OpenSession = async (spec) => {
  const waiting = new Map<string, (r: ToolResult) => void>();
  let n = 0;
  async function* run(name: string, input: unknown): AsyncGenerator<DriverEvent, ToolResult> {
    const id = `call_${++n}`;
    const answer = new Promise<ToolResult>((resolve) => waiting.set(id, resolve));
    yield { type: "tool_call", id, name, input };
    return answer;
  }
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const prompt = String(input.trigger?.body ?? "");
      // an agent asked, in a chat, to use its Ask the Space tool for the person
      const viaAgent = /^ASKPROBE (.*)$/.exec(prompt);
      if (viaAgent) {
        yield* run("tool_search", { query: "search ask the space question" });
        const r = yield* run("search_ask", { q: viaAgent[1] });
        yield { type: "text", text: `ASKED ${JSON.stringify(r.content).slice(0, 3000)}` };
        yield { type: "done" };
        return;
      }
      if (!prompt.startsWith("Question:")) {
        yield { type: "done" };
        return;
      }
      prompts.push({ asker: spec.asker, prompt });
      // a model that quotes its first source in full
      const first = /\[1\]([\s\S]*?)(?:\n\n\[2\]|$)/.exec(prompt)?.[1] ?? "";
      yield { type: "text", text: `The first source says: ${first.replace(/\[|\]/g, "")} [1]` };
      yield { type: "done" };
    },
    sendToolResult(id: string, r: ToolResult) {
      waiting.get(id)?.(r);
      waiting.delete(id);
    },
    inject() {},
    async cancel() {},
    async close() {},
  } as EngineSession;
};

let h: Hour;
before(async () => {
  h = await bootHour("askhidden", { engineOpenSession: capture });
});
after(async () => {
  await h?.stop();
});

async function indexed(word: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await h.d.hooks?.pump?.();
    const hits = (await h.owner.call("search.query", { q: word })) as { hits: unknown[] };
    if (hits.hits.length) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.fail(`the index never held ${word}`);
}

test("a member whose grant hides email and phone gets none of it in the prompt or the answer of Ask the Space, however the question is put; the owner's prompt does hold the email", async () => {
  const f = await hiddenMember(h);
  await indexed(f.values.newEmail.split("@")[0]!);
  const fragments = [...f.hidden, ...f.hidden.flatMap((v) => v.match(/\d{4,}/g) ?? [])];
  const questions = [
    `tell me about Probe Hana`,
    `what is the email of Probe Hana`,
    `what is the phone number of Probe Hana`,
    `which contact has the email ${f.values.newEmail}`,
    `who is ${f.hidden[4]}`,
  ];
  // control: the owner's ask puts the email in its prompt
  prompts.length = 0;
  await new Promise((r) => setTimeout(r, 1_500));
  const own = (await h.owner.call("search.ask", { q: "tell me about Probe Hana" })) as { state: string };
  assert.equal(own.state, "answered", JSON.stringify(own));
  assert.ok(
    prompts.some((p) => p.prompt.includes(f.values.newEmail)),
    "control: the owner's prompt holds the email, so the probe is not empty",
  );
  // the member
  let asked = 0;
  for (const q of questions) {
    prompts.length = 0;
    await new Promise((r) => setTimeout(r, 1_500)); // search.ask is rate limited
    const got = (await f.member.call("search.ask", { q })) as { state: string; answer?: string; sources: unknown[] };
    const seen = prompts.map((p) => p.prompt).join("\n---\n");
    if (prompts.length) asked++;
    assert.deepEqual(f.leaks(seen), [], `"${q}": no hidden value in the prompt: ${seen.slice(0, 600)}`);
    assert.deepEqual(f.leaks(got), [], `"${q}": no hidden value in the answer or its sources`);
    for (const frag of fragments) assert.ok(!seen.includes(frag), `"${q}": the prompt holds no fragment ${frag}`);
  }
  assert.ok(asked >= 1, "at least one of the member's questions reached the model (the probe is not empty)");
});

test("an agent acting for the member, through its search_ask tool, puts none of the hidden values in the model's prompt or in what it hands back; the same agent for the owner does carry the email", async () => {
  const f = await hiddenMember(h);
  await indexed(f.values.newEmail.split("@")[0]!);
  // the agent may read the record in its own right: what it hands the member back must still be the member's view
  await h.owner.call("access.share", {
    resource: { type: "record", id: f.rid },
    subject: { kind: "agent", id: h.agentId },
    level: "view",
    idempotencyKey: "ask-agent-share",
  });
  const via = async (who: { call: Hour["owner"]["call"] }, q: string): Promise<{ said: string; seen: string }> => {
    prompts.length = 0;
    const chat = (await who.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread.threadId as string;
    await who.call("chat.post", { threadId: chat, body: `ASKPROBE ${q}`, idempotencyKey: `ask-via-${Math.random()}` });
    let said = "";
    for (let i = 0; i < 60 && !said; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const list = (await who.call("chat.messages.list", { threadId: chat })) as { messages: Array<{ body?: string }> };
      said = list.messages.map((m) => m.body ?? "").find((b) => b.startsWith("ASKED")) ?? "";
    }
    return { said, seen: prompts.map((p) => p.prompt).join("\n---\n") };
  };
  const own = await via(h.owner, "tell me about Probe Hana");
  assert.ok(own.said !== "", "control: the agent answered the owner");
  assert.ok(own.seen.includes(f.values.newEmail), "control: through the agent the owner's prompt holds the email");
  const got = await via(f.member, "tell me about Probe Hana");
  assert.ok(got.said !== "", "the agent answered the member");
  assert.ok(got.seen !== "", "the member's question reached the model through the agent's tool");
  assert.deepEqual(f.leaks(got.seen), [], `no hidden value in the prompt: ${got.seen.slice(0, 500)}`);
  assert.deepEqual(f.leaks(got.said), [], "no hidden value in what the agent handed back");
});
