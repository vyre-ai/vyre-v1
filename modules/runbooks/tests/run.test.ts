// runbooks: fenced sh and bash blocks of a markdown file get a Run button, a Runs on target and Run all (spec 2.16, 2.7).
// Block order, stop at the first failure, and every block's output linked to the one terminal session the run used.
// @reads /modules/runbooks/migrations/0001_runbooks.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers, parseBlocks, requestStop } from "../impl.ts";
import { RUNBOOK, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

async function expectCode(code: string, run: () => Promise<unknown>): Promise<VyreErr> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return e;
  }
  return assert.fail(`expected ${code}`);
}

const SERVER = { kind: "server" } as const;

function ready(): { w: World; fileId: string; ids: string[] } {
  const w = world();
  const fileId = w.addFile("deploy.md", RUNBOOK);
  return { w, fileId, ids: parseBlocks(RUNBOOK).blocks.map((b) => b.blockId) };
}

test("blocks come out in file order with language, code, line and title; other fences are not blocks", () => {
  const { title, blocks } = parseBlocks(RUNBOOK);
  assert.equal(title, "Deploy the site");
  assert.deepEqual(blocks.map((b) => [b.index, b.lang, b.code, b.line, b.title]), [
    [0, "bash", "cd site\nnpm run build", 6, "Build"],
    [1, "sh", "curl -fsS localhost/health", 12, "Smoke test"],
    [2, "bash", "./publish.sh", 21, "Publish"],
  ]);
  assert.match(blocks[0]?.blockId ?? "", /^b0_[0-9a-f]{4}$/);
  assert.deepEqual(parseBlocks(RUNBOOK).blocks.map((b) => b.blockId), blocks.map((b) => b.blockId), "ids are stable");
  const edited = parseBlocks(RUNBOOK.replace("npm run build", "npm run build -- --prod")).blocks;
  assert.notEqual(edited[0]?.blockId, blocks[0]?.blockId, "the id follows the code");
  assert.equal(edited[1]?.blockId, blocks[1]?.blockId, "and only that block's");
});

test("fences: tildes, indentation, longer outer fences, unclosed fences, empty blocks and CRLF", () => {
  const text = [
    "~~~bash",
    "echo tilde",
    "~~~",
    "   ```sh",
    "   echo indented",
    "     echo deeper",
    "   ```",
    "````markdown",
    "```bash",
    "echo inside a documentation fence",
    "```",
    "````",
    "```bash",
    "   ",
    "```",
    "```zsh",
    "echo not sh or bash",
    "```",
    "```BASH",
    "echo never closed",
  ].join("\r\n");
  const { blocks } = parseBlocks(text);
  assert.deepEqual(blocks.map((b) => [b.index, b.lang, b.code]), [
    [0, "bash", "echo tilde"],
    [1, "sh", "echo indented\n  echo deeper"],
    [2, "bash", "echo never closed"],
  ]);
  assert.deepEqual(parseBlocks("no fences here\n").blocks, []);
  assert.equal(parseBlocks("```bash\nls\n```\n").title, undefined);
});

test("runbooks.parse gives the blocks, the title and the saved Runs on target", async () => {
  const { w, fileId } = ready();
  const first = await handlers["runbooks.parse"](w.ctx, { fileId });
  assert.equal(first.title, "Deploy the site");
  assert.equal(first.blocks.length, 3);
  assert.equal(first.runsOn, undefined);
  assert.deepEqual(await handlers["runbooks.set_target"](w.ctx, { fileId, target: { kind: "computer", computerId: "cmt_1" } }), { ok: true });
  assert.deepEqual((await handlers["runbooks.parse"](w.ctx, { fileId })).runsOn, { kind: "computer", computerId: "cmt_1" });
  assert.deepEqual(w.events.map((e) => [e.name, e.subject, e.payload]), [["runbook.target_set", `file/${fileId}`, { fileId, target: { kind: "computer", computerId: "cmt_1" } }]]);
  await handlers["runbooks.set_target"](w.ctx, { fileId, target: SERVER });
  assert.deepEqual((await handlers["runbooks.parse"](w.ctx, { fileId })).runsOn, SERVER, "the target is replaced, not added");
  await expectCode("validation.bad_input", () => handlers["runbooks.set_target"](w.ctx, { fileId, target: { kind: "computer" } }));
  const notes = w.addFile("notes.txt", "hello");
  await expectCode("validation.precondition_failed", () => handlers["runbooks.parse"](w.ctx, { fileId: notes }));
  await expectCode("validation.precondition_failed", () => handlers["runbooks.set_target"](w.ctx, { fileId: notes, target: SERVER }));
});

test("Run all runs the blocks in order in one terminal session and links each output to it", async () => {
  const { w, fileId, ids } = ready();
  const out = await handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER });
  assert.match(out.runId, /^run_[0-9a-f]+$/);
  const opens = w.calls.filter((c) => c.cap === "terminal.open_server");
  assert.equal(opens.length, 1, "one session for the run");
  assert.deepEqual(w.ran.map((r) => r.command), ["cd site\nnpm run build", "curl -fsS localhost/health", "./publish.sh"]);
  const terminalId = w.ran[0]?.terminalId;
  assert.ok(terminalId);
  assert.ok(w.ran.every((r) => r.terminalId === terminalId), "every block went to the same session, so a cd or an export carries on");
  assert.equal(w.db.rows("runbooks_run")[0]?.terminal_id, terminalId, "the run keeps the session it used");

  const got = await handlers["runbooks.runs.get"](w.ctx, { runId: out.runId });
  assert.equal(got.run.state, "succeeded");
  assert.equal(got.run.all, true);
  assert.equal(got.run.by, "per_maya");
  assert.equal(got.run.exit, 0);
  assert.deepEqual(got.run.target, SERVER);
  assert.deepEqual(got.run.blocks.map((b) => [b.blockId, b.exit, b.state]), ids.map((id) => [id, 0, "succeeded"]));
  assert.deepEqual(got.output.map((c) => [c.blockId, c.seq, c.stream, c.text]), [
    [ids[0], 1, "stdout", "ok: cd site"], [ids[1], 2, "stdout", "ok: curl -fsS localhost/health"], [ids[2], 3, "stdout", "ok: ./publish.sh"],
  ]);
  assert.equal(got.next, 3);

  assert.deepEqual(w.events.map((e) => e.name), ["runbook.run_started", "runbook.block_finished", "runbook.block_finished", "runbook.block_finished", "runbook.run_finished"]);
  assert.deepEqual(w.events[0]?.payload, { runId: out.runId, fileId, target: SERVER, blocks: 3, all: true, by: "per_maya" });
  assert.deepEqual(w.events.slice(1, 4).map((e) => (e.payload as { blockId: string }).blockId), ids, "block events follow the block order");
  const done = w.events[4]?.payload as Record<string, unknown>;
  assert.deepEqual([done.runId, done.state, done.exit, done.failedBlock], [out.runId, "succeeded", 0, undefined]);
});

test("Run all stops at the first failure: later blocks never start and say so", async () => {
  const { w, fileId, ids } = ready();
  w.edit(fileId, RUNBOOK.replace("curl -fsS localhost/health", "curl -fsS localhost/health && FAIL"));
  const out = await handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER });
  assert.equal(w.ran.length, 2, "the third block was never sent");
  const run = (await handlers["runbooks.runs.get"](w.ctx, { runId: out.runId })).run;
  assert.equal(run.state, "failed");
  assert.equal(run.exit, 2);
  assert.deepEqual(run.blocks.map((b) => [b.blockId.slice(0, 2), b.exit, b.state]), [["b0", 0, "succeeded"], ["b1", 2, "failed"], ["b2", undefined, "stopped"]]);
  assert.equal(w.events.filter((e) => e.name === "runbook.block_finished").length, 2);
  const done = w.events.at(-1)?.payload as Record<string, unknown>;
  assert.equal(done.state, "failed");
  assert.equal(done.exit, 2);
  assert.equal(done.failedBlock, run.blocks[1]?.blockId);
  assert.equal(done.failedBlock === ids[1], false, "the failing block's id is the one of the edited code");
  const failing = (await handlers["runbooks.runs.get"](w.ctx, { runId: out.runId, blockId: run.blocks[1]?.blockId })).output;
  assert.deepEqual(failing.map((c) => [c.stream, c.text]), [["stderr", "boom"]], "output of a failed block is stderr");
});

test("one block runs alone; Run all wins when both are sent; neither is refused; an unknown block is not found", async () => {
  const { w, fileId, ids } = ready();
  const one = await handlers["runbooks.run"](w.ctx, { fileId, blockId: ids[1], target: SERVER });
  assert.deepEqual(w.ran.map((r) => r.command), ["curl -fsS localhost/health"]);
  const run = (await handlers["runbooks.runs.get"](w.ctx, { runId: one.runId })).run;
  assert.equal(run.all, false);
  assert.deepEqual(run.blocks.map((b) => b.blockId), [ids[1]]);
  w.ran.length = 0;
  await handlers["runbooks.run"](w.ctx, { fileId, all: true, blockId: ids[1], target: SERVER });
  assert.equal(w.ran.length, 3);
  await expectCode("validation.bad_input", () => handlers["runbooks.run"](w.ctx, { fileId, target: SERVER }));
  await expectCode("validation.not_found", () => handlers["runbooks.run"](w.ctx, { fileId, blockId: "b9_dead", target: SERVER }));
  const empty = w.addFile("empty.md", "# Nothing to run\n\n```python\nprint(1)\n```\n");
  await expectCode("validation.precondition_failed", () => handlers["runbooks.run"](w.ctx, { fileId: empty, all: true, target: SERVER }));
});

test("a run uses the saved Runs on target, an explicit one overrides it, and with neither the run is refused before any session opens", async () => {
  const { w, fileId } = ready();
  const before = w.calls.length;
  await expectCode("validation.precondition_failed", () => handlers["runbooks.run"](w.ctx, { fileId, all: true }));
  assert.equal(w.calls.slice(before).some((c) => c.cap.startsWith("terminal.")), false);
  assert.equal(w.db.rows("runbooks_run").length, 0);

  await handlers["runbooks.set_target"](w.ctx, { fileId, target: { kind: "computer", computerId: "cmt_7" } });
  const saved = await handlers["runbooks.run"](w.ctx, { fileId, all: true });
  const open = w.calls.find((c) => c.cap === "terminal.open");
  assert.deepEqual(open?.input, { host: "agent_computer", computerId: "cmt_7", name: "Runbook deploy.md" });
  assert.deepEqual((await handlers["runbooks.runs.get"](w.ctx, { runId: saved.runId })).run.target, { kind: "computer", computerId: "cmt_7" });

  const explicit = await handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER });
  assert.deepEqual((await handlers["runbooks.runs.get"](w.ctx, { runId: explicit.runId })).run.target, SERVER);
  assert.equal(w.calls.filter((c) => c.cap === "terminal.open_server").length, 1);
  await expectCode("validation.bad_input", () => handlers["runbooks.run"](w.ctx, { fileId, all: true, target: { kind: "computer" } }));
});

test("what the terminal refuses is not swallowed: a Personal Space has no agent computer, and the server needs server.services", async () => {
  const { w, fileId } = ready();
  w.team = false;
  await expectCode("permission.needs_team", () => handlers["runbooks.run"](w.ctx, { fileId, all: true, target: { kind: "computer", computerId: "cmt_1" } }));
  w.denied.add("server.services");
  await expectCode("permission.role_lacks_permission", () => handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER }));
  assert.equal(w.db.rows("runbooks_run").length, 0, "no run row for a session that never opened");
  assert.equal(w.events.length, 0);
});

test("a block the terminal cannot run at all fails the run with exit -1 and keeps the reason as output", async () => {
  const { w, fileId } = ready();
  w.script = (command) => {
    if (command.startsWith("curl")) throw new VyreErr({ code: "provider.unavailable", message: "The terminal is not reachable.", retryable: true, traceId: "t", next: [] });
    return { exitCode: 0, output: "fine" };
  };
  const out = await handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER });
  const got = await handlers["runbooks.runs.get"](w.ctx, { runId: out.runId });
  assert.equal(got.run.state, "failed");
  assert.equal(got.run.exit, -1);
  assert.deepEqual(got.run.blocks.map((b) => b.state), ["succeeded", "failed", "stopped"]);
  assert.deepEqual(got.output.map((c) => c.text), ["fine", "The terminal is not reachable."]);
  w.script = () => ({ exitCode: null, output: "" });
  const hung = await handlers["runbooks.run"](w.ctx, { fileId, blockId: parseBlocks(RUNBOOK).blocks[0]?.blockId, target: SERVER });
  assert.equal((await handlers["runbooks.runs.get"](w.ctx, { runId: hung.runId })).run.exit, -1, "no exit code counts as a failure");
});

test("Stop: the block in progress is interrupted and the blocks after it do not start", async () => {
  const { w, fileId } = ready();
  const run: Ctx = { ...w.ctx, run: "run_stopme" };
  w.script = async (command, terminalId) => {
    if (command.startsWith("cd")) assert.equal(await requestStop(run, "run_stopme"), true);
    return { exitCode: 0, output: `ran ${terminalId}` };
  };
  const out = await handlers["runbooks.run"](run, { fileId, all: true, target: SERVER });
  assert.equal(out.runId, "run_stopme", "the host's Run id is the run's id");
  assert.equal(w.ran.length, 1);
  assert.ok(w.calls.some((c) => c.cap === "terminal.interrupt"));
  const got = (await handlers["runbooks.runs.get"](w.ctx, { runId: "run_stopme" })).run;
  assert.equal(got.state, "stopped");
  assert.deepEqual(got.blocks.map((b) => b.state), ["succeeded", "stopped", "stopped"]);
  assert.equal(await requestStop(run, "run_stopme"), false, "a finished run cannot be stopped");
});

test("a run uses the version asked for, or the newest", async () => {
  const { w, fileId } = ready();
  const oldVersion = (await w.ctx.call("files.versions", { fileId }) as { versions: { versionId: string }[] }).versions[0]?.versionId as string;
  const newest = w.edit(fileId, "```bash\necho newest\n```\n");
  await handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER, versionId: oldVersion });
  assert.equal(w.ran.length, 3);
  w.ran.length = 0;
  const out = await handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER });
  assert.deepEqual(w.ran.map((r) => r.command), ["echo newest"]);
  assert.equal((await handlers["runbooks.runs.get"](w.ctx, { runId: out.runId })).run.versionId, newest);
  await expectCode("validation.not_found", () => handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER, versionId: "ver_nope" }));
});

test("history: newest first, filtered by state, paged; output is read after a sequence number and by block", async () => {
  const { w, fileId, ids } = ready();
  w.edit(fileId, RUNBOOK);
  const a = await handlers["runbooks.run"](w.ctx, { fileId, all: true, target: SERVER });
  w.script = () => ({ exitCode: 1, output: "no" });
  const b = await handlers["runbooks.run"](w.ctx, { fileId, blockId: ids[0], target: SERVER });
  w.script = () => ({ exitCode: 0, output: "yes" });
  const c = await handlers["runbooks.run"](w.ctx, { fileId, blockId: ids[2], target: SERVER });
  const list = await handlers["runbooks.runs.list"](w.ctx, { fileId });
  assert.deepEqual(list.runs.map((r) => r.runId), [c.runId, b.runId, a.runId]);
  assert.equal(list.total, 3);
  assert.deepEqual((await handlers["runbooks.runs.list"](w.ctx, { fileId, state: "failed" })).runs.map((r) => r.runId), [b.runId]);
  const page = await handlers["runbooks.runs.list"](w.ctx, { fileId, limit: 2 });
  assert.deepEqual([page.runs.length, page.next], [2, "2"]);
  assert.deepEqual((await handlers["runbooks.runs.list"](w.ctx, { fileId, limit: 2, cursor: page.next })).runs.map((r) => r.runId), [a.runId]);
  assert.equal((await handlers["runbooks.runs.list"](w.ctx, { fileId, limit: 1, cursor: "example" })).runs[0]?.runId, c.runId, "a cursor that is not a number starts again from the top");
  assert.deepEqual((await handlers["runbooks.runs.list"](w.ctx, { fileId: "fil_other" })).runs, []);

  const all = await handlers["runbooks.runs.get"](w.ctx, { runId: a.runId });
  const tail = await handlers["runbooks.runs.get"](w.ctx, { runId: a.runId, after: 1 });
  assert.deepEqual(tail.output.map((x) => x.seq), [2, 3]);
  assert.equal(tail.next, 3);
  assert.deepEqual((await handlers["runbooks.runs.get"](w.ctx, { runId: a.runId, blockId: ids[2] })).output.map((x) => x.seq), [3]);
  const none = await handlers["runbooks.runs.get"](w.ctx, { runId: a.runId, after: all.next ?? 0 });
  assert.deepEqual([none.output.length, none.next], [0, undefined]);
  await expectCode("validation.not_found", () => handlers["runbooks.runs.get"](w.ctx, { runId: "run_none" }));
  w.denied.add(fileId);
  await expectCode("permission.not_found", () => handlers["runbooks.runs.get"](w.ctx, { runId: a.runId }));
});

test("runbooks.list finds markdown files with shell blocks in nested folders, with their last run", async () => {
  const { w, fileId } = ready();
  w.folders.set("fld_root", ["fld_ops"]);
  w.folders.set("fld_ops", ["fld_deep"]);
  const ops = w.addFile("rollback.md", "```bash\ngit revert HEAD\n```\n", "fld_ops");
  w.addFile("readme.md", "# Just words\n", "fld_ops");
  w.addFile("script.sh", "echo not markdown", "fld_ops");
  w.addFile("deep.md", "```sh\nls\n```\n```bash\npwd\n```\n", "fld_deep");
  await handlers["runbooks.run"](w.ctx, { fileId: ops, all: true, target: SERVER });
  const all = await handlers["runbooks.list"](w.ctx, {});
  assert.deepEqual(all.runbooks.map((r) => [r.name, r.folderId, r.blocks, r.lastState]), [
    ["deep.md", "fld_deep", 2, undefined], ["deploy.md", "fld_root", 3, undefined], ["rollback.md", "fld_ops", 1, "succeeded"],
  ]);
  assert.equal(all.total, 3);
  assert.equal(typeof all.runbooks[2]?.lastRunAt, "number");
  assert.deepEqual((await handlers["runbooks.list"](w.ctx, { folder: "fld_ops" })).runbooks.map((r) => r.name), ["rollback.md", "deep.md"].sort());
  const page = await handlers["runbooks.list"](w.ctx, { limit: 2 });
  assert.deepEqual([page.runbooks.length, page.next, page.total], [2, "2", 3]);
  assert.equal(all.runbooks.some((r) => r.fileId === fileId), true);
  await expectCode("validation.bad_input", () => handlers["runbooks.list"](w.ctx, { limit: 0 }));
});

test("targets: the server when the caller may use it, and the agent computers with whether they are up", async () => {
  const w = world();
  w.computers = [{ computerId: "cmt_a", agentId: "agt_intake", state: "working" }, { computerId: "cmt_b", agentId: "agt_sales", state: "asleep" }];
  const full = await handlers["runbooks.targets"](w.ctx, {});
  assert.deepEqual(full.targets.map((t) => [t.target, t.online]), [[SERVER, true], [{ kind: "computer", computerId: "cmt_a" }, true], [{ kind: "computer", computerId: "cmt_b" }, false]]);
  w.denied.add("server.services");
  assert.deepEqual((await handlers["runbooks.targets"](w.ctx, {})).targets.map((t) => t.target.kind), ["computer", "computer"], "no server.services, no server target");
  w.team = false;
  assert.deepEqual((await handlers["runbooks.targets"](w.ctx, {})).targets, [], "a Personal Space without server rights has nowhere to run");
  w.denied.delete("server.services");
  assert.deepEqual((await handlers["runbooks.targets"](w.ctx, {})).targets.map((t) => t.name), ["Space server"]);
});
