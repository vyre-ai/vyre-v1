// @tsx
// The screen hooks over what this device kept (r41): a kept answer is drawn at once and read again, a refused one is dropped, and reads warmed ahead of a press never flood the Space.
import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteScreenHooks } from "./remote-hooks.ts";

const micro = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function keptOf(rows: Record<string, unknown>) {
  const wrote: string[] = [];
  const dropped: string[] = [];
  const key = (cap: string, input: Record<string, unknown>): string => `${cap} ${JSON.stringify(input)}`;
  return {
    wrote,
    dropped,
    read: (cap: string, input: Record<string, unknown>) => {
      const k = key(cap, input);
      return k in rows ? { data: rows[k] } : undefined;
    },
    wrote_: wrote,
    wroteFn: (cap: string, input: Record<string, unknown>) => void wrote.push(key(cap, input)),
    drop: (cap: string, input: Record<string, unknown>) => void dropped.push(key(cap, input)),
  };
}

test("a kept answer is the first snapshot, with no loading state, and the server's answer takes its place when it differs", async () => {
  const k = keptOf({ "chats.sidebar {}": { rail: 2 } });
  let answer: unknown = { rail: 3 };
  let reads = 0;
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    read: async () => {
      reads += 1;
      return answer;
    },
    kept: { read: k.read, wrote: k.wroteFn, drop: k.drop },
  });
  const q = hooks.capQuery<{ rail: number }>("chats.sidebar", {});
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { rail: 2 } }, "drawn before anything was asked");
  assert.equal(reads, 0, "nothing is read until something watches it");
  let told = 0;
  q.subscribe(() => void (told += 1));
  assert.equal(reads, 1, "watching it reads it again at once");
  await micro();
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { rail: 3 } });
  assert.equal(told, 1);
  assert.deepEqual(k.wrote, ["chats.sidebar {}"], "the new answer is handed back to be kept");
  // the same answer again changes nothing on screen
  answer = { rail: 3 };
  const before = q.getSnapshot();
  hooks.invalidate({ now: true });
  await micro();
  assert.equal(q.getSnapshot(), before);
  assert.equal(told, 1);
  hooks.close();
});

test("a kept answer the server refuses is not shown a moment longer; one it could not be asked about stays", async () => {
  const k = keptOf({ 'chat.thread {"threadId":"t1"}': { title: "Plans" }, "chats.sidebar {}": { rail: 2 } });
  const refusal = Object.assign(new Error("You cannot open this chat."), { status: 403, code: "access.denied" });
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    read: async (cap) => {
      if (cap === "chat.thread") throw refusal;
      throw new Error("fetch failed");
    },
    kept: { read: k.read, wrote: k.wroteFn, drop: k.drop },
    refused: (e) => (e as { status?: number }).status === 403,
  });
  const gone = hooks.capQuery("chat.thread", { threadId: "t1" });
  const kept = hooks.capQuery("chats.sidebar", {});
  gone.subscribe(() => undefined);
  kept.subscribe(() => undefined);
  await micro();
  const g = gone.getSnapshot();
  assert.equal(g.status, "loading");
  assert.equal((g as { error?: { message: string } }).error?.message, "You cannot open this chat.");
  assert.deepEqual(k.dropped, ['chat.thread {"threadId":"t1"}']);
  // the Space could not be reached: what was kept stays on screen
  assert.deepEqual(kept.getSnapshot(), { status: "ready", data: { rail: 2 } });
  hooks.close();
});

test("an answer that arrives after the session closed is not kept", async () => {
  const k = keptOf({});
  let release!: (v: unknown) => void;
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    read: () => new Promise((r) => (release = r)),
    kept: { read: k.read, wrote: k.wroteFn, drop: k.drop },
  });
  hooks.capQuery("chats.sidebar", {}).subscribe(() => undefined);
  hooks.close();
  release({ rail: 1 });
  await micro();
  assert.deepEqual(k.wrote, []);
});

test("warming is bounded: a few reads at once, a short line, nothing watched or just answered, and never the Vault", async () => {
  let t = 0;
  let inFlight = 0;
  let most = 0;
  const asked: string[] = [];
  const waiting: (() => void)[] = [];
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    now: () => t,
    read: (cap, input) =>
      new Promise((resolve) => {
        asked.push(`${cap} ${String(input["threadId"] ?? "")}`.trim());
        inFlight += 1;
        most = Math.max(most, inFlight);
        waiting.push(() => {
          inFlight -= 1;
          resolve({ ok: true });
        });
      }),
    warmAtOnce: 4,
  });
  // a pointer swept down fifty rows
  for (let i = 0; i < 50; i++) hooks.prefetchCap("chat.thread", { threadId: `t${i}` });
  hooks.prefetchCap("vault.items.list", {});
  hooks.prefetchCap("identity.keys_get", {});
  assert.equal(most, 4, "four at once");
  while (waiting.length > 0) {
    waiting.shift()!();
    await micro();
  }
  assert.ok(asked.length <= 16, `a short line behind the four, the rest are let go (${asked.length} asked)`);
  assert.equal(most, 4);
  assert.ok(
    !asked.some((a) => a.startsWith("vault.") || a.startsWith("identity.")),
    "the Vault and keys are never read ahead",
  );
  // what was just answered is not asked for again; what is being watched is left to the watcher
  const n = asked.length;
  const last = asked[asked.length - 1]!.split(" ")[1]!;
  hooks.prefetchCap("chat.thread", { threadId: last });
  assert.equal(asked.length, n);
  hooks.capQuery("chats.sidebar", {}).subscribe(() => undefined);
  const watched = asked.length;
  hooks.prefetchCap("chats.sidebar", {});
  assert.equal(asked.length, watched);
  // a change in the Space makes the unwatched answer stale; after the quiet time it may be warmed again
  hooks.invalidate();
  hooks.prefetchCap("chat.thread", { threadId: last });
  assert.equal(asked.filter((a) => a === `chat.thread ${last}`).length, 1, "not inside 15 s of its last answer");
  t += 16_000;
  hooks.prefetchCap("chat.thread", { threadId: last });
  assert.equal(asked.filter((a) => a === `chat.thread ${last}`).length, 2);
  hooks.close();
});

test("a place's reads are brought up to date when it is pointed at, and a row warms what the last thing of its kind read", async () => {
  const asked: string[] = [];
  let t = 0;
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    now: () => t,
    read: async (cap, input) => {
      asked.push(`${cap} ${JSON.stringify(input)}`);
      return { cap };
    },
  });
  // Files is on screen and reads its list; then the person goes to Chats
  hooks.scope("files");
  const off = hooks.capQuery("files.list", { folderId: "root" }).subscribe(() => undefined);
  await micro();
  off();
  hooks.scope("chats");
  hooks.invalidate(); // something changed in the Space
  t += 20_000;
  asked.length = 0;
  hooks.warmScope("files");
  await micro();
  assert.deepEqual(asked, ['files.list {"folderId":"root"}']);

  // a chat is pressed: what its page reads is learnt
  hooks.learn("chats:thread", "thr_a");
  hooks.capQuery("chat.messages.list", { threadId: "thr_a" }).subscribe(() => undefined);
  hooks.capQuery("threads.get", { threadId: "thr_a" }).subscribe(() => undefined);
  hooks.capQuery("chats.sidebar", {}).subscribe(() => undefined); // not about the chat: not learnt
  await micro();
  asked.length = 0;
  // the pointer rests on another chat
  hooks.warmLike("chats:thread", "thr_b");
  await micro();
  assert.deepEqual(asked.sort(), ['chat.messages.list {"threadId":"thr_b"}', 'threads.get {"threadId":"thr_b"}']);
  // a kind nothing was learnt for warms nothing
  asked.length = 0;
  hooks.warmLike("files:file", "fil_1");
  await micro();
  assert.deepEqual(asked, []);
  hooks.close();
});
