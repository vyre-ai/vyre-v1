// chats.sidebar: the sidebar in one answer, as the caller. Sections by the shared rule (lib/sidebar.ts), the caller's own pins and mutes, mentions joined from notifications, a one-to-one as the person's row, pages with a
// cursor, a guest with no goals or team, an unknown filter refused in words, and the neighbours asked once each however many rows there are.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../handlers/index.ts";
import { SIDEBAR_PAGE, chatsSidebar } from "../handlers/sidebar.ts";
import { ensureFollowTable } from "../handlers/follow.ts";
import { addMember } from "../projections.ts";
import { FILTER_CHOICES } from "../../../lib/sidebar.ts";
const FILTER_IDS = FILTER_CHOICES.map((c) => c.id);
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
  "identity.whoami": () => ({ permissions: ["chats.private"] }),
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
  const hn = harness({ calls: { ...world(), "identity.whoami": () => ({ permissions: [] }) } });
  await agentChat(hn);
  hn.callLog.length = 0;
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  assert.equal(out.goals.total, 0);
  assert.equal(out.team.total, 0);
  const asked = hn.callLog.map((c: { cap: string }) => c.cap);
  for (const cap of ["goals.list", "agents.list", "access.principals.list", "projects.list"])
    assert.ok(!asked.includes(cap), cap);
  const member = harness({ calls: { ...world(), "identity.whoami": () => ({ permissions: ["chats.private"] }) } });
  await agentChat(member);
  assert.ok((await h["chats.sidebar"]!(member.ctx, {})).team.total > 0, "a member holding chats.private has a team");
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

test("proof: 5,000 chats paged to the end cost at most ceil(5000 / page) reads of the sidebar, and each read asks every neighbour once: nothing per row", async () => {
  const hn = harness({ calls: world({ principals: [] }) });
  const N = 5000;
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
  assert.ok(perRead[0]! <= 11, `a handful of neighbour reads per page, not one per row (${perRead[0]})`);
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

test("the state module is the second source behind the same port: pins in the person's own manual order, a channel's own chat keyed as the channel, other pins after on the stars", async () => {
  const { stateSources } = await import("../handlers/sidebar.ts");
  const answers: Record<string, unknown> = {
    "state.list": {
      rows: [
        { thing: { type: "chat", id: "thr_b" }, pin: 2 },
        { thing: { type: "chat", id: "thr_main" }, pin: 1 },
        { thing: { type: "chat", id: "thr_a" }, pin: 3 },
      ],
    },
    "stars.list": { stars: [{ resource: { type: "project", id: "prj_x" }, title: "x", at: 5 }] },
  };
  const hn = harness({
    calls: { "state.list": () => answers["state.list"], "stars.list": () => answers["stars.list"] } as never,
  });
  const safe = async <T>(cap: string): Promise<T | null> => (answers[cap] as T) ?? null;
  const pins = await stateSources(hn.ctx, safe as never, (t) => (t === "thr_main" ? "chn_gen" : undefined)).pins();
  assert.deepEqual(
    [...pins.entries()],
    [
      ["ch:chn_gen", 0],
      ["c:thr_b", 1],
      ["c:thr_a", 2],
      ["pj:prj_x", 3],
    ],
  );
});

test("the chat kind for the state module: the audience and the rule of who may see a chat are its members, the entries are its messages", async () => {
  const { chatKind, stateKinds } = await import("../state.ts");
  const { openRaw } = await import("../fixtures/harness.ts");
  const raw = openRaw();
  const hn = harness({ raw });
  const t = await agentChat(hn, "one");
  await h["chat.post"]!(hn.ctx, { threadId: t, body: "two", idempotencyKey: "two" });
  assert.deepEqual(
    stateKinds.map((k) => k.type),
    ["chat"],
  );
  const members = chatKind.audience(raw as never, t, { people: [], mayView: () => false });
  assert.ok(members.includes(DANA), "the starter is in the audience");
  assert.equal(chatKind.visible(raw as never, t, DANA, { people: [], mayView: () => false }), true);
  assert.equal(
    chatKind.visible(raw as never, t, "usr_stranger", { people: [], mayView: () => false }),
    false,
    "nobody can pin or mute a chat they cannot see",
  );
  assert.equal(chatKind.entries(raw as never, t).length, 2);
  assert.equal(chatKind.heads(raw as never).find((x) => x.thing === t)!.head, 2);
});

test("a goal that is not moving says why in words; a moving one has no line", async () => {
  const hn = harness({
    calls: world({
      goals: [
        {
          id: "gol_p",
          title: "Paused one",
          status: "paused",
          leadAgentId: INTAKE,
          updatedAt: 5,
          progress: { tasksDone: 0, tasks: 2 },
        },
        {
          id: "gol_w",
          title: "Waiting one",
          status: "waiting",
          statusReason: "Needs the Q3 numbers",
          leadAgentId: INTAKE,
          updatedAt: 6,
          progress: { tasksDone: 0, tasks: 2 },
        },
        {
          id: "gol_a",
          title: "Moving one",
          status: "active",
          leadAgentId: INTAKE,
          updatedAt: 7,
          progress: { tasksDone: 1, tasks: 2 },
        },
      ],
    }),
  });
  await agentChat(hn);
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  const line = (id: string) => out.goals.rows.find((r: { key: string }) => r.key === `g:${id}`).line;
  assert.equal(line("gol_p"), "Paused");
  assert.equal(line("gol_w"), "Needs the Q3 numbers");
  assert.equal(line("gol_a"), undefined);
  assert.deepEqual(contractErrors("chats.sidebar", "out", out), []);
});

// The review's membership mutants (r-state, 14 Nov): the read is the caller's own, in every filter and on every path a row can take.
const LEO_CTX = (hn: Harness) => hn.person("usr_leo");
const leaveThread = (hn: Harness, thread: string, person: string): void => {
  hn.db.run(
    "UPDATE chat_thread_member SET deleted_at = ? WHERE thread = ? AND principal = ?",
    hn.clock.t,
    thread,
    person,
  );
};
const everyRow = (out: { [k: string]: { rows?: { key: string }[] } }): string[] =>
  ["pinned", "chats", "channels", "team", "goals"].flatMap((s) => (out[s]?.rows ?? []).map((r) => r.key));

test("a person removed from a chat sees it nowhere: not in any filter, not pinned, not muted, no unread, no mention", async () => {
  const o: { stars: unknown[]; mentions: unknown[] } = { stars: [], mentions: [] };
  const hn = harness({ calls: world(o) });
  const kept = await agentChat(hn, "kept");
  const gone = await agentChat(hn, "gone");
  // an unread message from an agent, a pin, a mute and a mention, all on the chat Dana is then removed from
  await h["chat.post"]!(hn.agent(), { threadId: gone, body: "while you were out", idempotencyKey: "gone-1" });
  await h["chat.post"]!(hn.agent(), { threadId: kept, body: "also for you", idempotencyKey: "kept-1" });
  o.stars = [{ resource: { type: "thread", id: gone }, title: "gone", at: 100 }];
  o.mentions = [{ threadId: gone, mentions: 4 }];
  ensureFollowTable(hn.ctx);
  hn.db.run(
    'INSERT INTO chat_thread_follow ("thread", "principal", "mode", "at") VALUES (?, ?, ?, ?)',
    gone,
    DANA,
    "mute",
    1,
  );
  addMember(hn.ctx, kept, "usr_leo"); // a chat with a second person in it: nothing doubles (agents, unread)
  addMember(hn.ctx, gone, "usr_leo");
  addMember(hn.ctx, gone, "usr_eve");
  leaveThread(hn, gone, DANA);
  for (const filter of FILTER_IDS) {
    const out = await h["chats.sidebar"]!(hn.ctx, { filter });
    const text = JSON.stringify(out);
    assert.ok(!text.includes(gone), `${filter}: the chat Dana was removed from is not in the answer`);
    assert.ok(!text.includes("gone"), `${filter}: nor its title`);
  }
  const all = await h["chats.sidebar"]!(hn.ctx, {});
  assert.deepEqual(
    everyRow(all).filter((k) => k.startsWith("c:")),
    [`c:${kept}`],
  );
  assert.equal(all.chats.rows[0].unread, 1, "only the unread of the chat she is still in");
  assert.equal(all.pinned.rows.length, 0, "a pin on a chat she left shows nothing");
  assert.equal(all.rail, 2 + 0, "the two waiting tasks, and the four mentions of a chat she left do not count");
  const faces = all.chats.rows[0].faceIds as string[];
  assert.equal(new Set(faces).size, faces.length, "each face once, however many people are in the chat");
  const unread = await h["chats.sidebar"]!(hn.ctx, { filter: "unread" });
  assert.deepEqual(
    unread.chats.rows.map((r: { key: string }) => r.key),
    [`c:${kept}`],
  );
});

test("a second person's chats are never in Dana's answer, whatever she pinned, muted or was mentioned in", async () => {
  const o: { stars: unknown[]; mentions: unknown[] } = { stars: [], mentions: [] };
  const hn = harness({ calls: world(o) });
  const mine = await agentChat(hn, "mine");
  const leo = await h["chat.start"]!(LEO_CTX(hn), { kind: "chat", agentIds: [INTAKE], idempotencyKey: "leo-1" });
  const theirs = leo.thread.threadId as string;
  await h["chat.post"]!(LEO_CTX(hn), { threadId: theirs, body: "Leo only", idempotencyKey: "leo-2" });
  addMember(LEO_CTX(hn), theirs, "usr_eve");
  o.stars = [{ resource: { type: "thread", id: theirs }, title: "Leo only", at: 9 }];
  o.mentions = [{ threadId: theirs, mentions: 2 }];
  for (const filter of FILTER_IDS) {
    const text = JSON.stringify(await h["chats.sidebar"]!(hn.ctx, { filter }));
    assert.ok(!text.includes(theirs), `${filter}: Leo's chat id is not named to Dana`);
    assert.ok(!text.includes("Leo only"), `${filter}: nor its title`);
  }
  const leos = await h["chats.sidebar"]!(LEO_CTX(hn), {});
  // (the stand-in stars answer is the same for every caller, so the chat Leo owns shows for him as pinned)
  assert.deepEqual(
    everyRow(leos).filter((k) => k.startsWith("c:")),
    [`c:${theirs}`],
  );
  assert.ok(!JSON.stringify(leos).includes(mine));
});

test("a mute is the asker's own: another person's mute of a chat does not mark it muted for Dana", async () => {
  const hn = harness({ calls: world() });
  const a = await agentChat(hn, "a");
  const b = await agentChat(hn, "b");
  ensureFollowTable(hn.ctx);
  hn.db.run(
    'INSERT INTO chat_thread_follow ("thread", "principal", "mode", "at") VALUES (?, ?, ?, ?)',
    a,
    "usr_leo",
    "mute",
    1,
  );
  hn.db.run(
    'INSERT INTO chat_thread_follow ("thread", "principal", "mode", "at") VALUES (?, ?, ?, ?)',
    b,
    DANA,
    "mute",
    1,
  );
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  const row = (id: string) => out.chats.rows.find((r: { key: string }) => r.key === `c:${id}`);
  assert.equal(row(a)?.muted, false, "Leo's mute is not Dana's");
  assert.equal(row(b)?.muted, true);
});

test("without a readable whoami the read fails closed: the caller is treated as a guest", async () => {
  const w = world();
  delete (w as Record<string, unknown>)["identity.whoami"];
  const hn = harness({ calls: w });
  await agentChat(hn);
  hn.callLog.length = 0;
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  assert.equal(out.goals.total, 0);
  assert.equal(out.team.total, 0);
  const asked = hn.callLog.map((c: { cap: string }) => c.cap);
  for (const cap of ["goals.list", "agents.list", "access.principals.list", "projects.list"])
    assert.ok(!asked.includes(cap), cap);
});

test("a paging key that is not one of the caller's chats is no key: the first page again, never the whole list", async () => {
  const hn = harness({ calls: world() });
  for (let i = 0; i < SIDEBAR_PAGE + 5; i++) await agentChat(hn, `chat ${i}`);
  const leo = await h["chat.start"]!(LEO_CTX(hn), { kind: "chat", agentIds: [INTAKE], idempotencyKey: "leo-k" });
  await h["chat.post"]!(LEO_CTX(hn), { threadId: leo.thread.threadId, body: "Leo", idempotencyKey: "leo-k2" });
  const first = await h["chats.sidebar"]!(hn.ctx, {});
  const foreign = await h["chats.sidebar"]!(hn.ctx, { more: { section: "chats", after: `c:${leo.thread.threadId}` } });
  const missing = await h["chats.sidebar"]!(hn.ctx, { more: { section: "chats", after: "c:thr_nobody" } });
  const keys = (o: { chats: { rows: { key: string }[] } }) => o.chats.rows.map((r) => r.key);
  assert.deepEqual(keys(foreign), keys(first));
  assert.deepEqual(keys(missing), keys(first));
});

test("a channel with several people in it counts its unread once, and a channel the caller left is not listed", async () => {
  const hn = harness({ calls: world() });
  const ch = (await h["channels.create"]!(hn.ctx, { name: "ops", visibility: "invite", idempotencyKey: "ch-1" }))
    .channel;
  addMember(hn.ctx, ch.mainThreadId, "usr_leo");
  addMember(hn.ctx, ch.mainThreadId, "usr_eve");
  await h["chat.post"]!(hn.person("usr_leo"), { threadId: ch.mainThreadId, body: "one", idempotencyKey: "ch-p1" });
  await h["chat.post"]!(hn.person("usr_leo"), { threadId: ch.mainThreadId, body: "two", idempotencyKey: "ch-p2" });
  const mine = await h["chats.sidebar"]!(hn.ctx, {});
  const row = mine.channels.rows.find((r: { key: string }) => r.key === `ch:${ch.channelId}`);
  assert.equal(row?.unread, 2, "two messages, counted once however many members");
  leaveThread(hn, ch.mainThreadId, DANA);
  const left = await h["chats.sidebar"]!(hn.ctx, {});
  assert.ok(!JSON.stringify(left).includes(ch.channelId), "a channel she left is nowhere in her answer");
});

test("a goal that waits on the person lives in Tasks, matched by the goal's id: its Goals row carries no second line, and a goal with the same title is not hidden", async () => {
  const w = world({
    goals: [
      {
        id: "gol_s",
        title: "Close onboarding",
        status: "stuck",
        statusReason: "The lead did not check in",
        leadAgentId: INTAKE,
        updatedAt: 5,
        nextCheckinAt: 99,
        progress: { tasksDone: 0, tasks: 2 },
      },
      {
        id: "gol_t",
        title: "Close onboarding",
        status: "stuck",
        statusReason: "Waiting on the legal team",
        leadAgentId: INTAKE,
        updatedAt: 4,
        nextCheckinAt: 98,
        progress: { tasksDone: 0, tasks: 2 },
      },
      {
        id: "gol_p",
        title: "Other goal",
        status: "paused",
        leadAgentId: INTAKE,
        updatedAt: 3,
        progress: { tasksDone: 0, tasks: 2 },
      },
    ],
  });
  (w as Record<string, unknown>)["tasks.needs_you"] = () => ({
    total: 1,
    items: [
      {
        task: {
          id: "tsk_s",
          title: "Stuck: Close onboarding",
          kind: "unblock",
          blocked: true,
          createdBy: INTAKE,
          source: { kind: "goal", id: "gol_s" },
        },
      },
    ],
  });
  const hn = harness({ calls: w });
  await agentChat(hn);
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  const row = (id: string) => out.goals.rows.find((r: { key: string }) => r.key === `g:${id}`);
  assert.equal(row("gol_s").line, undefined);
  assert.equal(row("gol_s").nextCheckinAt, undefined);
  assert.equal(row("gol_t").line, "Waiting on the legal team", "same title, another goal: its line stays");
  assert.equal(row("gol_t").nextCheckinAt, 98);
  assert.equal(row("gol_p").line, "Paused", "a goal not waiting in Tasks keeps its line");
  assert.equal(out.needs.items[0].verb, "Blocked");
});

test("an Unblock task made before tasks named their goal (no source) still hides its goal's line, by its title", async () => {
  const w = world({
    goals: [
      {
        id: "gol_o",
        title: "Close onboarding",
        status: "stuck",
        statusReason: "The lead did not check in",
        leadAgentId: INTAKE,
        updatedAt: 5,
        nextCheckinAt: 99,
        progress: { tasksDone: 0, tasks: 2 },
      },
    ],
  });
  (w as Record<string, unknown>)["tasks.needs_you"] = () => ({
    total: 1,
    items: [
      { task: { id: "tsk_o", title: "Stuck: Close onboarding", kind: "unblock", blocked: true, createdBy: INTAKE } },
    ],
  });
  const hn = harness({ calls: w });
  await agentChat(hn);
  const out = await h["chats.sidebar"]!(hn.ctx, {});
  const row = out.goals.rows.find((r: { key: string }) => r.key === "g:gol_o");
  assert.equal(row.line, undefined);
  assert.equal(row.nextCheckinAt, undefined);
});
