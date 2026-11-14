// chat.chapters and chat.chapters_write: a short chat has none; a long one is cut at a Fresh context line, a gap of 3 hours and 80 messages; titles are the plain words until a cheap model writes them.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { boundaries, extractOf } from "../handlers/chapters.ts";
import type { Msg } from "../handlers/chapters.ts";
import { DANA, MAYA, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `ch-${++n}`;
const HOUR = 3_600_000;

const msg = (seq: number, at: number, o: Partial<Msg> = {}): Msg => ({
  id: `m${seq}`,
  author: seq % 2 === 1 ? "usr_dana" : "agt_x",
  seq,
  at,
  kind: "text",
  person: seq % 2 === 1,
  body: seq % 2 === 1 ? `Please plan item ${seq}` : `Done with item ${seq - 1}. More words follow.`,
  ...o,
});
const run = (count: number, gapAt: Record<number, number> = {}): Msg[] => {
  let t = 1_000_000;
  const out: Msg[] = [];
  for (let i = 1; i <= count; i++) {
    t += gapAt[i] ?? 60_000;
    out.push(msg(i, t));
  }
  return out;
};

test("40 messages or fewer have no chapters, however long the gaps", () => {
  assert.deepEqual(boundaries(run(40, { 20: 9 * HOUR })), []);
});

test("a gap of 3 hours, a Fresh context line and 80 messages each start a chapter; a gap too early does not", () => {
  assert.deepEqual(boundaries(run(60, { 30: 4 * HOUR })), [0, 29]);
  assert.deepEqual(boundaries(run(60, { 4: 4 * HOUR })), [], "fewer than 8 messages in the chapter: no cut");
  const fresh = run(60);
  fresh[44] = msg(45, fresh[44]!.at, {
    kind: "system",
    person: false,
    body: "Fresh context. Chapters 1 to 8 are carried",
  });
  assert.deepEqual(boundaries(fresh), [0, 44]);
  const b = boundaries(run(200));
  assert.equal(b[0], 0);
  for (let i = 1; i < b.length; i++) assert.ok(b[i]! - b[i - 1]! >= 80);
});

test("a chapter's plain heading is the first request and its line the last answer", () => {
  const m = run(30);
  assert.equal(extractOf(m).title, "Plan item 1");
  assert.equal(extractOf(m).summary, "Done with item 29.");
  assert.equal(extractOf([]).title, "Earlier");
});

async function longChat(hn: ReturnType<typeof harness>, count: number, gapAt: number) {
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() }))
    .thread.threadId as string;
  for (let i = 1; i <= count; i++) {
    hn.advance(i === gapAt ? 4 * HOUR : 60_000);
    await h["chat.post"]!(hn.ctx, { threadId: t, body: `Plan item ${i} for the portal`, idempotencyKey: key() });
  }
  return t;
}

test("the read costs nothing on a short chat and lists chapters on a long one; the writer fills closed chapters from a cheap model and leaves plain words when it fails", async () => {
  const calls: string[] = [];
  const hn = harness({
    calls: {
      "engine.models.list": () => ({ models: [{ model: "claude-haiku-4-5", allowed: true }] }),
      "engine.complete": (i) => {
        calls.push(String(i["model"]));
        return { text: "Portal plan\nThree milestones, Dana leads" };
      },
    },
  });
  const short = await longChat(hn, 10, 0);
  assert.deepEqual(await h["chat.chapters"]!(hn.ctx, { threadId: short }), { chapters: [], wanted: 0 });
  const t = await longChat(hn, 60, 30);
  const a = await h["chat.chapters"]!(hn.ctx, { threadId: t });
  assert.equal(a.chapters.length, 2);
  assert.equal(a.wanted, 1, "the open chapter is never written");
  const w = await h["chat.chapters_write"]!(hn.ctx, {
    threadId: t,
    account: { ref: "acc_1", driver: "claude", kind: "api_key" },
  });
  assert.equal(w.written, 1);
  assert.equal(calls.length, 1);
  const b = await h["chat.chapters"]!(hn.ctx, { threadId: t });
  assert.equal(b.chapters[0].title, "Portal plan");
  assert.equal(b.chapters[0].summary, "Three milestones, Dana leads");
  assert.equal(b.chapters[0].by, "model");
  assert.equal(b.wanted, 0);
  assert.equal(
    (
      await h["chat.chapters_write"]!(hn.ctx, {
        threadId: t,
        account: { ref: "acc_1", driver: "claude", kind: "api_key" },
      })
    ).written,
    0,
  );
  void DANA;
});

test("a model that fails leaves the plain words and the post path is not touched", async () => {
  const hn = harness({
    calls: {
      "engine.models.list": () => ({ models: [{ model: "claude-haiku-4-5", allowed: true }] }),
      "engine.complete": () => {
        throw new Error("down");
      },
    },
  });
  const t = await longChat(hn, 60, 30);
  assert.equal(
    (await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account: { ref: "a", driver: "claude", kind: "api_key" } }))
      .written,
    0,
  );
  const a = await h["chat.chapters"]!(hn.ctx, { threadId: t });
  assert.equal(a.chapters[0].by, "extract");
  assert.equal(a.chapters[0].title, "Plan item 1");
});

test("a 200-message chat makes no more model calls than it has closed chapters, and never asks twice for one chapter", async () => {
  let calls = 0;
  const hn = harness({
    calls: {
      "engine.models.list": () => ({ models: [{ model: "claude-haiku-4-5", allowed: true }] }),
      "engine.complete": () => {
        calls++;
        return { text: "Plan\nSettled it" };
      },
    },
  });
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() }))
    .thread.threadId as string;
  const account = { ref: "acc_1", driver: "claude", kind: "api_key" };
  for (let i = 1; i <= 200; i++) {
    hn.advance(i % 50 === 0 ? 4 * HOUR : 60_000);
    await h["chat.post"]!(hn.ctx, { threadId: t, body: `Plan item ${i} for the portal`, idempotencyKey: key() });
    if (i % 2 === 0) await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account });
  }
  const done = await h["chat.chapters"]!(hn.ctx, { threadId: t });
  const closed = done.chapters.filter((c: any) => !c.current).length;
  assert.equal(closed, 4, "gaps before messages 50, 100, 150 and 200 start five chapters; the last is open");
  assert.ok(calls <= closed, `${calls} calls for ${closed} closed chapters`);
  assert.equal(calls, closed);
  const before = calls;
  for (let i = 0; i < 5; i++) await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account });
  assert.equal(calls, before, "nothing is asked again");
});

test("a subscription, an account with no kind, and a chapter another person opened cost no call", async () => {
  let calls = 0;
  const hn = harness({
    calls: {
      "engine.models.list": () => ({ models: [{ model: "claude-haiku-4-5", allowed: true }] }),
      "engine.complete": () => {
        calls++;
        return { text: "Plan\nSettled it" };
      },
    },
  });
  const t = await longChat(hn, 60, 30);
  for (const kind of ["subscription", undefined])
    await h["chat.chapters_write"]!(hn.ctx, {
      threadId: t,
      account: { ref: "a", driver: "claude", ...(kind ? { kind } : {}) },
    });
  assert.equal(calls, 0);
  // the same chat read as Maya: the chapter was opened by Dana, so Maya's account is not spent on it
  await h["chat.chapters_write"]!(hn.person(MAYA), {
    threadId: t,
    account: { ref: "m", driver: "claude", kind: "api_key" },
  });
  assert.equal(calls, 0);
  assert.equal((await h["chat.chapters"]!(hn.ctx, { threadId: t })).chapters[0].by, "extract");
});

const lister = {
  "engine.models.list": () => ({ models: [{ model: "claude-haiku-4-5", allowed: true }] }),
};
const API = { ref: "acc_1", driver: "claude", kind: "api_key" };
/** 200 messages 10 s apart (33 minutes: no hour passes), a write after every turn. */
async function twoHundred(hn: ReturnType<typeof harness>, owner: string = MAYA) {
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: owner, idempotencyKey: key() }))
    .thread.threadId as string;
  for (let i = 1; i <= 200; i++) {
    hn.advance(10_000);
    await h["chat.post"]!(hn.ctx, { threadId: t, body: `Plan item ${i} for the portal`, idempotencyKey: key() });
    await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account: API });
  }
  return t;
}

test("a failing model costs at most one call per closed chapter in 200 turns, then one more an hour later, then none", async () => {
  let complete = 0;
  let lists = 0;
  const hn = harness({
    calls: {
      "engine.models.list": () => (lists++, lister["engine.models.list"]()),
      "engine.complete": () => {
        complete++;
        throw new Error("limit reached");
      },
    },
  });
  const t = await twoHundred(hn);
  const closed = (await h["chat.chapters"]!(hn.ctx, { threadId: t })).chapters.filter((c: any) => !c.current).length;
  assert.equal(closed, 2);
  assert.ok(complete <= closed, `${complete} completes for ${closed} closed chapters`);
  assert.ok(lists <= closed, `${lists} models.list calls`);
  hn.advance(2 * HOUR);
  for (let i = 0; i < 4; i++) await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account: API });
  assert.equal(complete, 2 * closed, "one retry per chapter after an hour");
  hn.advance(2 * HOUR);
  for (let i = 0; i < 4; i++) await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account: API });
  assert.equal(complete, 2 * closed, "then never");
});

test("no cheap model: no complete, and models.list no more than once per closed chapter", async () => {
  let complete = 0;
  let lists = 0;
  const hn = harness({
    calls: {
      "engine.models.list": () => (lists++, { models: [{ model: "text-embedding-3", allowed: true }] }),
      "engine.complete": () => (complete++, { text: "x\ny" }),
    },
  });
  // an openai-like driver with only an embedding model has nothing cheap to ask
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() }))
    .thread.threadId as string;
  for (let i = 1; i <= 200; i++) {
    hn.advance(10_000);
    await h["chat.post"]!(hn.ctx, { threadId: t, body: `Plan item ${i}`, idempotencyKey: key() });
    await h["chat.chapters_write"]!(hn.ctx, {
      threadId: t,
      account: { ref: "a", driver: "unknown_driver", kind: "api_key" },
    });
  }
  assert.equal(complete, 0);
  assert.ok(lists <= 2, `${lists} models.list calls`);
});

test("a closed chapter never moves when messages arrive, and a deletion does not move a stored boundary", async () => {
  const hn = harness({ calls: { ...lister, "engine.complete": () => ({ text: "Plan\nSettled it" }) } });
  const t = await twoHundred(hn);
  const before = (await h["chat.chapters"]!(hn.ctx, { threadId: t })).chapters.filter((c: any) => !c.current);
  for (let i = 0; i < 25; i++) {
    hn.advance(10_000);
    await h["chat.post"]!(hn.ctx, { threadId: t, body: `More ${i}`, idempotencyKey: key() });
  }
  const after = (await h["chat.chapters"]!(hn.ctx, { threadId: t })).chapters.filter((c: any) => !c.current);
  assert.deepEqual(
    after.slice(0, before.length).map((c: any) => [c.startSeq, c.startMsg, c.endSeq, c.title]),
    before.map((c: any) => [c.startSeq, c.startMsg, c.endSeq, c.title]),
  );
  assert.ok(before.every((c: any) => c.by === "model"));
  // delete the first message of chapter 1: its stored start stays, its model heading is dropped, its words are gone
  const first = before[0];
  const victim = hn.rows(
    'SELECT id AS messageId, threadSeq, body FROM chat_message WHERE "thread" = ? AND threadSeq = ?',
    t,
    first.startSeq + 2,
  )[0] as any;
  await h["chat.delete_message"]!(hn.ctx, { threadId: t, messageId: victim.messageId, idempotencyKey: key() });
  const again = (await h["chat.chapters"]!(hn.ctx, { threadId: t })).chapters.filter((c: any) => !c.current);
  assert.deepEqual(
    again.map((c: any) => c.startSeq),
    before.map((c: any) => c.startSeq),
  );
  const hit = again.find((c: any) => c.startSeq <= victim.threadSeq && victim.threadSeq <= c.endSeq);
  assert.equal(hit.by, "extract", "the model's heading is dropped with the deleted message");
  assert.ok(!`${hit.title} ${hit.summary}`.includes(victim.body));
});

test("a reader who joined later never gets a heading written from messages before they joined, and sees only their own plain words", async () => {
  const hn = harness({ calls: { ...lister, "engine.complete": () => ({ text: "Secret plan\nSettled it" }) } });
  const t = await twoHundred(hn);
  const all = (await h["chat.chapters"]!(hn.ctx, { threadId: t })).chapters;
  assert.equal(all[0].by, "model");
  // Leo joins now: his floor is after chapter 1 (members get a fromAt)
  const when = hn.clock.t;
  hn.raw.run(
    "INSERT INTO chat_thread_member (thread, principal, fromAt) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    t,
    "usr_leo",
    when,
  );
  const leo = (await h["chat.chapters"]!(hn.person("usr_leo"), { threadId: t })).chapters;
  assert.ok(
    leo.every((c: any) => c.by !== "model" || c.startAt >= when - 0),
    "no model heading reaches a reader who cannot see the whole chapter",
  );
  assert.ok(!leo.some((c: any) => c.title === "Secret plan"));
});
