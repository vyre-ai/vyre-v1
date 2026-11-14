// Who may stop whose turn (lead ruling, 14 Nov 2026), on a booted Team Space with a member, a guest and the owner in one channel thread, three agents each working on a held turn:
// a member stops any agent's turn; a guest stops only a turn they asked for, and their Stop all stops only their own; an agent works for the person who asked it, so one acting for a guest
// reaches only that guest's turns and one acting for a member reaches any.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join, messages, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let m: Person;
let g: Person;
let spark = "";
let echo = "";
let nova = "";
let thread = "";
const agentOf = async (name: string): Promise<string> =>
  (await h.owner.call("agents.create", { name, role: `You are ${name}.` })).agent.agentId as string;
const working = async (): Promise<string[]> =>
  (((await h.owner.call("engine.now", {})).working ?? []) as Array<{ agentId: string; threadId?: string }>)
    .filter((w) => w.threadId === thread)
    .map((w) => w.agentId)
    .sort();
const ask = (p: Person, body: string, agentId: string): Promise<unknown> =>
  p.call("chat.post", { threadId: thread, body, mentions: [{ kind: "agent", id: agentId }] });

before(async () => {
  h = await bootHour("stopreach");
  m = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, m, await invite(h, m.email), { device: "web" });
  const roles = (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[];
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Guest")!.id,
    email: "gus@firm.test",
  });
  g = h.person("Gus", "gus", "gus@firm.test", "gus horse battery staple 9");
  await join(h, g, decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!), { device: "web" });
  [spark, echo, nova] = [h.agentId, await agentOf("Echo"), await agentOf("Nova")];
  // one group chat the owner starts with the three agents, and the member and the guest added to it: every ask lands in this one thread
  thread = (await h.owner.call("chat.start", { kind: "chat", agentIds: [spark, echo, nova] })).thread
    .threadId as string;
  await h.owner.call("threads.set_mode", { threadId: thread, mode: "auto" });
  await h.owner.call("threads.members.add", { threadId: thread, personId: m.personId });
  await h.owner.call("threads.members.add", { threadId: thread, personId: g.personId });
  // a guest has no role grant: the thread is shared with them to use and write in
  await h.owner.call("access.share", {
    resource: { type: "thread", id: thread },
    subject: { kind: "person", id: g.personId },
    level: "edit",
  });
  await ask(h.owner, "HOLD one", spark);
});
after(async () => {
  await h?.stop();
});

// A guest cannot keep an AI sign-in or use the Space key on this Space, so a turn a guest asks for does not run here (it ends as account_unavailable); what is proven live is the guest's reach into
// other people's turns. The guest's own turns (stop, Stop all) and an agent acting for a guest are proven in agent/tests/turn-engine.stop-reach.test.ts and modules/engine/tests/stop-reach.test.ts.
test("a guest cannot stop another person's agent, one at a time or with Stop all", async () => {
  await ask(m, "HOLD three", nova);
  await waitFor(async () => ((await working()).length === 2 ? true : null), 20_000, "Spark and Nova working");
  const one = await g.attempt("engine.stop", { threadId: thread, agentId: spark });
  assert.ok(
    !one.ok || one.data.stopped === 0,
    `a guest's Stop on the owner's agent reaches nothing: ${JSON.stringify(one)}`,
  );
  const all = await g.attempt("engine.stop_all", { threadId: thread });
  assert.ok(
    !all.ok || all.data.stopped === 0,
    `a guest's Stop all reaches nothing of other people's: ${JSON.stringify(all)}`,
  );
  assert.deepEqual(await working(), [nova, spark].sort(), "both still work");
});

test("a member stops any agent's turn in the chat; the owner's Stop all stops the rest", async () => {
  const one = await m.call("engine.stop", { threadId: thread, agentId: spark });
  assert.equal(one.stopped, 1, "a member stops the owner's agent");
  await waitFor(
    async () => (JSON.stringify(await working()) === JSON.stringify([nova]) ? true : null),
    10_000,
    "Spark stopped",
  );
  // the chat says who stopped it: the stopped line carries the stopper, and the turn's record serves it
  const line = await waitFor(
    async () =>
      (await messages(h, h.owner, thread))
        .filter((x) => x.author?.id === spark)
        .flatMap((x) => x.blocks ?? [])
        .find((b) => b.type === "turn_status" && b.data?.state === "cancelled" && b.data?.stoppedBy) ?? null,
    10_000,
    "Spark's stopped line",
  );
  assert.deepEqual(line.data.stoppedBy, { id: m.personId, kind: "person" });
  const turn = await h.owner.call("engine.turn.get", { turnId: line.data.turnId });
  assert.deepEqual(turn.what.turn.stoppedBy, { id: m.personId, kind: "person" });
  const all = await h.owner.call("engine.stop_all", { threadId: thread });
  assert.equal(all.stopped, 1);
  await waitFor(async () => ((await working()).length === 0 ? true : null), 10_000, "everything stopped");
});

test("an agent acting for a member stops another agent's turn; its own turn is always its to stop", async () => {
  await ask(h.owner, "HOLD four", spark);
  await waitFor(async () => ((await working()).length === 1 ? true : null), 20_000, "Spark working");
  await ask(m, `STOP ${spark}`, echo);
  const line = await waitFor(
    async () =>
      (await messages(h, h.owner, thread)).filter((x) => x.author?.id === echo && /RESULT/.test(x.body ?? "")).at(-1)
        ?.body ?? null,
    20_000,
    "Echo's line",
  );
  assert.match(line, /"stopped":1/, `an agent working for a member stops another agent's turn: ${line}`);
  await waitFor(async () => ((await working()).length === 0 ? true : null), 10_000, "Spark stopped");
});
