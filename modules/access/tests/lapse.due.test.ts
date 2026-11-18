// The periodic job that ends exceptions at their end (modules/access/handlers/exceptions.ts lapseDue) reads only what is due. It used to load the whole access store on every run (0.8 s of one stretch of
// work a minute on a firm's Space, 18 Nov 2026) to find that nothing was due. A run with nothing due reads next to no rows however big the Space is, and an exception whose end has come is still removed
// on the first run at or after its end, with the audit row, while one that has not ended stays.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import type { HostDb } from "../../../host/src/daemon/sqlite.ts";
import { migrate } from "../../../host/src/daemon/hosttables.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { hostCalls } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { handlers } from "../handlers/index.ts";
import { lapseDue } from "../handlers/exceptions.ts";
import type { AccessCtx } from "../projections.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SPACE = "spc_lapse";
const TRACE = "0123456789abcdef0123456789abcdef";
const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: LogEvent[] }) => unknown;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const clock = { now: 1_800_000_000_000 };

function fresh(): HostDb {
  const dir = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), "access-lapse-"));
  const raw = openDb(path.join(dir, "modules.db"));
  migrate(raw, ROOT, () => clock.now);
  return raw;
}
const base = (
  raw: HostDb,
  principal: string,
  extra: Record<string, unknown> = {},
): AccessCtx & Record<string, unknown> => ({
  space: SPACE,
  principal: { kind: "person", id: principal },
  trace: { traceId: TRACE },
  now: () => clock.now,
  db: scopedDb("access", raw, TRACE),
  emit: () => undefined,
  origin: "gateway",
  depth: 0,
  call: async () => null,
  log: { warn: () => undefined },
  ...extra,
});
let seq = 0;
const ev = (type: string, payload: unknown): LogEvent => ({ seq: ++seq, type, payload });

function seed(raw: HostDb, resources: number): void {
  seq = 0;
  sync(base(raw, "usr_owner"), {
    events: [
      ev("resource.created", { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 }),
      ...["usr_owner", "usr_mia", "usr_noor"].map((id) =>
        ev("principal.created", { id, kind: "person", name: id.slice(4), status: "active" }),
      ),
      ev("principal.role_set", { holder: "usr_owner", role: "rol_owner" }),
      ev("principal.role_set", { holder: "usr_mia", role: "rol_member" }),
      ev("principal.role_set", { holder: "usr_noor", role: "rol_member" }),
    ],
  });
  for (let at = 0; at < resources; at += 5000)
    sync(base(raw, "usr_owner"), {
      events: Array.from({ length: Math.min(5000, resources - at) }, (_, i) =>
        ev("resource.created", {
          id: `rec_${at + i}`,
          type: "record",
          parent_id: SPACE,
          label: 0,
          owner_id: "usr_owner",
          holds: 0,
        }),
      ),
    });
}

/** A ctx whose reads are counted: every row the job's own queries bring back. */
function counted(raw: HostDb): {
  ctx: AccessCtx & { call(cap: string, input: unknown): Promise<unknown> };
  rows(): number;
  calls: string[];
} {
  const inner = scopedDb("access", raw, TRACE);
  let rows = 0;
  const calls: string[] = [];
  const ctx = {
    ...base(raw, "svc_host"),
    db: {
      all: (sql: string, ...args: unknown[]) => {
        const r = inner.all(sql, ...args) as unknown[];
        rows += r.length;
        return r;
      },
      run: (sql: string, ...args: unknown[]) => inner.run(sql, ...args),
    },
    call: async (cap: string, input: unknown) => {
      calls.push(cap);
      // what the host does for the job: the lapse capability, called by the server
      return (handlers[cap as keyof typeof handlers] as unknown as (c: unknown, i: unknown) => Promise<Any>)(
        base(raw, "svc_host", { origin: "hook" }),
        input,
      );
    },
  } as unknown as AccessCtx & { call(cap: string, input: unknown): Promise<unknown> };
  return { ctx, rows: () => rows, calls };
}
const owner = (raw: HostDb, cap: string, input: unknown): Promise<Any> =>
  (handlers[cap as keyof typeof handlers] as unknown as (c: unknown, i: unknown) => Promise<Any>)(
    base(raw, "usr_owner"),
    input,
  );
const exceptionIds = (raw: HostDb): string[] =>
  (
    raw.all(`SELECT id FROM access_grants WHERE json_extract(conditions, '$.exception') IS NOT NULL ORDER BY id`) as {
      id: string;
    }[]
  ).map((r) => r.id);

test("a run with nothing due reads next to no rows on a big Space", async () => {
  const raw = fresh();
  seed(raw, 30_000);
  await owner(raw, "access.exceptions.set", {
    subject: { kind: "person", id: "usr_mia" },
    perms: ["agents.create"],
    effect: "deny",
    until: clock.now + 3_600_000,
    idempotencyKey: "x1",
  });
  const c = counted(raw);
  assert.deepEqual(await lapseDue(c.ctx), []);
  assert.deepEqual(c.calls, []);
  assert.ok(c.rows() <= 5, `the run read ${c.rows()} rows (the Space holds 30,000 resources)`);
});

test("an exception whose end has come is removed on the first run at or after its end, and one that has not ended stays", async () => {
  const raw = fresh();
  seed(raw, 200);
  const until = clock.now + 600_000;
  await owner(raw, "access.exceptions.set", {
    subject: { kind: "person", id: "usr_mia" },
    perms: ["agents.create"],
    effect: "deny",
    until,
    idempotencyKey: "a",
  });
  await owner(raw, "access.exceptions.set", {
    subject: { kind: "person", id: "usr_noor" },
    perms: ["agents.create"],
    effect: "deny",
    until: until + 3_600_000,
    idempotencyKey: "b",
  });
  await owner(raw, "access.exceptions.set", {
    subject: { kind: "person", id: "usr_noor" },
    perms: ["automations.space"],
    effect: "deny",
    idempotencyKey: "c",
  });
  const [first] = exceptionIds(raw).sort((x, y) => (x < y ? -1 : 1));
  assert.equal(exceptionIds(raw).length, 3);
  const ended = (raw.all(`SELECT id FROM access_grants WHERE "expiresAt" = ?`, until) as { id: string }[])[0]!.id;
  assert.ok(first);
  // one millisecond before its end: nothing
  clock.now = until - 1;
  assert.deepEqual(await lapseDue(counted(raw).ctx), []);
  assert.ok(exceptionIds(raw).includes(ended));
  // at its end: the lapse capability runs for that one exception, and it is gone with its audit row
  clock.now = until;
  const c = counted(raw);
  assert.deepEqual(await lapseDue(c.ctx), [ended]);
  assert.deepEqual(c.calls, ["access.exceptions.lapse"]);
  assert.ok(!exceptionIds(raw).includes(ended), "the ended exception is gone");
  assert.equal(exceptionIds(raw).length, 2, "the one that has not ended and the one with no end stay");
  // and it does not lapse twice
  assert.deepEqual(await lapseDue(counted(raw).ctx), []);
  clock.now = 1_800_000_000_000;
});
