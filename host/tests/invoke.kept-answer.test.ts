// What idempotency keeps for a repeat: a capability marked `rerun` (a pure read of an outside service) keeps nothing and runs again; any other keyed capability keeps its answer, but a big answer (over 64 KB) is
// kept as a compact record of the ids and fields it named, so a retry of an outward write still finds that the first call worked, without a 100 KB row for every call (a firm's sync pages: 34 GB in three weeks).
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { KEPT_ANSWER_MAX, compactAnswer, createInvoke, createRateLimiter, indexCapabilities } from "../src/invoke.ts";
import type { InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const keyed = (name: string, extra: Record<string, unknown> = {}) =>
  ({
    name,
    v: 1,
    summary: "s",
    input: { type: "object" },
    output: { type: "object" },
    errors: [],
    resource: { type: "space" },
    permission: null,
    level: "view",
    risk: "low",
    effects: "outward",
    emits: [],
    idempotency: "key",
    surfaces: {},
    examples: [],
    ...extra,
  }) as unknown as CapabilityDef;

function rig(
  onceCalls: Array<{ cap: string; keep: ((v: unknown) => unknown) | undefined }>,
  ran: string[],
): ReturnType<typeof createInvoke> {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "member", clearance: 2, perms: [], name: "Member" });
  s.putGrant({
    id: "g_m",
    subject_kind: "role",
    subject_id: "member",
    resource_type: "space",
    resource_id: "spc_1",
    level: "view",
  });
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.addPrincipalRole({ holder: "usr_dana", role: "member" });
  const deps: InvokeDeps = {
    caps: indexCapabilities([keyed("example.page", { rerun: true }), keyed("example.write")]),
    validateInput: () => [],
    authorize: (req) => authorize(s, req),
    handler: (cap: string) => async () => {
      ran.push(cap);
      return {
        rows: Array.from({ length: 3000 }, (_, i) => ({
          id: `rec_${String(i).padStart(10, "0")}`,
          name: "x".repeat(40),
        })),
      };
    },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    idem: {
      once: (
        _p: string,
        cap: string,
        _k: string,
        _i: unknown,
        run: () => Promise<unknown>,
        keep?: (v: unknown) => unknown,
      ) => {
        onceCalls.push({ cap, keep });
        return run();
      },
    } as never,
    rate: createRateLimiter(),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    now: () => 1_000,
  } as never;
  return createInvoke(deps);
}

test("a rerun capability keeps nothing and runs again on a repeat of its key; another keyed capability keeps its answer", async () => {
  const onceCalls: Array<{ cap: string; keep: ((v: unknown) => unknown) | undefined }> = [];
  const ran: string[] = [];
  const invoke = rig(onceCalls, ran);
  const as = { space: "spc_1", principal: { kind: "person" as const, id: "usr_dana" } };
  await invoke("example.page", { idempotencyKey: "k1" }, as);
  await invoke("example.page", { idempotencyKey: "k1" }, as);
  assert.deepEqual(ran, ["example.page", "example.page"], "the repeat ran again");
  assert.equal(onceCalls.length, 0, "and nothing was asked of the idempotency store");
  await invoke("example.write", { idempotencyKey: "k2" }, as);
  assert.deepEqual(
    onceCalls.map((c) => c.cap),
    ["example.write"],
    "another keyed capability still keeps its answer",
  );
});

test("a big answer is kept as the ids and fields it named, with a note; a small one is kept whole", () => {
  const small = { status: "ok", output: { id: "rec_0000000001", n: 3 }, traceId: "t" };
  assert.equal(compactAnswer(small), small, "under the cap nothing changes");
  const big = {
    status: "ok",
    output: {
      total: 3000,
      label: "x".repeat(500),
      rows: Array.from({ length: 3000 }, (_, i) => ({
        id: `rec_${String(i).padStart(10, "0")}`,
        body: "y".repeat(40),
      })),
    },
    traceId: "t",
  };
  assert.ok(JSON.stringify(big).length > KEPT_ANSWER_MAX);
  const kept = compactAnswer(big) as {
    status: string;
    traceId: string;
    output: { truncated: boolean; note: string; ids: string[]; fields: Record<string, unknown> };
  };
  assert.equal(kept.status, "ok");
  assert.equal(kept.traceId, "t");
  assert.equal(kept.output.truncated, true);
  assert.match(kept.output.note, /not kept/);
  assert.equal(kept.output.ids.length, 50, "the first fifty ids it named");
  assert.equal(kept.output.ids[0], "rec_0000000000");
  assert.equal(kept.output.fields["total"], 3000);
  assert.equal((kept.output.fields["label"] as string).length, 200, "a long text is cut");
  assert.equal(kept.output.fields["rows"], "3000 items");
  assert.ok(JSON.stringify(kept).length < 4000, "a record, not a copy");
});
