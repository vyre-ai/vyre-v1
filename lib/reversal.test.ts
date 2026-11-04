// lib/reversal.ts: the seam that turns a person's undo of an agent's act into a lesson (memory.corrections.record, how "reverse"). The rules: only a person's own press, only an agent's act (the newest event
// of the types the undo reverses), the lesson reads before the undo runs, one reference per act, a failing memory never holds the undo up.
import test from "node:test";
import assert from "node:assert/strict";
import { agentBehind, withReversals } from "./reversal.ts";
import type { LoggedAct } from "./reversal.ts";

interface Call { cap: string; input: Record<string, unknown> }
function ctxOver(events: LoggedAct[], who: { kind: string; id: string } = { kind: "person", id: "usr_alice" }, opts: { pages?: number; memory?: () => unknown; run?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  const ctx = {
    principal: who, calls,
    async call(cap: string, input: unknown): Promise<unknown> {
      const i = input as Record<string, unknown>;
      calls.push({ cap, input: i });
      if (cap === "events.list") {
        const rows = events.filter((e) => (i["types"] as string[] | undefined)?.includes(e.type) !== false && (i["subject"] === undefined || (e as unknown as { subject: { id: string } }).subject.id === (i["subject"] as { id: string }).id));
        const page = Number(i["cursor"] ?? 0), size = Math.ceil(rows.length / (opts.pages ?? 1)) || 1;
        const out: { events: LoggedAct[]; next?: string } = { events: rows.slice(page * size, page * size + size) };
        if ((page + 1) * size < rows.length) out.next = String(page + 1);
        return out;
      }
      if (cap === "runs.get") return { run: opts.run ?? {} };
      if (cap === "memory.corrections.record") return opts.memory ? opts.memory() : { kept: true };
      throw new Error(`unexpected ${cap}`);
    },
  };
  return ctx;
}
const ev = (seq: number, type: string, actor: string, subject: string, payload: Record<string, unknown> = {}, runId?: string): LoggedAct => ({ seq, id: `evt_${seq}`, type, actor, payload, ...(runId ? { runId } : {}), subject: { type: "file", id: subject } } as unknown as LoggedAct);
const taught = (c: { calls: Call[] }): Record<string, unknown>[] => c.calls.filter((x) => x.cap === "memory.corrections.record").map((x) => x.input);

const TABLE = { "files.restore": { subject: (i: { fileId: string }) => ({ type: "file", id: i.fileId }), types: ["file.deleted"], was: () => "deleted the file Plan.pdf" } };
const restore = (ctx: unknown, _i: unknown): Promise<{ ok: boolean }> => Promise.resolve({ ok: true });

test("bringing back what an agent deleted teaches that agent, as the person, with a reference that makes one lesson per act", async () => {
  const ctx = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1")]);
  const h = withReversals({ "files.restore": restore }, TABLE);
  assert.deepEqual(await h["files.restore"](ctx, { fileId: "fil_1" }), { ok: true });
  assert.deepEqual(taught(ctx), [{ agentId: "agt_bot", how: "reverse", was: "deleted the file Plan.pdf", ref: "reverse:evt_1" }]);
});

test("a person's own deletion, a colleague's, a service's and anyone's act on another thing teach nothing", async () => {
  for (const actor of ["usr_alice", "usr_bob", "svc_host", "act_outside"]) {
    const ctx = ctxOver([ev(1, "file.deleted", actor, "fil_1")]);
    await withReversals({ "files.restore": restore }, TABLE)["files.restore"](ctx, { fileId: "fil_1" });
    assert.equal(taught(ctx).length, 0, actor);
  }
  const other = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_2")]);
  await withReversals({ "files.restore": restore }, TABLE)["files.restore"](other, { fileId: "fil_1" });
  assert.equal(taught(other).length, 0);
});

test("only the newest act counts: an agent's deletion that a person then redid is the person's", async () => {
  const ctx = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1"), ev(2, "file.deleted", "usr_alice", "fil_1")], undefined, { pages: 2 });
  await withReversals({ "files.restore": restore }, TABLE)["files.restore"](ctx, { fileId: "fil_1" });
  assert.equal(taught(ctx).length, 0);
  const ctx2 = ctxOver([ev(1, "file.deleted", "usr_alice", "fil_1"), ev(2, "file.deleted", "agt_bot", "fil_1")], undefined, { pages: 2 });
  await withReversals({ "files.restore": restore }, TABLE)["files.restore"](ctx2, { fileId: "fil_1" });
  assert.equal(taught(ctx2).length, 1, "a long log is read in pages");
});

test("only a person's own press teaches: an agent or a service calling the undo does not", async () => {
  for (const who of [{ kind: "agent", id: "agt_other" }, { kind: "service", id: "svc_host" }]) {
    const ctx = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1")], who);
    await withReversals({ "files.restore": restore }, TABLE)["files.restore"](ctx, { fileId: "fil_1" });
    assert.equal(taught(ctx).length, 0, who.kind);
    assert.equal(ctx.calls.filter((c) => c.cap === "events.list").length, 0, "and it does not even look");
  }
});

test("the act is read before the undo runs, so the undo's own events never change who made it", async () => {
  const log = [ev(1, "file.version_added", "agt_bot", "fil_1")];
  const ctx = ctxOver(log);
  const table = { "files.restore_version": { subject: (i: { fileId: string }) => ({ type: "file", id: i.fileId }), types: ["file.version_added"], was: () => "changed the file Plan.pdf" } };
  const h = withReversals({ "files.restore_version": async () => { log.push(ev(2, "file.version_added", "usr_alice", "fil_1")); return {}; } }, table);
  await h["files.restore_version"](ctx, { fileId: "fil_1" });
  assert.equal(taught(ctx).length, 1);
  assert.equal(taught(ctx)[0]!["ref"], "reverse:evt_1");
});

test("a narrower test on the act: moving back counts only when it puts the file where the agent moved it from", async () => {
  const table = { "files.move": { subject: (i: { fileId: string }) => ({ type: "file", id: i.fileId }), types: ["file.moved"], match: (e: LoggedAct, i: { toFolderId: string }) => e.payload["fromFolderId"] === i.toFolderId, was: () => "moved the file" } };
  const back = ctxOver([ev(1, "file.moved", "agt_bot", "fil_1", { fromFolderId: "fld_a", toFolderId: "fld_b" })]);
  await withReversals({ "files.move": restore }, table)["files.move"](back, { fileId: "fil_1", toFolderId: "fld_a" });
  assert.equal(taught(back).length, 1);
  const elsewhere = ctxOver([ev(1, "file.moved", "agt_bot", "fil_1", { fromFolderId: "fld_a", toFolderId: "fld_b" })]);
  await withReversals({ "files.move": restore }, table)["files.move"](elsewhere, { fileId: "fil_1", toFolderId: "fld_c" });
  assert.equal(taught(elsewhere).length, 0, "moving it somewhere new is not an undo");
});

test("the chat the act happened in goes with the lesson, so a chat other people read keeps nothing without the person's words", async () => {
  const ctx = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1", {}, "run_1")], undefined, { run: { threadId: "thr_9" } });
  await withReversals({ "files.restore": restore }, TABLE)["files.restore"](ctx, { fileId: "fil_1" });
  assert.equal(taught(ctx)[0]!["threadId"], "thr_9");
});

test("a memory that fails, or an undo that fails, is handled: the undo stands, and a failed undo teaches nothing", async () => {
  const down = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1")], undefined, { memory: () => { throw new Error("memory is down"); } });
  assert.deepEqual(await withReversals({ "files.restore": restore }, TABLE)["files.restore"](down, { fileId: "fil_1" }), { ok: true });
  const failing = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1")]);
  await assert.rejects(withReversals({ "files.restore": async () => { throw new Error("name taken"); } }, TABLE)["files.restore"](failing, { fileId: "fil_1" }), /name taken/);
  assert.equal(taught(failing).length, 0);
});

test("a rule with nothing to say teaches nothing; a handler with no rule is untouched; a missing handler is skipped", async () => {
  const ctx = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1")]);
  const h = withReversals({ "files.restore": restore, "files.read": restore }, { "files.restore": { ...TABLE["files.restore"], was: () => null }, "files.nothing": TABLE["files.restore"] });
  await h["files.restore"](ctx, { fileId: "fil_1" });
  await h["files.read"](ctx, {});
  assert.equal(taught(ctx).length, 0);
  assert.equal(Object.keys(h).includes("files.nothing"), false);
});

test("agentBehind says who made the newest act, or nobody", async () => {
  const ctx = ctxOver([ev(1, "file.deleted", "agt_bot", "fil_1")]);
  assert.equal((await agentBehind(ctx, { type: "file", id: "fil_1" }, ["file.deleted"]))?.agentId, "agt_bot");
  assert.equal(await agentBehind(ctx, { type: "file", id: "fil_1" }, ["file.moved"]), null);
});
