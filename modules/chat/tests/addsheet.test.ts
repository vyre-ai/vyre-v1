// The Add people and agents sheet, server side (lane l-addsheet): per-chat response settings, an agent a chat makes for itself, poke, reading further back, an outside agent scoped to one chat, and a guest of one chat.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, DRAFTER, INTAKE, MAYA, LEO, assertEventsConform, contractErrors, harness as baseHarness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { addAgent, agentsOf, ensure, insertMessage, insertThread, addMember, mintId } from "../projections.ts";
import { mayAnswerUntagged } from "../../../lib/route.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = () => `as${++n}`;
const notFound = () => Object.assign(new Error("gone"), { error: { code: "validation.not_found" } });
const coded = (code: string) => Object.assign(new Error(code), { error: { code } });
const failure = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { error?: { code?: string } }).error?.code ?? "unknown"; } return "none"; };

const OUTSIDE = "agt_cc";
const made: string[] = [];
interface World { shared: Array<Record<string, any>>; unshared: Array<Record<string, any>>; queued: Array<Record<string, any>>; trashed: string[]; restored: string[]; modes: Array<Record<string, any>>; invites: Array<Record<string, any>>; refuse: Set<string> }
function world(): { w: World; hn: Harness } {
  const w: World = { shared: [], unshared: [], queued: [], trashed: [], restored: [], modes: [], invites: [], refuse: new Set() };
  const hn = baseHarness({
    calls: {
      "agents.get": (i) => {
        if (i["agentId"] === "agt_secret") throw notFound();
        return { agent: { agentId: i["agentId"], name: i["agentId"] === OUTSIDE ? "Claude Code" : i["agentId"] === DRAFTER ? "Drafter" : "Ember", runtime: i["agentId"] === OUTSIDE ? "outside" : "vyre" } };
      },
      "access.principals.get": (i) => ({ principal: { name: (i["principal"] as { id: string }).id === DANA ? "Dana Reyes" : "Maya" } }),
      "agents.outside.usable": (i) => ({ usable: !w.refuse.has(`usable:${String(i["agentId"])}`) }),
      "agents.outside.enqueue": (i) => { w.queued.push(i); return { queued: true }; },
      "agents.create": (i) => { const id = `agt_made${made.length + 1}`; made.push(id); return { agent: { agentId: id, name: i["name"], kind: "teammate", chatOf: i["threadId"] } }; },
      "agents.delete": (i) => { w.trashed.push(String(i["agentId"])); return { deleted: true }; },
      "agents.restore": (i) => { w.restored.push(String(i["agentId"])); return { agent: {} }; },
      "engine.set_mode": (i) => { w.modes.push(i); return { mode: i["mode"], leadAgentId: null }; },
      "engine.stop_all": () => ({ stopped: 0 }),
      "files.resolve": () => { throw notFound(); },
      "access.share": (i) => {
        const r = i["resource"] as { type: string; id: string };
        if (w.refuse.has(`share:${r.type}`)) throw coded("permission.not_contained");
        w.shared.push(i);
        return { grant: { id: `gnt_${w.shared.length}` } };
      },
      "access.unshare": (i) => {
        if (w.refuse.has("unshare")) throw coded("permission.no_grant");
        w.unshared.push(i);
        return { revoked: 1 };
      },
      "members.invites.guest": (i) => { w.invites.push(i); return { invite: { id: "inv_guest1" }, link: "https://maya.vyre.run/join/AAAA-BBBB#fp=ab" }; },
    },
  });
  return { w, hn };
}
const chatOf = async (hn: Harness, agentIds: string[] = [INTAKE]) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds, idempotencyKey: key() })).thread.threadId as string;
const agentRow = async (hn: Harness, id: string, agentId: string) => ((await h["threads.get"]!(hn.ctx, { threadId: id })).thread.agents as any[]).find((a) => a.agentId === agentId);

// ---- 1 settings

test("threads.agent_settings.set: When, topics, hours and style are kept with the agent in this chat and the thread says so", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  await h["threads.add_agent"]!(hn.ctx, { threadId: id, agentId: DRAFTER });
  hn.clear();
  const topics = await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, when: "topics", topics: "  invoices,   billing ", style: "short" });
  const row = topics.thread.agents.find((a: any) => a.agentId === DRAFTER);
  assert.deepEqual([row.when, row.topics, row.style, row.mode], ["topics", "invoices, billing", "short", "listen"]);
  assert.deepEqual(hn.named("thread.updated").map((e) => e.payload), [{ threadId: id, fields: ["agents"] }]);
  const hours = await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, when: "hours", hoursFrom: "08:30", hoursTo: "18:00" });
  const r2 = hours.thread.agents.find((a: any) => a.agentId === DRAFTER);
  assert.deepEqual([r2.when, r2.hoursFrom, r2.hoursTo, r2.topics], ["hours", "08:30", "18:00", "invoices, billing"], "the topics are remembered while hours are on");
  const back = await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, when: "always" });
  assert.equal(back.thread.agents.find((a: any) => a.agentId === DRAFTER).when, undefined, "Always is how a row starts, so it reads as nothing set");
  assert.deepEqual(contractErrors("threads.get", "out", await h["threads.get"]!(hn.ctx, { threadId: id })), []);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.agent_settings.set: bad input is refused in words, a stranger finds no chat, and an agent cannot reshuffle the others unless it leads", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  await h["threads.add_agent"]!(hn.ctx, { threadId: id, agentId: DRAFTER });
  const set = (input: Record<string, unknown>, ctx = hn.ctx) => h["threads.agent_settings.set"]!(ctx, { threadId: id, agentId: DRAFTER, ...input });
  assert.equal(await failure(set({ when: "hours", hoursFrom: "9am" })), "validation.bad_input");
  assert.equal(await failure(set({ topics: "x".repeat(201) })), "validation.bad_input");
  assert.equal(await failure(set({ style: "long" })), "validation.bad_input");
  assert.equal(await failure(set({ mode: "loud" })), "validation.bad_input");
  assert.equal(await failure(h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: "agt_nobody", style: "full" })), "validation.not_found");
  assert.equal(await failure(set({ style: "full" }, hn.person(MAYA))), "validation.not_found");
  assert.equal(await failure(set({ style: "full" }, hn.agent(DRAFTER))), "permission.role_lacks_permission", "a listener does not reshuffle the chat");
});

test("threads.agent_settings.set mode: Answers everything leads (one lead, the engine is told), Answers when tagged listens, Listening is listen with quiet", async () => {
  const { w, hn } = world();
  const id = await chatOf(hn);
  await h["threads.add_agent"]!(hn.ctx, { threadId: id, agentId: DRAFTER });
  const lead = await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, mode: "lead" });
  assert.deepEqual(lead.thread.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "listen"], [DRAFTER, "lead"]], "the lead before steps back");
  assert.deepEqual(w.modes, [{ threadId: id, agentId: DRAFTER, mode: "lead" }]);
  const quiet = await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, mode: "quiet" });
  const q = quiet.thread.agents.find((a: any) => a.agentId === DRAFTER);
  assert.deepEqual([q.mode, q.quiet], ["listen", true], "older clients read a listener");
  assert.equal(quiet.thread.agents.filter((a: any) => a.mode === "lead").length, 0);
  const tag = await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, mode: "listen" });
  assert.equal(tag.thread.agents.find((a: any) => a.agentId === DRAFTER).quiet, undefined, "tagged-only is not quiet");
  assert.equal(agentsOf(hn.db, id).length, 2);
  assert.deepEqual(contractErrors("threads.agent_settings.set", "out", tag), []);
});

// ---- 3 poke

test("threads.poke: a Listening agent is poked; the line is quiet, names the poker, carries the poke on message.received and is never the person's typed request", async () => {
  const { hn } = world();
  const id = await chatOf(hn, [INTAKE, DRAFTER]);
  await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, mode: "quiet" });
  hn.clear();
  const out = await h["threads.poke"]!(hn.ctx, { threadId: id, agentId: DRAFTER, note: "  where are we on the deed? " });
  assert.equal(out.delivered, "engine");
  const m = hn.rows("SELECT * FROM chat_message WHERE id = ?", out.messageId)[0]!;
  assert.deepEqual([m["kind"], m["author"], m["body"]], ["quiet", DANA, "Dana Reyes poked Drafter: where are we on the deed?"]);
  const ev = hn.named("message.received")[0]!.payload;
  assert.deepEqual(ev["poke"], { agentId: DRAFTER, by: DANA });
  assert.deepEqual(ev["mentions"], [{ kind: "agent", id: DRAFTER }]);
  assert.equal(ev["typed"], undefined, "a poke is not words the person typed, so it cannot ask for an outward act");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.poke respects the poker: no chat, no poke; an agent the poker cannot use is refused; a note is short; a closed chat is shut", async () => {
  const { w, hn } = world();
  const id = await chatOf(hn, [INTAKE, DRAFTER]);
  assert.equal(await failure(h["threads.poke"]!(hn.person(MAYA), { threadId: id, agentId: DRAFTER })), "validation.not_found", "a private chat is not Maya's to poke in");
  assert.equal(await failure(h["threads.poke"]!(hn.ctx, { threadId: id, agentId: "agt_secret" })), "validation.not_found", "someone else's private agent");
  assert.equal(await failure(h["threads.poke"]!(hn.ctx, { threadId: id, agentId: DRAFTER, note: "x".repeat(501) })), "validation.bad_input");
  assert.equal(await failure(h["threads.poke"]!(hn.ctx, { threadId: id, agentId: "usr_dana" })), "validation.bad_input");
  w.refuse.add(`usable:${OUTSIDE}`);
  assert.equal(await failure(h["threads.poke"]!(hn.ctx, { threadId: id, agentId: OUTSIDE })), "permission.no_grant", "an outside agent takes work from its owner only");
  assert.equal(hn.rows("SELECT * FROM chat_message WHERE kind = 'quiet'").length, 0, "nothing was written for any refused poke");
  // an agent acting for a person pokes as that person and under their rights
  const viaAgent = await h["threads.poke"]!(hn.agent(INTAKE, DANA), { threadId: id, agentId: DRAFTER });
  assert.equal(hn.rows("SELECT author FROM chat_message WHERE id = ?", viaAgent.messageId)[0]!["author"], DANA);
  assert.equal(await failure(h["threads.poke"]!(hn.agent(INTAKE, "agt_x"), { threadId: id, agentId: DRAFTER })), "permission.no_grant", "an agent with no person behind it does not poke");
});

test("threads.poke brings an agent that is not in a person's own chat in as a listener; in a channel it has to be added first", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  await h["threads.poke"]!(hn.ctx, { threadId: id, agentId: DRAFTER });
  assert.deepEqual(agentsOf(hn.db, id).map((a) => [a.agentId, a.mode]), [[INTAKE, "lead"], [DRAFTER, "listen"]]);
  const ch = (await h["channels.create"]!(hn.ctx, { name: "ops", visibility: "invite", idempotencyKey: key() })).channel;
  assert.equal(await failure(h["threads.poke"]!(hn.ctx, { threadId: ch.mainThreadId, agentId: DRAFTER })), "validation.precondition_failed");
});

test("threads.poke for an outside agent goes to its queue with the last 12 messages and no turn runs here", async () => {
  const { w, hn } = world();
  const id = await chatOf(hn);
  for (let i = 1; i <= 15; i++) insertMessage(hn.ctx, id, { author: DANA, kind: "text", body: `line ${i}` });
  hn.clear();
  const out = await h["threads.poke"]!(hn.ctx, { threadId: id, agentId: OUTSIDE, note: "status?" });
  assert.equal(out.delivered, "outside_queue");
  assert.equal(w.queued.length, 1);
  const job = w.queued[0]!;
  assert.deepEqual([job["agentId"], job["kind"], job["asker"], job["messageId"], job["title"]], [OUTSIDE, "mention", DANA, out.messageId, "Poked by Dana Reyes"]);
  const lines = String(job["text"]).split("\n").filter((l) => /^#\d+ /.test(l));
  assert.equal(lines.length, 12, "the last 12, a short window");
  assert.match(lines.at(-2)!, /Dana Reyes: line 15/);
  assert.match(lines.at(-1)!, /poked Claude Code: status\?/, "the poke itself is the newest line");
  assert.match(String(job["text"]), /chat_history_page/, "it is told how to read further back");
  const ev = hn.named("message.received")[0]!.payload;
  assert.deepEqual(ev["poke"], { agentId: OUTSIDE, by: DANA, outside: true });
  assert.deepEqual(ev["mentions"], [], "the engine has nothing to run for it");
});

// ---- 4 reading further back

test("chat.history.page returns older messages 100 at a time and tells when there is more; an agent reads only the chat it works in", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  const other = await chatOf(hn);
  for (let i = 1; i <= 130; i++) insertMessage(hn.ctx, id, { author: DANA, kind: "text", body: `m${i}` });
  const last = (hn.rows("SELECT MAX(threadSeq) AS s FROM chat_message WHERE thread = ?", id)[0]!["s"]) as number;
  const first = await h["chat.history.page"]!(hn.ctx, { threadId: id, before: last, limit: 100 });
  assert.equal(first.messages.length, 100);
  assert.equal(first.messages[0].threadSeq, last - 100, "oldest first inside the page");
  assert.equal(first.messages[99].threadSeq, last - 1, "strictly before the number given");
  assert.equal(first.hasMore, true);
  assert.equal(first.next, first.messages[0].threadSeq);
  const rest = await h["chat.history.page"]!(hn.ctx, { threadId: id, before: first.next, limit: 100 });
  assert.equal(rest.hasMore, false);
  assert.deepEqual(contractErrors("chat.history.page", "out", first), []);
  assert.equal(await failure(h["chat.history.page"]!(hn.ctx, { threadId: id, before: last, limit: 101 })), "validation.bad_input");
  assert.equal(await failure(h["chat.history.page"]!(hn.ctx, { threadId: id, before: 0 })), "validation.bad_input");
  assert.equal(await failure(h["chat.history.page"]!(hn.person(MAYA), { threadId: id, before: last })), "validation.not_found");
  // the agent working in this chat reads back here and nowhere else
  const working = { ...hn.agent(INTAKE, DANA), thread: id };
  assert.equal((await h["chat.history.page"]!(working, { threadId: id, before: last, limit: 5 })).messages.length, 5);
  assert.equal(await failure(h["chat.history.page"]!(working, { threadId: other, before: 5 })), "permission.no_grant", "another chat of the same person is refused");
  await h["threads.add_agent"]!(hn.ctx, { threadId: other, agentId: DRAFTER });
  const outsideCall = hn.agent(DRAFTER, DANA);
  assert.equal((await h["chat.history.page"]!(outsideCall, { threadId: other, before: 5 })).messages.length, 0, "an agent with no working chat in its call reads the chats it is in");
  assert.equal(await failure(h["chat.history.page"]!(hn.agent("agt_stranger", DANA), { threadId: id, before: last })), "permission.no_grant");
});

// ---- 2 an agent the chat makes for itself

test("threads.agent.create makes an agent owned by the chat, added as listening in one step", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  hn.clear();
  const out = await h["threads.agent.create"]!(hn.ctx, { threadId: id, name: "Checker", brief: "Checks every upload against the spec", model: "claude-sonnet-5-5", idempotencyKey: key() });
  assert.match(out.agentId, /^agt_made/);
  const row = out.thread.agents.find((a: any) => a.agentId === out.agentId);
  assert.deepEqual([row.mode, row.owned], ["listen", true]);
  const call = hn.callLog.find((c) => c.cap === "agents.create")!.input;
  assert.deepEqual([call["name"], call["role"], call["model"], call["threadId"], call["computer"]], ["Checker", "Checks every upload against the spec", "claude-sonnet-5-5", id, false]);
  assert.deepEqual(hn.named("agent.engaged").map((e) => e.payload["agentId"]), [out.agentId]);
  assert.deepEqual(contractErrors("threads.agent.create", "out", out), []);
  assert.deepEqual(assertEventsConform(hn), []);
  // Listening is a choice at creation too
  const quiet = await h["threads.agent.create"]!(hn.ctx, { threadId: id, name: "Watcher", mode: "quiet", idempotencyKey: key() });
  assert.equal(quiet.thread.agents.find((a: any) => a.agentId === quiet.agentId).quiet, true);
});

test("a chat's own agent goes to Trash when the chat is deleted, comes back with the chat, and goes for good when it is erased; an agent added the usual way is left alone", async () => {
  const { w, hn } = world();
  const id = await chatOf(hn, [INTAKE, DRAFTER]);
  const mine = (await h["threads.agent.create"]!(hn.ctx, { threadId: id, name: "Checker", idempotencyKey: key() })).agentId as string;
  await h["threads.delete"]!(hn.ctx, { threadId: id });
  assert.deepEqual(w.trashed, [mine], "only the one the chat made");
  await h["threads.restore"]!(hn.ctx, { threadId: id });
  assert.deepEqual(w.restored, [mine]);
  w.trashed.length = 0;
  await h["threads.erase"]!(hn.ctx, { threadId: id, idempotencyKey: key() });
  assert.deepEqual(w.trashed, [mine]);
  assert.equal(hn.rows("SELECT * FROM chat_thread_agent WHERE thread = ?", id).length, 0);
});

test("a chat's own agent is removed with a channel that is erased, and when it is taken out of the chat", async () => {
  const { w, hn } = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "build", visibility: "invite", idempotencyKey: key() })).channel;
  const a = (await h["threads.agent.create"]!(hn.ctx, { threadId: ch.mainThreadId, name: "Builder", idempotencyKey: key() })).agentId as string;
  const b = (await h["threads.agent.create"]!(hn.ctx, { threadId: ch.mainThreadId, name: "Reviewer", idempotencyKey: key() })).agentId as string;
  await h["threads.remove_agent"]!(hn.ctx, { threadId: ch.mainThreadId, agentId: b });
  assert.deepEqual(w.trashed, [b], "taken out of the chat, it goes");
  assert.deepEqual(agentsOf(hn.db, ch.mainThreadId).map((x) => x.agentId), [a]);
  await h["channels.erase"]!(hn.ctx, { channelId: ch.channelId, idempotencyKey: key() });
  assert.deepEqual(w.trashed, [b, a]);
});

// ---- 5 an outside agent scoped to this chat

function scopedChat(hn: Harness): string {
  ensure(hn.db);
  const t = insertThread(hn.ctx, { kind: "chat", title: "Deed", starter: DANA, listed: true, folderId: "fld_deed", recordId: "rec_deed", scopeType: "project", scopeId: "prj_deed", mode: "auto" });
  addMember(hn.ctx, t.id, DANA, "owner");
  return t.id;
}

test("threads.outside_agent.add gives exactly this chat, its project, its files folder and its record, each tagged with the chat, and nothing wider", async () => {
  const { w, hn } = world();
  const id = scopedChat(hn);
  hn.clear();
  const out = await h["threads.outside_agent.add"]!(hn.ctx, { threadId: id, agentId: OUTSIDE });
  assert.deepEqual(w.shared.map((s) => [s["resource"], s["subject"], s["level"], s["source"]]), [
    [{ type: "thread", id }, { kind: "agent", id: OUTSIDE }, "use", `chat:${id}`],
    [{ type: "project", id: "prj_deed" }, { kind: "agent", id: OUTSIDE }, "view", `chat:${id}`],
    [{ type: "folder", id: "fld_deed" }, { kind: "agent", id: OUTSIDE }, "edit", `chat:${id}`],
    [{ type: "record", id: "rec_deed" }, { kind: "agent", id: OUTSIDE }, "view", `chat:${id}`],
  ]);
  assert.equal(out.granted.length, 4);
  assert.ok(w.shared.every((s) => !["space", "channel", "record_type", "file"].includes(s["resource"].type)), "no space, no other chat, no record type");
  assert.equal(out.thread.agents.find((a: any) => a.agentId === OUTSIDE).mode, "listen");
  assert.deepEqual(contractErrors("threads.outside_agent.add", "out", out), []);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.outside_agent.add: a chat in a channel is the channel; a person cannot give more than they hold, and then nothing is left behind", async () => {
  const { w, hn } = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "deal", visibility: "invite", idempotencyKey: key() })).channel;
  await h["threads.outside_agent.add"]!(hn.ctx, { threadId: ch.mainThreadId, agentId: OUTSIDE });
  assert.deepEqual(w.shared.map((s) => s["resource"]), [{ type: "channel", id: ch.channelId }], "the channel covers its chat");
  w.shared.length = 0; w.unshared.length = 0;
  const id = scopedChat(hn);
  w.refuse.add("share:folder");   // Dana holds only View on the folder: access.share refuses Edit
  assert.equal(await failure(h["threads.outside_agent.add"]!(hn.ctx, { threadId: id, agentId: OUTSIDE })), "permission.not_contained");
  assert.deepEqual(w.shared.map((s) => s["resource"].type), ["thread", "project"]);
  assert.deepEqual(w.unshared.map((s) => s["resource"].type), ["thread", "project"], "what was given is taken back");
  assert.ok(w.unshared.every((u) => u["source"] === `chat:${id}` && u["subject"].id === OUTSIDE));
  assert.deepEqual(agentsOf(hn.db, id), [], "the agent did not join");
});

test("threads.outside_agent.add refuses an agent that is not outside, one the person did not connect, and a chat they are not in", async () => {
  const { w, hn } = world();
  const id = scopedChat(hn);
  assert.equal(await failure(h["threads.outside_agent.add"]!(hn.ctx, { threadId: id, agentId: DRAFTER })), "validation.precondition_failed");
  w.refuse.add(`usable:${OUTSIDE}`);
  assert.equal(await failure(h["threads.outside_agent.add"]!(hn.ctx, { threadId: id, agentId: OUTSIDE })), "permission.no_grant");
  w.refuse.clear();
  assert.equal(await failure(h["threads.outside_agent.add"]!(hn.person(MAYA), { threadId: id, agentId: OUTSIDE })), "validation.not_found");
  assert.equal(w.shared.length, 0);
});

test("removing an outside agent ends its access at once, by source, through either door; if the access cannot be taken back the agent stays", async () => {
  const { w, hn } = world();
  const id = scopedChat(hn);
  await h["threads.outside_agent.add"]!(hn.ctx, { threadId: id, agentId: OUTSIDE });
  w.refuse.add("unshare");
  assert.equal(await failure(h["threads.outside_agent.remove"]!(hn.ctx, { threadId: id, agentId: OUTSIDE })), "permission.no_grant");
  assert.equal(agentsOf(hn.db, id).length, 1, "still here: the access was not taken back");
  w.refuse.clear();
  const out = await h["threads.outside_agent.remove"]!(hn.ctx, { threadId: id, agentId: OUTSIDE });
  assert.equal(out.revoked, 4);
  assert.deepEqual(w.unshared.map((u) => u["resource"].type), ["thread", "project", "folder", "record"]);
  assert.ok(w.unshared.every((u) => u["source"] === `chat:${id}`));
  assert.deepEqual(agentsOf(hn.db, id), []);
  // the usual door does the same
  await h["threads.outside_agent.add"]!(hn.ctx, { threadId: id, agentId: OUTSIDE });
  w.unshared.length = 0;
  await h["threads.remove_agent"]!(hn.ctx, { threadId: id, agentId: OUTSIDE });
  assert.equal(w.unshared.length, 4, "threads.remove_agent revokes by source too");
  assert.deepEqual(agentsOf(hn.db, id), []);
});

test("an outside agent in this chat cannot read another chat's history", async () => {
  const { hn } = world();
  const id = scopedChat(hn);
  const other = await chatOf(hn);
  insertMessage(hn.ctx, other, { author: DANA, kind: "text", body: "private" });
  await h["threads.outside_agent.add"]!(hn.ctx, { threadId: id, agentId: OUTSIDE });
  const call = { ...hn.agent(OUTSIDE, DANA), thread: id };
  assert.equal(await failure(h["chat.history.page"]!(call, { threadId: other, before: 9 })), "permission.no_grant");
});

// ---- 7 a guest of this chat only

test("threads.invite_guest: a guest of one channel chat by email, view or reply; a private chat becomes a channel first; only its owner invites", async () => {
  const { w, hn } = world();
  const priv = await chatOf(hn);
  assert.equal(await failure(h["threads.invite_guest"]!(hn.ctx, { threadId: priv, email: "sam@example.com" })), "validation.precondition_failed");
  const ch = (await h["channels.create"]!(hn.ctx, { name: "client", visibility: "invite", idempotencyKey: key() })).channel;
  const out = await h["threads.invite_guest"]!(hn.ctx, { threadId: ch.mainThreadId, email: " Sam@Example.com ", level: "reply", idempotencyKey: key() });
  assert.deepEqual(out, { inviteId: "inv_guest1", link: "https://maya.vyre.run/join/AAAA-BBBB#fp=ab" });
  assert.deepEqual(w.invites[0], { email: "sam@example.com", scope: { type: "channel", id: ch.channelId }, level: "reply", idempotencyKey: w.invites[0]!["idempotencyKey"] });
  assert.deepEqual(contractErrors("threads.invite_guest", "out", out), []);
  assert.equal(await failure(h["threads.invite_guest"]!(hn.ctx, { threadId: ch.mainThreadId, email: "not an email" })), "validation.bad_input");
  assert.equal(await failure(h["threads.invite_guest"]!(hn.ctx, { threadId: ch.mainThreadId, email: "a@b.co", level: "edit" })), "validation.bad_input");
  // a member who is not the owner does not bring guests in
  await h["threads.members.add"]!(hn.ctx, { threadId: ch.mainThreadId, personId: LEO });
  assert.equal(await failure(h["threads.invite_guest"]!(hn.person(LEO), { threadId: ch.mainThreadId, email: "a@b.co" })), "permission.no_grant");
  assert.equal(w.invites.length, 1);
});

test("a message id is minted the usual way (guard for the helper the tests use)", () => {
  assert.match(mintId("msg"), /^msg_[a-z0-9]+$/);
});

// ---- 6 who may change how an agent answers, and the topics draft

test("threads.agent_settings.set: the person who added the agent, the chat's owner, a manager and the lead agent may change it; everyone else is told who can", async () => {
  const { hn } = world();
  const id = await chatOf(hn);                          // Dana owns it; Intake leads
  addMember(hn.ctx, id, MAYA);
  addMember(hn.ctx, id, LEO);
  addAgent(hn.ctx, id, { agentId: DRAFTER, mode: "listen", addedBy: MAYA });
  const set = (ctx: Harness["ctx"], input: Record<string, unknown> = { style: "full" }) => h["threads.agent_settings.set"]!(ctx, { threadId: id, agentId: DRAFTER, ...input });
  await set(hn.person(MAYA), { style: "full" });           // the person who added it
  await set(hn.ctx, { style: "short" });                   // the chat's owner
  await set({ ...hn.person(LEO), authorize: () => ({ effect: "allow" }) } as Harness["ctx"], { style: "full" });   // someone who manages the chat
  await set(hn.agent(INTAKE), { style: "short" });         // the lead agent
  const refused = hn.person(LEO);
  assert.equal(await failure(set(refused)), "permission.role_lacks_permission", "another member");
  try { await set(refused); assert.fail("should refuse"); } catch (e) {
    assert.equal((e as Error).message, "Only Maya, the chat's owner or someone who manages this chat can change how Ember answers.".replace("Ember", "Drafter"));
  }
  // an agent that is not the lead changes nothing, unless it added the agent itself
  assert.equal(await failure(set(hn.agent(DRAFTER))), "permission.role_lacks_permission", "a teammate that is not the lead");
  assert.equal(await failure(set({ ...hn.agent(DRAFTER), actingFor: MAYA } as Harness["ctx"])), "permission.role_lacks_permission", "the app acting for someone else's agent");
  addAgent(hn.ctx, id, { agentId: "agt_extra", mode: "listen", addedBy: DRAFTER });
  await h["threads.agent_settings.set"]!(hn.agent(DRAFTER), { threadId: id, agentId: "agt_extra", style: "full" });
  assert.equal(agentsOf(hn.db, id).find((a) => a.agentId === "agt_extra")?.style, "full", "the agent that added it may");
});

test("threads.agent_settings.set: Only on topics with the box still empty is a draft that is kept and answers as Always until the words are there", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  await h["threads.add_agent"]!(hn.ctx, { threadId: id, agentId: DRAFTER });
  const draft = await h["threads.agent_settings.set"]!(hn.ctx, { threadId: id, agentId: DRAFTER, when: "topics", topics: "  " });
  const row = draft.thread.agents.find((a: any) => a.agentId === DRAFTER);
  assert.deepEqual([row.when, row.topics], ["topics", undefined], "kept, no error while typing");
  assert.equal(mayAnswerUntagged({ id: DRAFTER, mode: "listen", when: "topics" } as never, "Where is the invoice?", undefined), true, "answers as Always while the box is empty");
  assert.equal(mayAnswerUntagged({ id: DRAFTER, mode: "listen", when: "topics", topics: "contracts" } as never, "Where is the invoice?", undefined), false, "and by its topics once they are written");
  assert.equal(mayAnswerUntagged({ id: DRAFTER, mode: "listen", when: "topics", topics: "invoices" } as never, "Where is the invoice?", undefined), true);
});
