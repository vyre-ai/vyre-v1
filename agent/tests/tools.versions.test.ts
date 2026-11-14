// An agent's write never silently replaces someone else's change (14 Nov 2026, finding F50). The tool layer remembers the version each agent's own last read or write of a file, record or task returned, and sends it
// as the base version when the model did not; a thing never read in the turn is written on the version it had when the turn started. The store here models what the capabilities do: a write on an older version is
// refused, a write with no version is not. Nothing is added to a tool's input, description or result.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { ctx, loadGenerated } from "../src/tools/harness.ts";
import { HostError, makeError } from "../../host/src/routes/errors.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import type { ToolCtx } from "../src/tools/types.ts";
import { modelError } from "../src/tools/model-error.ts";

interface Thing {
  version: number;
  changedAt: number;
  history: Array<{ n: number; at: number }>;
}
function rig() {
  const loaded = loadGenerated();
  const files = new Map<string, Thing>();
  const records = new Map<string, Thing>();
  const tasks = new Map<string, Thing>();
  const pages = new Map<string, Thing>();
  const autos = new Map<string, Thing>();
  const sent: Array<{ cap: string; input: Record<string, unknown> }> = [];
  let clock = 1_000;
  const bump = (m: Map<string, Thing>, id: string): Thing => {
    const cur = m.get(id)!;
    cur.version += 1;
    cur.changedAt = ++clock;
    cur.history.push({ n: cur.version, at: cur.changedAt });
    return cur;
  };
  const make = (m: Map<string, Thing>, id: string, at = 1_000): Thing => {
    const t = { version: 1, changedAt: at, history: [{ n: 1, at }] };
    m.set(id, t);
    return t;
  };
  const conflict = (traceId: string): never => {
    throw new HostError(
      makeError("validation.version_conflict", traceId, { message: "The file changed since it was read." }),
    );
  };
  const invoke: Invoke = async (cap, input, seed) => {
    const traceId = seed.trace?.traceId ?? "trace";
    const i = input as Record<string, unknown>;
    sent.push({ cap, input: i });
    const out = (o: unknown) => ({ status: "ok" as const, output: o, traceId });
    switch (cap) {
      case "files.read":
        return out({
          version: files.get(String(i["fileId"]))!.version,
          text: "x",
          mime: "text/plain",
          size: 1,
          truncated: false,
        });
      case "files.versions":
        return out({
          versions: files
            .get(String(i["fileId"]))!
            .history.map((h) => ({ versionId: `v${h.n}`, n: h.n, by: "x", at: h.at })),
        });
      case "files.write": {
        const f = files.get(String(i["fileId"]))!;
        if (i["baseVersion"] !== undefined && i["baseVersion"] !== f.version) conflict(traceId);
        return out({ file: { fileId: i["fileId"], version: bump(files, String(i["fileId"])).version } });
      }
      case "records.get": {
        const r = records.get(String(i["recordId"]))!;
        return out({ record: { id: i["recordId"], type: i["type"], version: r.version, updatedAt: r.changedAt } });
      }
      case "records.update": {
        const r = records.get(String(i["recordId"]))!;
        if (i["baseVersion"] !== undefined && i["baseVersion"] !== r.version) conflict(traceId);
        return out({
          record: { id: i["recordId"], type: i["type"], version: bump(records, String(i["recordId"])).version },
        });
      }
      case "tasks.get": {
        const t = tasks.get(String(i["taskId"]))!;
        return out({ task: { id: i["taskId"], version: t.version, updatedAt: t.changedAt } });
      }
      case "tasks.update": {
        const t = tasks.get(String(i["taskId"]))!;
        if (i["expectedVersion"] !== undefined && i["expectedVersion"] !== t.version)
          throw new HostError(
            makeError("validation.precondition_failed", traceId, {
              message: "This task changed while you were editing it. Your change was not saved.",
              details: { reason: "stale_version" },
            }),
          );
        return out({ task: { id: i["taskId"], version: bump(tasks, String(i["taskId"])).version } });
      }
      case "memory.page.get":
        return out({
          page: {
            pageId: i["pageId"],
            version: pages.get(String(i["pageId"]))!.version,
            updatedAt: pages.get(String(i["pageId"]))!.changedAt,
          },
        });
      case "memory.page.put": {
        const p = pages.get(String(i["pageId"]))!;
        if (i["baseVersion"] !== undefined && i["baseVersion"] !== p.version) conflict(traceId);
        return out({ page: { pageId: i["pageId"], version: bump(pages, String(i["pageId"])).version } });
      }
      case "automations.get":
        return out({ automation: { id: i["automationId"], version: autos.get(String(i["automationId"]))!.version } });
      case "automations.update": {
        const a = autos.get(String(i["automationId"]))!;
        if (i["expectedVersion"] !== undefined && i["expectedVersion"] !== a.version) conflict(traceId);
        return out({ automation: { id: i["automationId"], version: bump(autos, String(i["automationId"])).version } });
      }
      default:
        return out({});
    }
  };
  const s = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => "manage",
    canEngineer: () => false,
    traceId: () => "trace_fixed",
  });
  s.preload("thr_1", [
    "files_save",
    "tasks_get",
    "files_versions",
    "records_get",
    "memory_write_page",
    "automations_update",
  ]);
  const c = (over: Partial<ToolCtx> = {}): ToolCtx =>
    ctx({ thread: { threadId: "thr_1", kind: "chat", planMode: false }, agentId: "agt_ann", turnId: "trn_1", ...over });
  const lastWrite = (cap: string) => [...sent].reverse().find((x) => x.cap === cap)?.input;
  return { s, c, files, records, tasks, pages, autos, make, bump, sent, lastWrite, tick: () => ++clock };
}
const code = (o: { kind: string; result: { content: unknown } }): string | undefined =>
  ((o.result.content as { error?: { supportCode?: string } }).error ?? {}).supportCode;

test("a file read in this turn is written on the version that read returned, with no version from the model", async () => {
  const r = rig();
  r.make(r.files, "fil_1");
  await r.s.call(r.c(), "files_read", { fileId: "fil_1" });
  const out = await r.s.call(r.c(), "files_write", { fileId: "fil_1", content: { text: "ANN" } });
  assert.equal(out.kind, "result");
  assert.equal(r.lastWrite("files.write")?.["baseVersion"], 1);
});

test("someone changes the file after the agent read it: the agent's write is refused, and a blind retry is refused again until it reads", async () => {
  const r = rig();
  r.make(r.files, "fil_1");
  await r.s.call(r.c(), "files_read", { fileId: "fil_1" });
  r.bump(r.files, "fil_1"); // Bob wrote
  const out = await r.s.call(r.c(), "files_write", { fileId: "fil_1", content: { text: "ANN" } });
  assert.equal(out.kind, "error");
  assert.equal(code(out), "validation.version_conflict");
  assert.equal(r.files.get("fil_1")!.version, 2, "Bob's version is still the current one");
  const again = await r.s.call(r.c(), "files_write", { fileId: "fil_1", content: { text: "ANN" } });
  assert.equal(again.kind, "error", "a retry that did not read is refused too");
  await r.s.call(r.c(), "files_read", { fileId: "fil_1" });
  const ok = await r.s.call(r.c(), "files_write", { fileId: "fil_1", content: { text: "ANN on top of BOB" } });
  assert.equal(ok.kind, "result");
  assert.equal(r.files.get("fil_1")!.version, 3);
});

test("the agent's own write moves what it has seen: two writes in a row need no read between them", async () => {
  const r = rig();
  r.make(r.files, "fil_1");
  await r.s.call(r.c(), "files_read", { fileId: "fil_1" });
  assert.equal((await r.s.call(r.c(), "files_write", { fileId: "fil_1", content: { text: "a" } })).kind, "result");
  assert.equal((await r.s.call(r.c(), "files_write", { fileId: "fil_1", content: { text: "b" } })).kind, "result");
  assert.equal(r.lastWrite("files.write")?.["baseVersion"], 2);
});

test("a version the model sends itself is kept as it is", async () => {
  const r = rig();
  r.make(r.files, "fil_1");
  r.bump(r.files, "fil_1");
  await r.s.call(r.c(), "files_read", { fileId: "fil_1" }); // saw version 2
  const out = await r.s.call(r.c(), "files_write", { fileId: "fil_1", content: { text: "a" }, baseVersion: 1 });
  assert.equal(r.lastWrite("files.write")?.["baseVersion"], 1);
  assert.equal(out.kind, "error", "the model's own stale version is refused, as before");
});

test("a file the agent never read: written on the version it had when the turn started, so a change since then refuses the write", async () => {
  // Bob's change was before the turn began: the agent writes on top of it
  const r = rig();
  r.make(r.files, "fil_1", 1_000);
  r.bump(r.files, "fil_1");
  r.files.get("fil_1")!.history[1]!.at = 2_000;
  const ok = await r.s.call(r.c({ turnStartedAt: 5_000 }), "files_write", { fileId: "fil_1", content: { text: "a" } });
  assert.equal(ok.kind, "result");
  assert.equal(r.lastWrite("files.write")?.["baseVersion"], 2);
  // Bob's change came during the turn and the agent has not read it: refused, sent on the version of the turn's start
  const r2 = rig();
  r2.make(r2.files, "fil_2", 1_000);
  r2.bump(r2.files, "fil_2");
  r2.files.get("fil_2")!.history[1]!.at = 2_000;
  const refused = await r2.s.call(r2.c({ turnStartedAt: 1_500 }), "files_write", {
    fileId: "fil_2",
    content: { text: "a" },
  });
  assert.equal(refused.kind, "error");
  assert.equal(code(refused), "validation.version_conflict");
  assert.equal(r2.lastWrite("files.write")?.["baseVersion"], 1);
  assert.equal(r2.files.get("fil_2")!.version, 2, "Bob's version stands");
});

test("a file never read, no turn start known (a CLI engine): written on the version it has now, so the window of a race is closed", async () => {
  const r = rig();
  r.make(r.files, "fil_1");
  const out = await r.s.call(r.c({ turnId: undefined as never }), "files_write", {
    fileId: "fil_1",
    content: { text: "a" },
  });
  assert.equal(out.kind, "result");
  assert.equal(r.lastWrite("files.write")?.["baseVersion"], 1);
});

test("a new turn forgets what the last turn saw: a thing the agent read last turn is written on the version at this turn's start", async () => {
  const r = rig();
  r.make(r.files, "fil_1", 1_000);
  await r.s.call(r.c({ turnId: "trn_1" }), "files_read", { fileId: "fil_1" });
  r.bump(r.files, "fil_1"); // someone, between the turns, at 1001
  const out = await r.s.call(r.c({ turnId: "trn_2", turnStartedAt: 5_000 }), "files_write", {
    fileId: "fil_1",
    content: { text: "a" },
  });
  assert.equal(out.kind, "result");
  assert.equal(r.lastWrite("files.write")?.["baseVersion"], 2);
});

test("a record and a task read in the turn carry their version; a change since refuses with the words for the thing", async () => {
  const r = rig();
  r.make(r.records, "rec_1");
  r.make(r.tasks, "tsk_1");
  await r.s.call(r.c(), "records_get", { type: "contact", recordId: "rec_1" });
  await r.s.call(r.c(), "tasks_get", { taskId: "tsk_1" });
  r.bump(r.records, "rec_1");
  r.bump(r.tasks, "tsk_1");
  const a = await r.s.call(r.c(), "records_update", { type: "contact", recordId: "rec_1", patch: { name: "x" } });
  const b = await r.s.call(r.c(), "tasks_update", { taskId: "tsk_1", summary: "x" });
  assert.equal(a.kind, "error");
  assert.equal(b.kind, "error");
  assert.equal(r.lastWrite("records.update")?.["baseVersion"], 1);
  assert.equal(r.lastWrite("tasks.update")?.["expectedVersion"], 1);
  const say = (o: { result: { content: unknown } }) => (o.result.content as { error: { say: string } }).error.say;
  assert.match(say(a), /changed after you last read it/);
  assert.match(say(b), /changed while you were editing it/, "a task keeps its own good sentence");
  assert.match(say(b), /Read it again/);
});

test("a record or task never read that changed after the turn began is refused by the tool layer in one plain sentence; one that did not is written on", async () => {
  const r = rig();
  r.make(r.records, "rec_1", 1_000);
  r.make(r.tasks, "tsk_1", 3_000); // changed after the turn began at 2000
  const quiet = await r.s.call(r.c({ turnStartedAt: 2_000 }), "records_update", {
    type: "contact",
    recordId: "rec_1",
    patch: { a: 1 },
  });
  assert.equal(quiet.kind, "result");
  assert.equal(r.lastWrite("records.update")?.["baseVersion"], 1);
  const loud = await r.s.call(r.c({ turnStartedAt: 2_000 }), "tasks_update", { taskId: "tsk_1", summary: "x" });
  assert.equal(loud.kind, "error");
  assert.equal(code(loud), "validation.version_conflict");
  assert.match((loud.result.content as { error: { say: string } }).error.say, /changed after you started working/);
  assert.equal(r.sent.filter((x) => x.cap === "tasks.update").length, 0, "nothing was sent to the task");
});

test("a memory page and an automation carry their version too, read in the turn or not", async () => {
  const r = rig();
  r.make(r.pages, "pge_1");
  r.make(r.autos, "aut_1");
  r.bump(r.autos, "aut_1");
  const unread = await r.s.call(r.c(), "memory_write_page", { pageId: "pge_1", notes: "ANN" });
  assert.equal(unread.kind, "result");
  assert.equal(r.lastWrite("memory.page.put")?.["baseVersion"], 1);
  r.bump(r.pages, "pge_1"); // Bob
  const stale = await r.s.call(r.c(), "memory_write_page", { pageId: "pge_1", notes: "ANN again" });
  assert.equal(
    stale.kind,
    "error",
    "its own write moved what it saw to 2; Bob made it 3, so the next write is refused",
  );
  await r.s.call(r.c(), "automations_update", { automationId: "aut_1", name: "x" });
  assert.equal(r.lastWrite("automations.update")?.["expectedVersion"], 2);
});

test("something the agent just created needs no version and none is invented; one it did not make is not touched when the version cannot be looked up", async () => {
  const r = rig();
  const out = await r.s.call(r.c(), "files_write", { fileId: "fil_missing", content: { text: "a" } });
  // the look at fil_missing throws in the store (no such file): the write goes on as the model sent it and says what is wrong itself
  assert.ok(out.kind === "result" || out.kind === "error");
  assert.equal(r.lastWrite("files.write")?.["baseVersion"], undefined);
});

test("two agents writing one unread file at the same moment: exactly one lands, the other is refused", async () => {
  const r = rig();
  r.make(r.files, "fil_1", 1_000);
  const turn = { turnStartedAt: 5_000 };
  // the look of each agent comes before either write: both see version 1
  const both = await Promise.all([
    r.s.call(r.c({ agentId: "agt_ann", turnId: "trn_a", ...turn }), "files_write", {
      fileId: "fil_1",
      content: { text: "ANN" },
    }),
    r.s.call(r.c({ agentId: "agt_bob", turnId: "trn_b", ...turn }), "files_write", {
      fileId: "fil_1",
      content: { text: "BOB" },
    }),
  ]);
  assert.deepEqual(both.map((o) => o.kind).sort(), ["error", "result"]);
  assert.equal(r.files.get("fil_1")!.version, 2);
});

test("what the model is shown does not change: a version is never a field a model has to send, and the refusal words carry no id or code", () => {
  const task = modelError({
    code: "validation.precondition_failed",
    message: "This task changed while you were editing it. Your change was not saved.",
    traceId: "t",
    details: { reason: "stale_version" },
  } as never);
  assert.match(task.say, /^This task changed while you were editing it\./);
  assert.match(task.say, /Read it again/);
  const e = modelError({
    code: "validation.version_conflict",
    message: "The file changed since it was read.",
    traceId: "14d3abcd14d3abcd",
    details: { tool: "files_write" },
  } as never);
  assert.match(e.say, /^That changed after you last read it, so your change was not saved\./);
  assert.match(e.say, /Read it again, look at what changed, and make your change on top of what is there now/);
  assert.doesNotMatch(e.say, /validation\.|14d3abcd/);
  const own = modelError({
    code: "validation.version_conflict",
    message:
      "This task changed after you started working, and you have not read it since, so your change was not saved. Read it again and make your change on top of what is there now.",
    traceId: "t",
    details: { reason: "changed_since_turn" },
  } as never);
  assert.match(own.say, /changed after you started working/);
  const rec = modelError({
    code: "validation.version_conflict",
    message: "contact rec_1a2b3c4d5e is at version 3, not 1",
    traceId: "t",
  } as never);
  assert.doesNotMatch(
    rec.say,
    /rec_1a2b|version 3/,
    "a record's own words, with an id and numbers, never reach the model",
  );
  assert.match(rec.say, /changed after you last read it/);
});
