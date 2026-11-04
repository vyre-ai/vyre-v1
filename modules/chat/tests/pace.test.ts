// chat.pace_of: how a teammate answers, for their profile. A usual reply time from chats the asker is in with them, and how they hear about one chat.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { paceOf } from "../handlers/pace.ts";
import { ensureFollowTable } from "../handlers/follow.ts";
import { DANA, LEO, MAYA, contractErrors, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `pc-${++n}`;
const names = { "access.principals.get": (i: any) => ({ principal: { name: i.principal.id === MAYA ? "Maya Rivera" : i.principal.id === LEO ? "Leo Park" : "Dana Cole" } }) };

/** Dana writes, Maya answers `wait` ms later, `times` times. */
async function exchange(hn: ReturnType<typeof harness>, threadId: string, wait: number, times: number, body = "can you send the letter?", mentions: Array<{ kind: "person"; id: string }> = [], answer: string = MAYA): Promise<void> {
  for (let i = 0; i < times; i++) {
    await h["chat.post"]!(hn.ctx, { threadId, body, ...(mentions.length > 0 ? { mentions } : {}), idempotencyKey: key() });
    hn.advance(wait);
    await h["chat.post"]!(hn.person(answer), { threadId, body: "on it", idempotencyKey: key() });
    hn.advance(60_000);
  }
}

test("the words for a median wait: minutes, the hour, the day, longer, and unknown below three moments", () => {
  assert.equal(paceOf([60_000, 120_000, 300_000]), "minutes");
  assert.equal(paceOf([30 * 60_000, 40 * 60_000, 50 * 60_000]), "hour");
  assert.equal(paceOf([3 * 3_600_000, 4 * 3_600_000, 5 * 3_600_000]), "day");
  assert.equal(paceOf([2 * 86_400_000, 3 * 86_400_000, 4 * 86_400_000]), "slow");
  assert.equal(paceOf([60_000, 120_000]), "unknown");
  assert.equal(paceOf([60_000, 60_000, 2 * 86_400_000]), "minutes", "the median, not the mean: one slow day does not move it");
});

test("in a direct chat the usual wait from the asker's line to their next message is the answer, and the answer fits its contract", async () => {
  const hn = harness({ calls: names });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await exchange(hn, dm, 20 * 60_000, 4);
  const out = await h["chat.pace_of"]!(hn.ctx, { personId: MAYA, threadId: dm });
  assert.deepEqual(out, { replies: "hour", samples: 4, notifies: "all" });
  assert.deepEqual(contractErrors("chat.pace_of", "out", out), []);
  assert.deepEqual(contractErrors("chat.pace_of", "in", { personId: MAYA }), []);
});

test("fewer than three moments says it cannot tell; nothing is guessed", async () => {
  const hn = harness({ calls: names });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await exchange(hn, dm, 60_000, 2);
  assert.deepEqual(await h["chat.pace_of"]!(hn.ctx, { personId: MAYA }), { replies: "unknown", samples: 2 });
});

test("in a group chat only a mention of them by person id, or a reply to them, waits on them; a line to nobody, or their name in plain words, does not", async () => {
  const hn = harness({ calls: names });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await h["threads.members.add"]!(hn.ctx, { threadId: dm, personId: LEO });
  // lines to nobody, answered late: not a wait
  await exchange(hn, dm, 3 * 86_400_000, 3, "lunch anyone?");
  assert.equal((await h["chat.pace_of"]!(hn.ctx, { personId: MAYA })).samples, 0);
  // her name typed as plain words, with no mention chip: not a wait either
  await exchange(hn, dm, 5 * 60_000, 3, "@Maya can you send the letter?");
  assert.equal((await h["chat.pace_of"]!(hn.ctx, { personId: MAYA })).samples, 0, "a name in plain text is not a mention");
  // the same person mentioned as a chip, answered in five minutes, three times
  await exchange(hn, dm, 5 * 60_000, 3, "@Maya can you send the letter?", [{ kind: "person", id: MAYA }]);
  const out = await h["chat.pace_of"]!(hn.ctx, { personId: MAYA, threadId: dm });
  assert.deepEqual(out, { replies: "minutes", samples: 3, notifies: "mentions" });
});

test("two people who share a first name are told apart by person id: a mention of one never waits on the other", async () => {
  const MAYA_B = "usr_maya_b";
  const hn = harness({ calls: { "access.principals.get": () => ({ principal: { name: "Maya" } }) } });
  const room = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await h["threads.members.add"]!(hn.ctx, { threadId: room, personId: MAYA_B });
  await h["threads.members.add"]!(hn.ctx, { threadId: room, personId: LEO });
  // Dana asks the first Maya, who answers in five minutes; the second Maya is chatty but never asked
  await exchange(hn, room, 5 * 60_000, 3, "@Maya, can you send the letter?", [{ kind: "person", id: MAYA }]);
  for (let i = 0; i < 3; i++) { await h["chat.post"]!(hn.person(MAYA_B), { threadId: room, body: "morning", idempotencyKey: key() }); hn.advance(60_000); }
  assert.deepEqual(await h["chat.pace_of"]!(hn.ctx, { personId: MAYA }), { replies: "minutes", samples: 3 });
  assert.deepEqual(await h["chat.pace_of"]!(hn.ctx, { personId: MAYA_B }), { replies: "unknown", samples: 0 }, "the same first name in the words is not a mention of her");
  // now the second Maya is the one asked, and she is slow
  await exchange(hn, room, 3 * 3_600_000, 3, "@Maya, and the invoice?", [{ kind: "person", id: MAYA_B }], MAYA_B);
  assert.deepEqual(await h["chat.pace_of"]!(hn.ctx, { personId: MAYA_B }), { replies: "day", samples: 3 });
  assert.equal((await h["chat.pace_of"]!(hn.ctx, { personId: MAYA })).replies, "minutes", "and the first Maya's answer does not move");
});

test("a chat the asker is not in never counts, however many lines they wrote there", async () => {
  const hn = harness({ calls: names });
  const mine = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await exchange(hn, mine, 10 * 60_000, 3);
  // Leo and Maya, three chats' worth of instant answers, with no Dana in them
  const theirs = (await h["chat.start"]!(hn.person(LEO), { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  for (let i = 0; i < 6; i++) {
    await h["chat.post"]!(hn.person(LEO), { threadId: theirs, body: "ping", idempotencyKey: key() });
    hn.advance(5_000);
    await h["chat.post"]!(hn.person(MAYA), { threadId: theirs, body: "pong", idempotencyKey: key() });
  }
  const out = await h["chat.pace_of"]!(hn.ctx, { personId: MAYA, threadId: theirs });
  assert.deepEqual(out, { replies: "minutes", samples: 3 }, "only Dana's own three exchanges; no notifies for a chat she is not in");
  // as Leo the same question counts his chat and not Dana's
  const asLeo = await h["chat.pace_of"]!(hn.person(LEO), { personId: MAYA });
  assert.equal(asLeo.samples, 6);
});

test("a thread they left says off, a mute of it stays private, and lines older than 30 days are left out", async () => {
  const hn = harness({ calls: names });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await exchange(hn, dm, 10 * 60_000, 3);
  assert.equal((await h["chat.pace_of"]!(hn.ctx, { personId: MAYA, threadId: dm })).notifies, "all");
  ensureFollowTable(hn.ctx);
  hn.raw.run('INSERT INTO chat_thread_follow ("thread", "principal", "mode", "at") VALUES (?, ?, ?, ?)', dm, MAYA, "mute", hn.clock.t);
  assert.equal((await h["chat.pace_of"]!(hn.ctx, { personId: MAYA, threadId: dm })).notifies, "all", "a mute is her own business");
  hn.raw.run('UPDATE chat_thread_follow SET "mode" = ? WHERE "thread" = ? AND "principal" = ?', "left", dm, MAYA);
  assert.equal((await h["chat.pace_of"]!(hn.ctx, { personId: MAYA, threadId: dm })).notifies, "off", "leaving is visible to the members");
  hn.advance(31 * 86_400_000);
  assert.deepEqual(await h["chat.pace_of"]!(hn.ctx, { personId: MAYA }), { replies: "unknown", samples: 0 }, "all of it is older than 30 days");
  assert.deepEqual(await h["chat.pace_of"]!(hn.ctx, { personId: DANA }), { replies: "unknown", samples: 0 }, "yourself has no pace to show");
});

test("a mute made in Notifications is private: nothing is asked of that module, and the level stands", async () => {
  const asked: string[] = [];
  const hn = harness({ calls: { ...names, "notifications.mute.list": () => { asked.push("mute.list"); return { mutes: [] }; } } });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  assert.equal((await h["chat.pace_of"]!(hn.ctx, { personId: MAYA, threadId: dm })).notifies, "all");
  assert.deepEqual(hn.callLog.filter((c) => c.cap.startsWith("notifications.")), [], "no call reaches the notifications module");
  assert.deepEqual(asked, []);
});
