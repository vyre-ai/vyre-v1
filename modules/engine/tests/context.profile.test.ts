// The person section of the turn context: the memory module's profile context, asked as the person who wrote the message, written with names. The memory module decides what the audience
// may hear; this only renders it, and says plainly that the private part never leaves a chat nobody else reads.
import test from "node:test";
import assert from "node:assert/strict";
import { createContextBuilder, joinedLine, profileSection } from "../context.ts";
import type { ProfileContext } from "../context.ts";
import type { TurnInput } from "../../../agent/src/turn-engine/types.ts";

const names: Record<string, string> = { usr_dana: "Dana Ruiz", usr_maya: "Maya Chen" };
const who = (id: string): string => names[id] ?? "a teammate";

test("a chat only Dana reads: both parts, with what each one is for", () => {
  const p: ProfileContext = { audience: "private", people: [{ personId: "usr_dana", self: true, basics: ["Time zone: America/Chicago"], public: ["[fct_pub] Short client emails, no exclamation marks."], private: ["[fct_priv] Leaves early on Thursdays."] }] };
  const text = profileSection(p, who);
  assert.match(text, /^About Dana Ruiz, the person you work for/);
  assert.match(text, /Public \(their teammates' chats may use this\):\n- Time zone: America\/Chicago\n- \[fct_pub\] Short client emails/);
  assert.match(text, /Private \(only their own chats; never repeat it, hint at it or act on it in a channel/);
  assert.match(text, /\[fct_priv\] Leaves early on Thursdays\./);
  assert.match(text, /memory_profile_suggest/);
});

test("a shared chat: the asker's public part and the others' public part; no private heading at all", () => {
  const p: ProfileContext = { audience: "shared", people: [
    { personId: "usr_dana", self: true, basics: [], public: ["[fct_pub] Short client emails."], private: [] },
    { personId: "usr_maya", self: false, basics: [], public: ["[fct_m] Maya runs the Harlow matter."], private: [] },
  ] };
  const text = profileSection(p, who);
  assert.match(text, /About Dana Ruiz, who asked \(public profile only: other people read this chat/);
  assert.match(text, /About Maya Chen, also here \(public profile\):\n- \[fct_m\] Maya runs the Harlow matter\./);
  assert.doesNotMatch(text, /Private/);
  assert.equal(profileSection({ audience: "shared", people: [{ personId: "usr_dana", self: true, basics: [], public: [], private: [] }] }, who), "");
  assert.equal(profileSection(undefined, who), "");
});

test("the builder asks memory for the profile as the asker, for this chat, and puts it after where", async () => {
  const log: Array<{ cap: string; input: unknown; as?: string | undefined }> = [];
  const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => {
    log.push({ cap, input, as });
    if (cap === "memory.profile.context") return { audience: "private", people: [{ personId: "usr_dana", self: true, basics: [], public: [], private: ["[fct_priv] Leaves early on Thursdays."] }] };
    if (cap === "access.principals.list") return { principals: [{ id: "usr_dana", kind: "person", name: "Dana Ruiz" }] };
    if (cap === "threads.get") return { thread: { kind: "chat", members: [{ kind: "person", id: "usr_dana" }], agents: [] } };
    throw new Error(`no such capability ${cap}`);
  };
  const input = { threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_intake", mode: "lead" }, trigger: null, history: [], listeners: [], asker: "usr_dana" } as unknown as TurnInput;
  const ctx = await createContextBuilder({ call, now: () => 0 }).build(input);
  const ids = ctx.sections.map((s) => s.id);
  assert.ok(ids.indexOf("person") === ids.indexOf("where") + 1, ids.join(","));
  const person = ctx.sections.find((s) => s.id === "person")!;
  assert.equal(person.stable, true);
  assert.match(person.text, /About Dana Ruiz.*\n[\s\S]*Leaves early on Thursdays/);
  const asked = log.find((l) => l.cap === "memory.profile.context")!;
  assert.deepEqual(asked.input, { threadId: "thr_1" });
  assert.equal(asked.as, "usr_dana");
});

test("memory that is off or slow leaves the section out and the turn goes on", async () => {
  const call = async (cap: string): Promise<unknown> => { if (cap === "threads.get") return { thread: { kind: "chat", members: [], agents: [] } }; throw new Error("off"); };
  const input = { threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_intake", mode: "lead" }, trigger: null, history: [], listeners: [], asker: "usr_dana" } as unknown as TurnInput;
  const ctx = await createContextBuilder({ call, now: () => 0 }).build(input);
  assert.equal(ctx.sections.some((s) => s.id === "person"), false);
});

const JOINED = Date.UTC(2026, 10, 4, 10, 40);
const buildFor = async (floor: unknown) => {
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "chat.read_floor") return floor;
    if (cap === "access.principals.list") return { principals: [{ id: "usr_maya", kind: "person", name: "Maya Chen" }] };
    if (cap === "threads.get") return { thread: { kind: "chat", members: [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_maya" }], agents: [] } };
    throw new Error(`no such capability ${cap}`);
  };
  const input = { threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_intake", mode: "lead" }, trigger: null, history: [], listeners: [], asker: "usr_maya" } as unknown as TurnInput;
  return createContextBuilder({ call, now: () => 0 }).build(input);
};

test("when a newcomer who joined without earlier messages asks, the agent's context says so and not to quote them", async () => {
  const ctx = await buildFor({ fromAt: JOINED });
  const where = ctx.sections.find((s) => s.id === "where")!;
  assert.ok(where.text.includes("Maya joined at 10:40 UTC and can't see earlier messages; don't quote them to Maya."), where.text);
  assert.equal(joinedLine("Maya Chen", JOINED), "Maya joined at 10:40 UTC and can't see earlier messages; don't quote them to Maya.");
});

test("a person who reads the whole chat gets no such line", async () => {
  const ctx = await buildFor({});
  assert.ok(!ctx.sections.find((s) => s.id === "where")!.text.includes("can't see earlier messages"));
});
