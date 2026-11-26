// A check hook is read by a small model with the event as JSON. A member whose grant hides a contact's email and phone makes a check hook on the tool that reads the record; the agent reads the record for her, and the
// stand-in model captures every hook prompt. The event the hook sends must carry only what she may see. The control: the same hook of the owner does carry the email, so the probe is not empty.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";
import type { DriverEvent, EngineSession, OpenSession, ToolResult, TurnInput } from "../agent/src/turn-engine/types.ts";

const hookPrompts: string[] = [];
const model: OpenSession = async () => {
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
      const body = String(input.trigger?.body ?? "");
      if (body.startsWith("Rule:")) {
        hookPrompts.push(body);
        yield { type: "text", text: "allow" };
        yield { type: "done" };
        return;
      }
      const peek = /^PEEKH (rec_[A-Za-z0-9]+)/.exec(body);
      if (peek) {
        yield* run("tool_search", { query: "records get" });
        const r = yield* run("records_get", { type: "contact", recordId: peek[1] });
        yield { type: "text", text: `PEEKED ${r.ok ? "ok" : "refused"}` };
        yield { type: "done" };
        return;
      }
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
  h = await bootHour("hookhidden", { engineOpenSession: model });
});
after(async () => {
  await h?.stop();
});

async function peekAs(who: Pick<Person, "call">, rid: string): Promise<string[]> {
  hookPrompts.length = 0;
  const chat = (await who.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread.threadId as string;
  await who.call("hooks.set", {
    scope: "chat",
    threadId: chat,
    event: "tool.after",
    matcher: "records_get",
    kind: "check",
    instruction: "Allow anything.",
    summary: "after a record is read, check it",
  });
  await who.call("chat.post", { threadId: chat, body: `PEEKH ${rid}`, idempotencyKey: `hook-peek-${Math.random()}` });
  for (let i = 0; i < 60 && hookPrompts.length === 0; i++) await new Promise((r) => setTimeout(r, 1000));
  return [...hookPrompts];
}

test("a member's check hook on the tool that reads a record is sent none of the fields her grant hides, and the owner's is", async () => {
  const f = await hiddenMember(h);
  await h.owner.call("access.share", {
    resource: { type: "record", id: f.rid },
    subject: { kind: "agent", id: h.agentId },
    level: "view",
    idempotencyKey: "hook-agent-share",
  });
  const own = await peekAs(h.owner, f.rid);
  assert.ok(own.length > 0, "control: the owner's hook was asked");
  assert.ok(
    own.some((p) => p.includes(f.values.newEmail)),
    "control: the owner's hook event carries the email, so the probe is not empty",
  );
  const got = await peekAs(f.member, f.rid);
  assert.ok(got.length > 0, "the member's hook was asked");
  assert.deepEqual(
    f.leaks(got.join("\n---\n")),
    [],
    `no hidden value in what the hook sends the model: ${got.join("\n---\n").slice(0, 600)}`,
  );
});
