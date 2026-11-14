// chat.chapters and chat.chapters_write: a short chat has none; a long one is cut at a Fresh context line, a gap of 3 hours and 80 messages; titles are the plain words until a cheap model writes them.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { boundaries, chaptersOf, extractOf } from "../handlers/chapters.ts";
import type { Msg } from "../handlers/chapters.ts";
import { DANA, MAYA, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `ch-${++n}`;
const HOUR = 3_600_000;

const msg = (seq: number, at: number, o: Partial<Msg> = {}): Msg => ({
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

test("a chapter's heading is the first request, its line is the last answer; a saved heading wins", () => {
  const m = run(60, { 30: 4 * HOUR });
  const a = chaptersOf(m, new Map());
  assert.equal(a.length, 2);
  assert.equal(a[0]!.title, "Plan item 1");
  assert.equal(a[0]!.summary, "Done with item 27.");
  assert.equal(a[1]!.current, true);
  const b = chaptersOf(m, new Map([[1, { title: "Portal plan", summary: "Three milestones", writer: "model" }]]));
  assert.equal(b[0]!.title, "Portal plan");
  assert.equal(b[0]!.by, "model");
  assert.equal(b[1]!.by, "extract");
  assert.equal(extractOf([]).title, "Earlier");
});

async function longChat(hn: ReturnType<typeof harness>, count: number, gapAt: number) {
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread
    .threadId as string;
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
  const w = await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account: { ref: "acc_1", driver: "claude" } });
  assert.equal(w.written, 1);
  assert.equal(calls.length, 1);
  const b = await h["chat.chapters"]!(hn.ctx, { threadId: t });
  assert.equal(b.chapters[0].title, "Portal plan");
  assert.equal(b.chapters[0].summary, "Three milestones, Dana leads");
  assert.equal(b.chapters[0].by, "model");
  assert.equal(b.wanted, 0);
  assert.equal(
    (await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account: { ref: "acc_1", driver: "claude" } })).written,
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
    (await h["chat.chapters_write"]!(hn.ctx, { threadId: t, account: { ref: "a", driver: "claude" } })).written,
    0,
  );
  const a = await h["chat.chapters"]!(hn.ctx, { threadId: t });
  assert.equal(a.chapters[0].by, "extract");
  assert.equal(a.chapters[0].title, "Plan item 1");
});
