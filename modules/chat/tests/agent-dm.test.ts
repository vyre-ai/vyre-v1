// An agent reaches a teammate for its person (lane l-agentdm): the message lands in the person's own direct chat signed for them, the reply and a card's answer go back to the chat they asked in,
// and away, working hours, the hourly limit, a mute and the person's private facts all hold it. The handler is the chat module's own; the Gate's ask-first is tested in test/agent-dm.team.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { approveInChat, onCardAnswered, onDirectReply, sendDue, saysFact } from "../handlers/agent-dm.ts";
import { insertMessage } from "../projections.ts";
import { DANA, INTAKE, MAYA, NOW, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `adm-${++n}`;
const NAMES: Record<string, string> = { [DANA]: "Dana Reyes", [MAYA]: "Maya Chen" };

interface World { kind?: string; presence?: Record<string, unknown>; hours?: Record<string, unknown>; facts?: string[]; vault?: (text: string) => string[]; tasks?: Record<string, unknown>[] }
function world(w: World = {}) {
  const tasks = w.tasks ?? [];
  const hn = harness({
    calls: {
      "agents.get": () => ({ agent: { kind: w.kind ?? "assistant" } }),
      "access.principals.get": (i) => { const id = (i["principal"] as { id: string }).id; return NAMES[id] ? { principal: { id, kind: "person", name: NAMES[id], status: "active" } } : (() => { throw Object.assign(new Error("nope"), { code: "validation.not_found" }); })(); },
      "access.principals.list": () => ({ principals: Object.entries(NAMES).map(([id, name]) => ({ id, name })) }),
      "devices.presence": (i) => ({ people: (i["people"] as string[]).map((p) => ({ personId: p, state: "online", lastSeenAt: NOW - 60_000, ...(w.presence?.[p] as object ?? {}) })) }),
      "settings.public_of": (i) => (w.hours?.[i["personId"] as string] as object) ?? {},
      "memory.facts.list": () => ({ facts: (w.facts ?? []).map((text, k) => ({ id: `fct_${k}`, text })) }),
      "vault.text_check": (i) => ({ handles: w.vault ? w.vault(String(i["text"])) : [], checked: true }),
      "tasks.create": (i) => { tasks.push(i); return { task: { id: `tsk_card${tasks.length}` } }; },
    },
  });
  return { hn, tasks };
}

/** Dana's own chat with her agent, where she asks; the agent's calls run there, for her. */
async function asked(hn: ReturnType<typeof harness>, body = "tell Maya the Rivera draft is ready") {
  const origin = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: origin, body, idempotencyKey: key() });
  return { origin, agent: { ...hn.agent(INTAKE, DANA), thread: origin } };
}
const msgs = (hn: ReturnType<typeof harness>, thread: string) => hn.rows("SELECT id, author, kind, body, blocks FROM chat_message WHERE thread = ? ORDER BY threadSeq", thread).map((r) => ({ ...r, blocks: JSON.parse(String(r["blocks"])) as Array<{ type: string; data: Record<string, unknown> }> }));

test("asked this turn: the message goes now, in Dana's own direct chat with Maya, written by the agent and signed for Dana; Maya is told", async () => {
  const { hn } = world();
  const { origin, agent } = await asked(hn);
  hn.clear();
  const out = await h["chat.message_person"]!(agent, { to: MAYA, body: "The Rivera draft is ready for you.", idempotencyKey: key() });
  assert.deepEqual(contractErrors("chat.message_person", "out", out), []);
  assert.equal(out.state, "sent");
  const dm = msgs(hn, out.threadId);
  assert.equal(dm.length, 1);
  assert.equal(dm[0]!["author"], INTAKE);
  assert.deepEqual(dm[0]!.blocks.find((b) => b.type === "on_behalf")?.data, { person: DANA, agentId: INTAKE, teammate: MAYA }, "the block names who it speaks for");
  const members = hn.rows("SELECT principal FROM chat_thread_member WHERE thread = ?", out.threadId).map((r) => r["principal"]).sort();
  assert.deepEqual(members, [DANA, MAYA].sort(), "a direct chat of the two people, no agent added to it");
  assert.equal(hn.named("message.direct")[0]?.payload["personId"], MAYA);
  assert.deepEqual(assertEventsConform(hn), []);
  // the same direct chat the next time, and the same call again is the same message
  const again = await h["chat.message_person"]!(agent, { to: MAYA, body: "One more thing.", idempotencyKey: key() });
  assert.equal(again.threadId, out.threadId);
  const k = key();
  const a = await h["chat.message_person"]!(agent, { to: MAYA, body: "Once.", idempotencyKey: k });
  const b = await h["chat.message_person"]!(agent, { to: MAYA, body: "Once.", idempotencyKey: k });
  assert.equal(a.messageId, b.messageId);
  assert.equal(msgs(hn, origin).filter((m) => m["kind"] === "quiet").length, 0, "nothing scheduled, so no line in Dana's chat");
});

test("Maya's reply goes back to Dana's chat as one line that wakes the agent; once Dana answers Maya herself, it stops", async () => {
  const { hn } = world();
  const { origin, agent } = await asked(hn);
  const out = await h["chat.message_person"]!(agent, { to: MAYA, body: "Is Friday fine for the review?", idempotencyKey: key() });
  hn.clear();
  const reply = (await h["chat.post"]!(hn.person(MAYA), { threadId: out.threadId, body: "Friday works, after 2pm.", idempotencyKey: key() })).message;
  const event = hn.named("message.received").find((e) => e.payload["messageId"] === reply.messageId)!;
  assert.equal((await onDirectReply(hn.ctx, event as never)).length, 1);
  const line = msgs(hn, origin).at(-1)!;
  assert.equal(line["author"], DANA);
  assert.equal(line["kind"], "quiet");
  assert.equal(line["body"], "Maya replied: Friday works, after 2pm.");
  const wake = hn.named("message.received").find((e) => e.payload["threadId"] === origin && e.payload["messageId"] === line["id"])!;
  assert.deepEqual(wake.payload["mentions"], [{ kind: "agent", id: INTAKE }], "the agent is mentioned, so it carries on there");
  assert.equal(wake.payload["typed"], undefined, "Maya's words never count as Dana asking for anything");
  // Dana writes to Maya herself: the conversation is hers now
  await h["chat.post"]!(hn.ctx, { threadId: out.threadId, body: "Thanks Maya, I will take it from here.", idempotencyKey: key() });
  const later = (await h["chat.post"]!(hn.person(MAYA), { threadId: out.threadId, body: "Sure.", idempotencyKey: key() })).message;
  assert.deepEqual(await onDirectReply(hn.ctx, { payload: { messageId: later.messageId, threadId: out.threadId, author: { kind: "person", id: MAYA } } }), []);
});

test("outside Maya's working hours it waits: Dana sees Scheduled for Maya, and it goes when her day starts", async () => {
  const { hn } = world({ hours: { [MAYA]: { timezone: "UTC", hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" } } } });
  const { origin, agent } = await asked(hn);
  const out = await h["chat.message_person"]!(agent, { to: MAYA, body: "Morning: the draft is ready.", idempotencyKey: key() });
  assert.equal(out.state, "scheduled");
  assert.equal(out.dueAt, Date.UTC(2025, 9, 9, 9, 0));
  assert.match(out.when, /^Scheduled for Maya Chen: 9:00 AM their time \(it is outside Maya's working hours\)/);
  assert.equal(msgs(hn, out.threadId).length, 0, "nothing in the direct chat yet");
  const line = msgs(hn, origin).at(-1)!;
  assert.equal(line["kind"], "quiet");
  assert.match(String(line["body"]), /^Scheduled for Maya Chen: 9:00 AM/);
  assert.deepEqual(await sendDue(hn.ctx), [], "not yet");
  hn.advance(7 * 60_000);
  assert.equal((await sendDue(hn.ctx)).length, 1);
  assert.equal(msgs(hn, out.threadId).length, 1);
  assert.match(String(msgs(hn, origin).at(-1)!["body"]), /^Sent to Maya Chen: Morning/);
});

test("away holds it until she is back; urgent goes at once; next online waits for her", async () => {
  const { hn } = world({ presence: { [MAYA]: { state: "away", awayUntil: NOW + 3_600_000 } } });
  const { agent } = await asked(hn);
  const held = await h["chat.message_person"]!(agent, { to: MAYA, body: "When you are back.", idempotencyKey: key() });
  assert.equal(held.state, "scheduled");
  assert.equal(held.dueAt, NOW + 3_600_000);
  const urgent = await h["chat.message_person"]!(agent, { to: MAYA, body: "The court moved the hearing to today.", urgent: true, idempotencyKey: key() });
  assert.equal(urgent.state, "sent");
  const { hn: hn2 } = world({ presence: { [MAYA]: { state: "offline" } } });
  const { agent: agent2 } = await asked(hn2);
  const later = await h["chat.message_person"]!(agent2, { to: MAYA, body: "No rush.", timing: "online", idempotencyKey: key() });
  assert.equal(later.state, "scheduled");
  assert.equal(later.dueAt, undefined, "no time: when she is next online");
  assert.match(later.when, /when Maya is next online/);
});

test("3 an hour from Dana's agents to Maya; the fourth waits for the hour", async () => {
  const { hn } = world();
  const { origin, agent } = await asked(hn);
  for (let i = 0; i < 3; i++) { assert.equal((await h["chat.message_person"]!(agent, { to: MAYA, body: `Note ${i}`, idempotencyKey: key() })).state, "sent"); hn.advance(60_000); }
  const fourth = await h["chat.message_person"]!(agent, { to: MAYA, body: "Note 3", idempotencyKey: key() });
  assert.equal(fourth.state, "scheduled");
  assert.equal(fourth.dueAt, NOW + 3_600_000);
  assert.match(String(msgs(hn, origin).at(-1)!["body"]), /3 agent messages went to Maya this hour/);
  hn.advance(3_600_000);
  assert.equal((await sendDue(hn.ctx)).length, 1);
});

test("Maya mutes Dana's agents for today: what they send waits until tomorrow and Dana is told; undo lifts it", async () => {
  const { hn } = world({ hours: { [MAYA]: { timezone: "UTC" } } });
  const { origin, agent } = await asked(hn);
  await h["chat.message_person"]!(agent, { to: MAYA, body: "First.", idempotencyKey: key() });
  const muted = await h["chat.agent_dm.mute"]!(hn.person(MAYA), { personId: DANA });
  assert.equal(muted.until, Date.UTC(2025, 9, 10, 0, 0), "the end of Maya's day");
  assert.match(String(msgs(hn, origin).at(-1)!["body"]), /^Maya Chen muted agent messages from you for today/);
  const next = await h["chat.message_person"]!(agent, { to: MAYA, body: "Second.", urgent: true, idempotencyKey: key() });
  assert.equal(next.state, "scheduled", "urgent does not pass a mute");
  assert.equal(next.dueAt, muted.until);
  await h["chat.agent_dm.mute"]!(hn.person(MAYA), { personId: DANA, undo: true });
  assert.equal((await h["chat.message_person"]!(agent, { to: MAYA, body: "Third.", idempotencyKey: key() })).state, "sent");
  await assert.rejects(h["chat.agent_dm.mute"]!(hn.agent(INTAKE, MAYA), { personId: DANA }), (e) => codeOf(e) === "validation.precondition_failed", "only a person mutes");
});

test("an approval card: an Approve task for Maya, shown in the message; her answer goes back to the agent once", async () => {
  const { hn, tasks } = world();
  const { origin, agent } = await asked(hn, "ask Maya to approve the Rivera discount");
  const out = await h["chat.message_person"]!(agent, { to: MAYA, body: "Can you approve the 10% discount for Rivera?", card: { kind: "approval", title: "the 10% Rivera discount", detail: "Their retainer renews Monday." }, idempotencyKey: key() });
  assert.equal(out.taskId, "tsk_card1");
  const t = tasks[0] as { kind: string; approver: unknown; source: unknown; blocks: Array<{ data: Record<string, unknown> }> };
  assert.equal(t.kind, "approve");
  assert.deepEqual(t.approver, { kind: "person", id: MAYA });
  assert.deepEqual(t.source, { kind: "chat", id: origin });
  assert.equal(t.blocks[0]!.data["plain"], true, "a plain yes or no: nothing runs as Maya");
  assert.equal(msgs(hn, out.threadId)[0]!["body"], "", "the card alone: its title is the ask, its detail the reason, nothing said twice");
  assert.equal((tasks[0] as { summary?: string }).summary, "Their retainer renews Monday.");
  const card = msgs(hn, out.threadId)[0]!.blocks.find((b) => b.type === "link_card")!;
  assert.deepEqual(card.data, { icon: "approval", lead: "Approve", title: "the 10% Rivera discount", target: { type: "task", id: "tsk_card1" } });
  assert.equal((await onCardAnswered(hn.ctx, { name: "task.approved", payload: { taskId: "tsk_card1", by: MAYA } })).length, 1);
  assert.equal(msgs(hn, origin).at(-1)!["body"], "Maya approved: the 10% Rivera discount.");
  assert.deepEqual(await onCardAnswered(hn.ctx, { name: "task.sent_back", payload: { taskId: "tsk_card1", by: MAYA, note: "x" } }), [], "once");
  // a review card goes to Maya as reviewer
  await h["chat.message_person"]!(agent, { to: MAYA, body: "Could you look over the letter?", card: { kind: "review", title: "the Rivera letter" }, idempotencyKey: key() });
  assert.deepEqual((tasks[1] as { reviewer: unknown }).reviewer, { kind: "person", id: MAYA });
});

test("nothing private leaves: a private profile fact or a Mine Vault value is refused, unless Dana said it herself", async () => {
  const { hn } = world({ facts: ["Dana is seeing a cardiologist on Thursdays"], vault: (t) => (t.includes("sk_live_FAKE123") ? ["#Dana_Stripe"] : []) });
  const { agent } = await asked(hn);
  await assert.rejects(h["chat.message_person"]!(agent, { to: MAYA, body: "Dana cannot meet Thursday, she is seeing a cardiologist on Thursdays.", idempotencyKey: key() }),
    (e) => codeOf(e) === "validation.precondition_failed" && /private profile/.test(String((e as { error?: { message?: string } }).error?.message ?? (e as Error).message)));
  await assert.rejects(h["chat.message_person"]!(agent, { to: MAYA, body: "The key is sk_live_FAKE123", idempotencyKey: key() }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal(hn.rows("SELECT COUNT(*) AS c FROM chat_message WHERE author = ? AND kind = 'agent'", INTAKE)[0]!["c"], 0, "nothing went");
  // Dana put it in herself
  const { agent: told } = await asked(hn, "tell Maya I am seeing a cardiologist on Thursdays so I cannot meet then");
  assert.equal((await h["chat.message_person"]!(told, { to: MAYA, body: "Dana is seeing a cardiologist on Thursdays, so Thursday does not work.", idempotencyKey: key() })).state, "sent");
  assert.equal(saysFact("Prefers tea over coffee", "Let's get coffee"), false);
  assert.equal(saysFact("Prefers tea over coffee", "she prefers tea over coffee"), true);
});

test("who is in: presence, local time, hours, a mute and when a message would go; never the asker", async () => {
  const { hn } = world({ presence: { [MAYA]: { state: "away", awayUntil: NOW + 7_200_000 } }, hours: { [MAYA]: { timezone: "Asia/Karachi", hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" } } } });
  const { agent } = await asked(hn);
  const out = await h["chat.people_status"]!(agent, {});
  assert.deepEqual(contractErrors("chat.people_status", "out", out), []);
  assert.equal(out.people.length, 1);
  const maya = out.people[0];
  assert.match(maya.handle, /^maya-/);
  assert.doesNotMatch(JSON.stringify(out), /usr_/, "no id in what the model reads");
  assert.match(out.how, /signed as Dana Reyes \(Agent\)/);
  assert.equal(maya.state, "away");
  assert.equal(maya.localTime, "1:53 PM");
  assert.equal(maya.hours, "Mon to Fri, 09:00 to 18:00");
  assert.equal(maya.inHours, true);
  assert.match(maya.wouldGo, /Maya is away/);
});

test("refusals: a person calls it, a stranger, yourself, and a block only the server writes", async () => {
  const { hn } = world();
  const { origin, agent } = await asked(hn);
  await assert.rejects(h["chat.message_person"]!(hn.ctx, { to: MAYA, body: "Hi", idempotencyKey: key() }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(h["chat.message_person"]!(agent, { to: "usr_stranger", body: "Hi", idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(h["chat.message_person"]!(agent, { to: DANA, body: "Hi", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(h["chat.post"]!(agent, { threadId: origin, body: "x", blocks: [{ type: "on_behalf", v: 1, data: { person: MAYA, teammate: DANA } }], idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
});

test("a plain yes in Dana's own words presses the Send this to Maya card: noted as approved in chat, acted as Dana; anything else leaves it", async () => {
  const { hn } = world();
  const { origin } = await asked(hn);
  const held = { task: { id: "tsk_held", state: "awaiting_approval", approver: { kind: "person", id: DANA }, blocks: [{ type: "doc_excerpt", data: { cap: "chat.message_person", input: { to: MAYA, body: "Free Friday?" } } }] } };
  const acted: unknown[] = [];
  const h2 = harness({ raw: hn.raw, calls: {
    "tasks.get": () => held, "access.principals.get": () => ({ principal: { kind: "person", name: "Maya Chen", status: "active" } }),
    "tasks.working_notes.set": (i) => { acted.push(["note", i]); return {}; }, "tasks.act": (i) => { acted.push(["act", i]); return {}; },
  } });
  insertMessage(h2.ctx, origin, { author: INTAKE, kind: "agent", body: "", blocks: [{ type: "link_card", v: 1, id: "blk_h", state: "done", data: { icon: "approval", lead: "Message", title: "Free Friday?", target: { type: "task", id: "tsk_held" } } }] });
  assert.deepEqual(await approveInChat(h2.ctx, origin, "what time is it?"), [], "not a yes");
  assert.deepEqual(await approveInChat(h2.ctx, origin, "send it to Omar"), [], "names someone else");
  assert.deepEqual(await approveInChat(h2.person(MAYA), origin, "yes send it"), [], "only the person the card asks");
  assert.deepEqual(await approveInChat(h2.ctx, origin, "yes, send it"), ["tsk_held"]);
  assert.deepEqual(acted, [["note", { taskId: "tsk_held", key: "approved_in", value: "chat" }], ["act", { taskId: "tsk_held", action: "approve", note: "Approved in chat" }]]);
  assert.deepEqual(await approveInChat(h2.ctx, origin, "tell Maya yes"), ["tsk_held"], "a send that names her covers it too");
});

// ---- a Space agent writes as itself (owner ruling 4 Nov 2026) ----

test("a Space agent messages a teammate as itself in its own chat with them; the asker's chat gets one short line; the reply goes to the agent; the asker cannot read it", async () => {
  const { hn } = world({ kind: "agent" });
  const { origin, agent } = await asked(hn);
  hn.clear();
  const status = await h["chat.people_status"]!(agent, {});
  assert.match(status.how, /as yourself/);
  assert.doesNotMatch(JSON.stringify(status), /usr_/, "no id in what the model reads");
  const out = await h["chat.message_person"]!(agent, { to: status.people[0].handle, body: "Dana asked me to let you know the Rivera draft is ready.", idempotencyKey: key() });
  assert.equal(out.state, "sent");
  assert.equal(out.as, "self");
  assert.match(out.when, /as yourself, in your own chat with them/);
  const dm = msgs(hn, out.threadId);
  assert.equal(dm.length, 1);
  assert.equal(dm[0]!["author"], INTAKE, "written by the agent");
  assert.equal(dm[0]!.blocks.some((b) => b.type === "on_behalf"), false, "signed by nobody else");
  const members = hn.rows("SELECT principal FROM chat_thread_member WHERE thread = ?", out.threadId).map((r) => r["principal"]);
  assert.deepEqual(members, [MAYA], "the teammate is in it, the person who asked is not");
  assert.deepEqual(hn.rows("SELECT agentId FROM chat_thread_agent WHERE thread = ?", out.threadId).map((r) => r["agentId"]), [INTAKE], "the agent leads its own chat");
  assert.equal((await h["chat.message_person"]!(agent, { to: MAYA, body: "A second note.", idempotencyKey: key() })).threadId, out.threadId, "the same chat the next time");

  // Maya replies there: one short line goes to the chat the agent was asked in, with the words clipped and no turn started by it
  const long = "Friday works. ".repeat(40);
  const reply = (await h["chat.post"]!(hn.person(MAYA), { threadId: out.threadId, body: long, idempotencyKey: key() })).message;
  const event = hn.named("message.received").find((e) => e.payload["messageId"] === reply.messageId)!;
  assert.equal((await onDirectReply(hn.ctx, event as never)).length, 1);
  const line = msgs(hn, origin).at(-1)!;
  assert.equal(line["author"], INTAKE, "the agent's own line, not Dana's");
  assert.equal(line["kind"], "quiet");
  assert.match(String(line["body"]), /^Maya replied: Friday works\./);
  assert.ok(String(line["body"]).length < 200, "never her words whole");
});

test("a Space agent's hourly limit is its own, per teammate; an Assistant's stays per person", async () => {
  const { hn } = world({ kind: "agent" });
  const { agent } = await asked(hn);
  for (let i = 0; i < 3; i++) assert.equal((await h["chat.message_person"]!(agent, { to: MAYA, body: `Note ${i}`, idempotencyKey: key() })).state, "sent");
  assert.equal((await h["chat.message_person"]!(agent, { to: MAYA, body: "Note 4", idempotencyKey: key() })).state, "scheduled", "the fourth in an hour waits");
});
