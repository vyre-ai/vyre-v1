// Ask the Space must not put a field the asker's grant hides in front of the model. A member whose grant hides a contact's email and phone asks "what is the email of <the visible name>" and asks a question that matches
// the hidden email text itself; a stand-in model captures every prompt and echoes its sources back as the answer. Neither the prompt nor the answer may hold a hidden word, fragment or digit run. The control: the owner's
// ask does put the email in its prompt, so the probe is not empty.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const prompts: Array<{ asker: string; prompt: string }> = [];
const capture: OpenSession = async (spec) =>
  ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const prompt = String(input.trigger?.body ?? "");
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
    sendToolResult() {},
    inject() {},
    async cancel() {},
    async close() {},
  }) as EngineSession;

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
