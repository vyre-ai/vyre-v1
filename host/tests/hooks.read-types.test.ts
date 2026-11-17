// A consumer reads only the events it handles (17 Nov 2026: a hundred consumers each read the whole backlog of a Space of 77,000 events, page after page, and the server sat at 100% CPU for minutes after a sync).
// The log is asked for its types, and a consumer that has read to the end is recorded at the head, not at the last event it happened to handle.
import test from "node:test";
import assert from "node:assert/strict";
import { createHookRunner } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import type { Invoke } from "../src/invoke.ts";

const events = Array.from({ length: 3000 }, (_, i) => ({
  id: `e${i}`,
  seq: i + 1,
  type: i === 1499 ? "rare.happened" : "common.thing",
  entity: null,
  entity_id: null,
  enc: 0,
  payload: new TextEncoder().encode(i === 1499 ? '{"n":1500}' : "{}"),
  actor: "a",
  trace_id: "t".repeat(32),
  at: 1,
  depth: 0,
  run_id: null,
  device: null,
}));

test("a consumer of a rare event is handed only the log's events of that type, delivers the one, and is recorded at the head", async () => {
  const got: number[] = [];
  const hooks: ModuleHooks[] = [
    {
      module: "m",
      periodic: [],
      consumers: [
        {
          name: "m.rare",
          module: "m",
          on: ["rare.happened"],
          run: (_c: unknown, e: { payload: Record<string, unknown> }) => void got.push(Number(e.payload["n"])),
        },
      ],
    },
  ];
  const cursors = new Map<string, number>();
  const asked: { after?: number; types?: readonly string[] }[] = [];
  let returned = 0;
  let head = 0;
  const holder: { r?: ReturnType<typeof createHookRunner> } = {};
  const invoke = (async (cap: string, input: unknown) => ({
    status: "ok",
    output: await holder.r!.handlers[cap]!({} as never, input as never),
    traceId: "t",
  })) as unknown as Invoke;
  holder.r = createHookRunner({
    space: "spc_t",
    now: () => 1,
    invoke,
    emitsOf: () => [],
    capOf: () => undefined,
    warn: () => undefined,
    hooks,
    db: {
      all: (_sql: string, name?: unknown) => (cursors.has(String(name)) ? [{ seq: cursors.get(String(name)) }] : []),
      run: (sql: string, ...a: unknown[]) => {
        if (sql.startsWith("INSERT")) cursors.set(String(a[0]), Number(a[1]));
        return { changes: 1 };
      },
    },
    log: {
      read: async (q: { after?: number; limit?: number; types?: readonly string[] }) => {
        asked.push(q);
        const page = events
          .filter((e) => e.seq > (q.after ?? 0) && (!q.types || q.types.includes(e.type)))
          .slice(0, q.limit ?? 200);
        returned += page.length;
        return page as never;
      },
      currentHead: async () => ({ seq: head }),
    },
  } as never);
  await holder.r.start();
  cursors.set("m.rare", 0);
  head = events.length;
  await holder.r.pump();
  assert.deepEqual(got, [1500], "the one event is delivered");
  assert.ok(
    asked.every((q) => q.types?.length === 1 && q.types[0] === "rare.happened"),
    "every read names the consumer's type",
  );
  assert.equal(returned, 1, "the log handed back that one event, not 3,000");
  assert.equal(cursors.get("m.rare"), 3000, "the consumer is recorded at the head");
});
