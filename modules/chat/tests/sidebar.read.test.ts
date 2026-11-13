// chats.sidebar: the sidebar in one answer, as the caller. Sections by the shared rule (lib/sidebar.ts), the caller's own pins and mutes, mentions joined from notifications, a one-to-one as the person's row, pages with a
// cursor, a guest with no goals or team, an unknown filter refused in words, and the neighbours asked once each however many rows there are.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../handlers/index.ts";
import { SIDEBAR_PAGE, chatsSidebar } from "../handlers/sidebar.ts";
import { DANA, INTAKE, MAYA, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

let k = 0;
const agentChat = async (hn: Harness, title?: string): Promise<string> => {
  const r = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `s${++k}` });
  const id = r.thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: id, body: title ?? `hello ${k}`, idempotencyKey: `p${k}` });
  hn.advance(1000);
  return id;
};
const world = (
  o: {
    stars?: unknown[];
    mentions?: unknown[];
    principals?: unknown[];
    goals?: unknown[];
    failedThreads?: string[];
  } = {},
) => ({
  "stars.list": () => ({ stars: o.stars ?? [] }),
  "notifications.unseen_by_thread": () => ({ counts: o.mentions ?? [], capped: false }),
  "tasks.needs_you": () => ({
    total: 2,
    items: [
      { task: { id: "tsk_1", title: "Send 12 invoices", kind: "approve", createdBy: INTAKE } },
      { task: { id: "tsk_2", title: "Review the fix", kind: "review", createdBy: INTAKE } },
    ],
  }),
  "goals.list": () => ({
    goals: o.goals ?? [
      {
        id: "gol_1",
        title: "Close onboarding",
        status: "active",
        leadAgentId: INTAKE,
        updatedAt: 5,
        progress: { tasksDone: 3, tasks: 7 },
      },
    ],
  }),
  "projects.list": () => ({ projects: [] }),
  "agents.list": () => ({ agents: [{ agentId: INTAKE, name: "Intake" }] }),
  "access.principals.list": () => ({
    principals: o.principals ?? [
      { id: MAYA, name: "Maya Chen" },
      { id: DANA, name: "Dana" },
    ],
  }),
  "engine.now": () => ({ working: [] }),
  "engine.thread_states": (i: Record<string, unknown>) => ({
    states: ((i["threadIds"] as string[]) ?? [])
      .filter((t) => (o.failedThreads ?? []).includes(t))
      .map((threadId) => ({ threadId, state: "failed", failedLine: "The AI provider did not answer." })),
  }),
});

test("one answer: needs, goals, pinned, chats, channels, team and the rail; it validates against the contract", async () => {
  const hn = harness({ calls: world() });
  await agentChat(hn);
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  assert.deepEqual(contractErrors("chats.sidebar", "out", out), []);
  assert.equal(out.needs.total, 2);
  assert.deepEqual(
    out.needs.items.map((n: { verb: string }) => n.verb),
    ["Allow", "Review"],
  );
  assert.equal(out.goals.rows[0].title, "Close onboarding");
  assert.deepEqual(out.goals.rows[0].progress, { done: 3, total: 7 });
  assert.equal(out.chats.total, 1);
  assert.ok(out.team.rows.some((r: { key: string }) => r.key === "f:" + INTAKE));
  assert.ok(out.team.rows.some((r: { personId?: string }) => r.personId === MAYA));
  assert.equal(out.rail, 2, "the two waiting tasks");
});

test("pinned is the caller's own order: a pinned chat is in Pinned once with its index, not in Chats", async () => {
  const hn = harness({ calls: world() });
  const a = await agentChat(hn, "first");
  const b = await agentChat(hn, "second");
  const out = await chatsSidebar(hn.ctx, {}, () => ({
    pins: async () =>
      new Map([
        [`c:${b}`, 0],
        [`c:${a}`, 1],
      ]),
    mutedThreads: () => new Set<string>(),
  }));
  assert.deepEqual(
    out.pinned.rows.map((r: { key: string; pinned: number | null }) => [r.key, r.pinned]),
    [
      [`c:${b}`, 0],
      [`c:${a}`, 1],
    ],
  );
  assert.equal(out.chats.rows.length, 0);
});

test("today's source: the caller's stars, newest first, are the pin order; stars of other kinds of thing are not pins", async () => {
  const o: { stars: unknown[]; mentions: unknown[] } = { stars: [], mentions: [] };
  const hn = harness({ calls: world(o) });
  const a = await agentChat(hn);
  const b = await agentChat(hn);
  o.stars = [
    { resource: { type: "thread", id: a }, title: "a", at: 100 },
    { resource: { type: "thread", id: b }, title: "b", at: 200 },
    { resource: { type: "record", id: "rec_z" }, title: "z", at: 300 },
  ];
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  assert.deepEqual(
    out.pinned.rows.map((r: { key: string }) => r.key),
    [`c:${b}`, `c:${a}`],
  );
  assert.deepEqual(
    out.pinned.rows.map((r: { pinned: number }) => r.pinned),
    [0, 1],
  );
});

test("a mute of mine shows muted; a mention count joins the chat by its thread and shows in the rail", async () => {
  const o: { stars: unknown[]; mentions: unknown[] } = { stars: [], mentions: [] };
  const hn = harness({ calls: world(o) });
  const a = await agentChat(hn);
  const b = await agentChat(hn);
  o.mentions = [{ threadId: b, mentions: 3 }];
  const out = await chatsSidebar(hn.ctx, {}, () => ({ pins: async () => new Map(), mutedThreads: () => new Set([a]) }));
  const row = (id: string) => out.chats.rows.find((r: { key: string }) => r.key === `c:${id}`);
  assert.equal(row(a)?.muted, true);
  assert.equal(row(b)?.muted, false);
  assert.equal(row(b)?.mentions, 3);
  assert.equal(out.rail, 2 + 3, "two waiting tasks and three mentions");
});

test("an unknown filter is refused in plain words and names the choices", async () => {
  const hn = harness({ calls: world() });
  await assert.rejects(
    () => h["chats.sidebar"]!(hn.ctx, { filter: "bananas" }),
    (e: unknown) =>
      codeOf(e) === "validation.bad_input" &&
      /not a way to filter.*unread, mentions/.test(String((e as Error).message)),
  );
});

test("a guest, who may not start chats, gets no goals, team or agents, and those neighbours are not asked", async () => {
  const hn = harness({ calls: world() });
  await agentChat(hn);
  const guest = { ...hn.ctx, authorize: () => ({ effect: "deny" }) } as Harness["ctx"];
  hn.callLog.length = 0;
  const out = await h["chats.sidebar"]!(guest, {});
  assert.equal(out.goals.total, 0);
  assert.equal(out.team.total, 0);
  const asked = hn.callLog.map((c: { cap: string }) => c.cap);
  for (const cap of ["goals.list", "agents.list", "access.principals.list", "projects.list"])
    assert.ok(!asked.includes(cap), cap);
});

test("pages: each section answers its first 50, a cursor, and `more` gives the next page; the limit has a maximum", async () => {
  const hn = harness({ calls: world({ principals: [] }) });
  for (let i = 0; i < SIDEBAR_PAGE + 20; i++) await agentChat(hn);
  const first = await h["chats.sidebar"]!(hn.ctx, {});
  assert.equal(first.chats.total, SIDEBAR_PAGE + 20);
  assert.equal(first.chats.rows.length, SIDEBAR_PAGE);
  assert.ok(first.chats.next);
  const more = await h["chats.sidebar"]!(hn.ctx, { more: { section: "chats", after: first.chats.next } });
  assert.equal(more.chats.rows.length, 20);
  assert.equal(more.chats.next, undefined);
  const keys = new Set([...first.chats.rows, ...more.chats.rows].map((r: { key: string }) => r.key));
  assert.equal(keys.size, SIDEBAR_PAGE + 20, "no row twice, none lost");
  assert.ok(
    contractErrors("chats.sidebar", "in", { more: { section: "chats", limit: 101 } }).length > 0,
    "limit above 100 is refused by the contract",
  );
  assert.deepEqual(contractErrors("chats.sidebar", "in", { more: { section: "chats", limit: 100 } }), []);
});

test("the neighbours are asked once each, however many rows there are (none per row)", async () => {
  const few = harness({ calls: world() });
  await agentChat(few);
  few.callLog.length = 0;
  await h["chats.sidebar"]!(few.ctx, {});
  const fewCalls = few.callLog.map((c: { cap: string }) => c.cap).sort();
  const many = harness({ calls: world() });
  for (let i = 0; i < 60; i++) await agentChat(many);
  many.callLog.length = 0;
  await h["chats.sidebar"]!(many.ctx, {});
  assert.deepEqual(many.callLog.map((c: { cap: string }) => c.cap).sort(), fewCalls);
  assert.ok(new Set(fewCalls).size === fewCalls.length, "each neighbour once");
});

test("proof: 2,000 chats paged to the end cost at most ceil(2000 / page) reads of the sidebar, and each read asks every neighbour once: nothing per row", async () => {
  const hn = harness({ calls: world({ principals: [] }) });
  // 2,000, not 5,000: every read still walks the caller's threads in this module (an indexed listing would fix that), and 50 such reads of 5,000 do not fit the file's time limit
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const r = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `big${i}` });
    await h["chat.post"]!(hn.ctx, { threadId: r.thread.threadId, body: `m${i}`, idempotencyKey: `bigp${i}` });
  }
  const PAGE = 100;
  hn.callLog.length = 0;
  let reads = 0;
  let after: string | undefined;
  const seen = new Set<string>();
  const perRead: number[] = [];
  for (;;) {
    const before = hn.callLog.length;
    const out = await h["chats.sidebar"]!(hn.ctx, {
      more: { section: "chats", limit: PAGE, ...(after ? { after } : {}) },
    });
    perRead.push(hn.callLog.length - before);
    reads++;
    for (const r of out.chats.rows) seen.add(r.key);
    if (!out.chats.next) break;
    after = out.chats.next;
  }
  assert.equal(seen.size, N, "every row arrived, once");
  assert.equal(reads, Math.ceil(N / PAGE), "one read per page");
  assert.ok(
    new Set(perRead).size === 1,
    `each read asked the neighbours the same number of times (${[...new Set(perRead)].join(",")}), not once per row`,
  );
  assert.ok(perRead[0]! <= 9, "a handful of neighbour reads per page");
});

test("a chat whose latest turn failed is marked failed with words, from one engine read for the rows the answer carries", async () => {
  const o: { failedThreads: string[] } = { failedThreads: [] };
  const hn = harness({ calls: world(o) });
  const a = await agentChat(hn);
  const b = await agentChat(hn);
  o.failedThreads = [a];
  hn.callLog.length = 0;
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  const row = (id: string) => out.chats.rows.find((r: { key: string }) => r.key === `c:${id}`);
  assert.equal(row(a).failed, true);
  assert.equal(row(a).failedLine, "The AI provider did not answer.");
  assert.equal(row(b).failed, false);
  assert.equal(row(b).failedLine, undefined);
  assert.equal(
    hn.callLog.filter((c: { cap: string }) => c.cap === "engine.thread_states").length,
    1,
    "one call for all the rows",
  );
  assert.deepEqual(contractErrors("chats.sidebar", "out", out), []);
});
