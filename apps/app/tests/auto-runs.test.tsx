// Runs screens (spec 2.13, 3.7; ARCH 7.7): run history, the run chat (one chat per run) and Failed runs, built from the Northwind sample (the prototype's "New lead follow-up" runs) through
// the live screen queries. The thread shows agent turns and compact plain-step rows; Undo this run previews, then calls runs.undo; a retried run leaves Needs attention. Screens render
// with react-dom/server over react-native-web (ruling 28); controls are checked by the calls they make, because a static render has no clicks.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RunsDataProvider } from "../src/places/automations/runs/data.tsx";
import { decideTask, postToRun, previewUndo, runMenu, undoRun } from "../src/places/automations/runs/actions.tsx";
import type { RunActions } from "../src/places/automations/runs/actions.tsx";
import { FailedRuns } from "../src/places/automations/runs/FailedRuns.tsx";
import { RunChat } from "../src/places/automations/runs/RunChat.tsx";
import { RunHistory } from "../src/places/automations/runs/RunHistory.tsx";
import { UndoPanel } from "../src/places/automations/runs/RunUndo.tsx";
import { createSampleRuns, harbor, northwind, SAMPLE_NOW } from "../src/places/automations/runs/sample.ts";
import type { SampleRuns } from "../src/places/automations/runs/sample.ts";
import type { ReactNode } from "react";
import type { Run, RunStep, ThreadMessage } from "../src/places/automations/runs/model.ts";
import { buildLines, daySections, failedAcross, failedStep, filterCount, handledIds, matchesFilter, metaLine, needsAttention, rowTime, stamp } from "../src/places/automations/runs/model.ts";

const page = (s: SampleRuns, el: ReactNode): string => renderToStaticMarkup(<RunsDataProvider value={s.data}>{el}</RunsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const runsOf = (s: SampleRuns): Run[] => s.replica.rows("runs") as unknown as Run[];
const runOf = (s: SampleRuns, id: string): Run => runsOf(s).find((r) => r.id === id)!;
const history = (s: SampleRuns, props: Partial<Parameters<typeof RunHistory>[0]> = {}): string =>
  page(s, <RunHistory subject={{ type: "automation", id: "aut_lead" }} currentVersion={5} {...props} />);
const mk = (o: Partial<Run> & { id: string }): Run => ({ kind: "automation", owner: "usr_a", startedBy: "usr_a", status: "succeeded", costMicros: 0, startedAt: SAMPLE_NOW, traceId: `tr_${o.id}`, ...o });
const msg = (o: Partial<ThreadMessage> & { messageId: string; threadSeq: number }): ThreadMessage => ({
  threadId: "thr", author: { kind: "service", id: "svc" }, kind: "system", body: "", blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: SAMPLE_NOW, ...o,
});
const blk = (type: string, data: Record<string, unknown>): ThreadMessage["blocks"][number] => ({ type, v: 1, id: `b_${type}`, data, traceId: "t" });

test("a failed run nobody retried needs attention; a retry is a new run that points back and clears it", () => {
  const failed = mk({ id: "a", status: "failed" });
  const retry = mk({ id: "b", status: "running", parentRun: "a" });
  assert.deepEqual([...handledIds([failed, retry])], ["a"]);
  assert.ok(needsAttention(failed, handledIds([failed])) === true);
  assert.ok(needsAttention(failed, handledIds([failed, retry])) === false);
  assert.ok(!needsAttention(mk({ id: "c" }), new Set()), "a succeeded run never needs attention");
  assert.deepEqual(failedAcross([failed, retry, mk({ id: "d", status: "failed", subject: { type: "automation", id: "x" } })]).rows.map((r) => r.id), ["d"], "the retried one is gone");
});

test("filters: a status filter keeps that status, Tests keeps test runs, counts follow", () => {
  const runs = [mk({ id: "1", status: "failed" }), mk({ id: "2" }), mk({ id: "3", kind: "automation_test" }), mk({ id: "4", status: "waiting", waitReason: "approval" })];
  assert.deepEqual(runs.filter((r) => matchesFilter(r, "failed")).map((r) => r.id), ["1"]);
  assert.deepEqual(runs.filter((r) => matchesFilter(r, "test")).map((r) => r.id), ["3"]);
  assert.deepEqual(runs.filter((r) => matchesFilter(r, "all")).length, 4);
  assert.equal(filterCount(runs, "succeeded"), 2);
  assert.equal(filterCount(runs, "waiting"), 1);
});

test("the line under a run says what it is doing, why it failed, or how it went", () => {
  assert.equal(metaLine(mk({ id: "q", status: "queued" })), "Queued, starts when a slot is free");
  assert.equal(metaLine(mk({ id: "w", status: "waiting", waitReason: "approval" })), "Waiting for a yes");
  assert.equal(metaLine(mk({ id: "w", status: "waiting", waitReason: "key" })), "Waiting for a key");
  assert.equal(metaLine(mk({ id: "w", status: "waiting", waitReason: "background" })), "Waiting on background work");
  assert.equal(metaLine(mk({ id: "r", status: "running" })), "Running");
  assert.equal(metaLine(mk({ id: "f", status: "failed", summary: "No Twilio key" })), "No Twilio key");
  assert.equal(metaLine(mk({ id: "f", status: "failed" })), "Failed");
  assert.equal(metaLine(mk({ id: "s", status: "stopped" })), "Stopped");
  assert.equal(metaLine(mk({ id: "ok", startedAt: 1000, endedAt: 42_000 })), "Succeeded, 41 s");
  assert.equal(metaLine(mk({ id: "ok", summary: "Succeeded, 6 steps, 41 s" })), "Succeeded, 6 steps, 41 s");
});

test("times: the clock today and yesterday, the weekday before that; sections are Today, Yesterday, Earlier, newest first", () => {
  const day = 86_400_000;
  assert.equal(rowTime(SAMPLE_NOW - 33 * 60_000, SAMPLE_NOW), "08:41");
  assert.match(rowTime(SAMPLE_NOW - 2 * day, SAMPLE_NOW), /^[A-Z][a-z]{2} \d\d:\d\d$/);
  assert.equal(stamp(SAMPLE_NOW - 33 * 60_000, SAMPLE_NOW), "Today 08:41");
  assert.equal(stamp(SAMPLE_NOW - day, SAMPLE_NOW), "Yesterday 09:14");
  const secs = daySections([mk({ id: "old", startedAt: SAMPLE_NOW - 5 * day }), mk({ id: "t1", startedAt: SAMPLE_NOW - 60_000 }), mk({ id: "y", startedAt: SAMPLE_NOW - day }), mk({ id: "t2", startedAt: SAMPLE_NOW - 120_000 })], SAMPLE_NOW);
  assert.deepEqual(secs.map((x) => [x.group, x.runs.map((r) => r.id)]), [["Today", ["t1", "t2"]], ["Yesterday", ["y"]], ["Earlier", ["old"]]]);
});

test("the thread becomes lines: rows stay compact, an agent step is a turn, a side thread groups its messages, an error row keeps its step", () => {
  const run = mk({ id: "r", status: "failed", startedAt: SAMPLE_NOW });
  const lines = buildLines(run, [
    msg({ messageId: "m3", threadSeq: 3, kind: "agent", author: { kind: "agent", id: "agt" }, body: "Draft ready", blocks: [blk("run.turn", { title: "Draft", thought: { secs: 4, text: "Think" }, did: ["Read"], skipped: ["Price"], key: "K", model: "M" })] }),
    msg({ messageId: "m1", threadSeq: 1, body: "Started", createdAt: SAMPLE_NOW, blocks: [blk("run.row", { icon: "bolt", tone: "muted" })] }),
    msg({ messageId: "m2", threadSeq: 2, body: "Found 1", createdAt: SAMPLE_NOW + 2000 }),
    msg({ messageId: "m4", threadSeq: 4, body: "Email branch", depth: 1, blocks: [blk("run.branch", { label: "Email" })] }),
    msg({ messageId: "m5", threadSeq: 5, body: "Sent", depth: 1 }),
    msg({ messageId: "m6", threadSeq: 6, body: "No key", createdAt: SAMPLE_NOW + 9000, blocks: [blk("run.error", { detail: "Needs a key", retry: "Try 3 of 3, failed.", step: "text" })] }),
  ], []);
  assert.deepEqual(lines.map((l) => l.kind), ["row", "row", "turn", "branch", "error"], "sorted by sequence");
  const row = lines[1];
  assert.ok(row?.kind === "row" && row.offset === 2 && row.tone === "ok");
  const turn = lines[2];
  assert.ok(turn?.kind === "turn" && turn.step === "Draft" && turn.thought?.secs === 4 && turn.did[0] === "Read" && turn.skipped[0] === "Price" && turn.key === "K" && turn.model === "M");
  const branch = lines[3];
  assert.ok(branch?.kind === "branch" && branch.label === "Email" && branch.lines.length === 2);
  const err = lines[4];
  assert.ok(err?.kind === "error" && err.step === "text" && err.offset === 9);
  assert.equal(failedStep(lines, []), "text");
});

test("a failed run whose thread has no error row gets one from the step log", () => {
  const steps: RunStep[] = [{ step: "a", attempt: 1, state: "succeeded" }, { step: "b", attempt: 3, state: "failed", error: { code: "x", message: "Refused" } }];
  const lines = buildLines(mk({ id: "r", status: "failed" }), [], steps);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.kind === "error" && lines[0].text === "Refused" && lines[0].step === "b");
  assert.equal(buildLines(mk({ id: "r", status: "succeeded" }), [], steps).length, 0, "only a failed run");
  assert.equal(failedStep([], steps), "b");
});

test("history: Needs attention comes first with the failed run and its two buttons, then Yesterday and Earlier, newest first", () => {
  const out = history(createSampleRuns(northwind));
  assert.ok(has(out, 'data-testid="run-history"') && has(out, ">Runs<"));
  const order = ["Needs attention", "Yesterday", "Earlier"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "section order");
  assert.ok(!has(out, ">Today<"), "the only run today is waiting under Needs attention");
  assert.ok(has(out, 'data-testid="row-attention-rl1"') && has(out, "Elena Rivera arrived from the Meta lead form"));
  assert.ok(has(out, "No Twilio key") && has(out, "33 min ago"));
  assert.ok(has(out, 'data-testid="retry-step-rl1"') && has(out, "Retry step") && has(out, "Copy trace id"));
  const rows = ["rl2", "rl3", "rl4", "rl5", "rl6"].map((id) => at(out, `data-testid="row-run-${id}"`));
  assert.deepEqual([...rows].sort((a, b) => a - b), rows, "newest first");
  assert.ok(has(out, "Succeeded, 6 steps, 41 s"));
  assert.ok(has(out, ">v4<"), "a run on an older version shows it");
  assert.ok(!has(out, ">v5<"), "the current version is not repeated");
  assert.ok(!has(out, "Invoice 1044"), "other Automations' runs stay out");
});

test("history: a status filter says what it shows and how to go back; an empty one says so", () => {
  const s = createSampleRuns(northwind);
  const failed = history(s, { initialFilter: "failed" });
  assert.ok(has(failed, 'data-testid="run-showing"') && has(failed, "failed runs") && has(failed, "Show all"));
  assert.ok(has(failed, 'data-testid="row-run-rl1"') && !has(failed, 'data-testid="row-run-rl2"') && !has(failed, ">Needs attention<"), "a filtered list is plain rows");
  const tests = history(s, { initialFilter: "test" });
  assert.ok(has(tests, "Nothing matches.") && has(tests, "test runs"));
  assert.ok(has(history(s, { subject: { type: "automation", id: "aut_nobody" } }), "No runs yet. Run a test to see one."));
  assert.ok(!has(history(s), 'data-testid="run-showing"'), "no filter, no line");
  assert.match(tag(history(s), "run-filter"), /aria-label="Filter the runs"/);
});

test("history: the selected run uses the quiet selection, a failed run offers Retry, every row is the shared Row with a leading mark", () => {
  const out = history(createSampleRuns(northwind), { selectedRunId: "rl3" });
  assert.match(tag(out, "row-run-rl3"), /aria-selected="true"/);
  assert.match(tag(out, "row-run-rl2"), /aria-selected="false"/);
  assert.ok(has(out, 'data-testid="row-run-rl3-leading"') && has(out, 'data-testid="status-succeeded"'));
  assert.ok(has(out, 'data-testid="status-failed"'));
});

test("the run chat of the failed run: the thread's compact rows, Intake's turn with its thought closed, the retries and the error row with Retry step", () => {
  const out = page(createSampleRuns(northwind), <RunChat runId="rl1" />);
  assert.ok(has(out, 'data-testid="run-chat"') && has(out, "New lead follow-up") && has(out, "Elena Rivera arrived from the Meta lead form"));
  assert.ok(has(out, "Open in Main"));
  assert.ok(has(out, ">Failed<") && has(out, "Today 08:41, 24 s") && has(out, ">v5<"), "state, start, duration and pinned version");
  assert.ok(has(out, "Started by a new lead: Elena Rivera, from the Meta lead form") && has(out, "Found Elena Rivera (1 match)"));
  assert.ok(has(out, ">Intake<") && has(out, "Draft a personal reply from the form answers") && has(out, "Is Tuesday at 10:30"), "the agent step is a real turn");
  assert.ok(has(out, "Thought for 5 s") && !has(out, "A warm, short note that names the bakery"), "the thought is closed");
  assert.ok(has(out, "Read the five form answers") && has(out, "Did not quote a price"), "Did and Skipped");
  assert.ok(has(out, "Ran on Your Claude sign-in, Sonnet 5.5"));
  assert.ok(has(out, "Try 1 of 3, failed. Waited 5 s.") && has(out, "Try 2 of 3, failed. Waited 5 s.") && has(out, "Try 3 of 3, failed."));
  const err = at(out, "No Twilio key");
  assert.ok(err > at(out, "Tried to text"), "the error closes the thread");
  assert.ok(has(out, 'data-testid="retry-step"') && has(out, 'data-testid="retry-start"') && has(out, 'data-testid="copy-trace"') && has(out, 'data-testid="replay"'));
  assert.ok(has(out, "tr_rl1"), "the trace id is on the error row");
  assert.ok(has(out, 'placeholder="Ask about this run, or tell an agent what to do"') && has(out, 'aria-label="Send"'));
  assert.ok(has(out, 'data-testid="undo-run"') && has(out, 'data-testid="replay-run"') && !has(out, 'data-testid="stop-run"'));
});

test("a thought opens on request and shows the agent's reasoning", () => {
  const out = page(createSampleRuns(northwind), <RunChat runId="rl1" openThoughts={["thr_rl1_m3"]} />);
  assert.ok(has(out, "A warm, short note that names the bakery will land better than a template."));
  assert.match(tag(out, "thought-thr_rl1_m3"), /aria-expanded="true"/);
});

test("a succeeded run has no retry buttons; the run waiting on Maya shows the join line, the wait row, Approve and Decline, and Stop", () => {
  const s = createSampleRuns(northwind);
  const ok = page(s, <RunChat runId="rl3" />);
  assert.ok(has(ok, ">Succeeded<") && has(ok, "Priya Nair") && !has(ok, 'data-testid="retry-step"'));
  const wait = page(s, <RunChat runId="ri1" />);
  assert.ok(has(wait, "Waiting for a yes") && has(wait, "Maya Chen joined as Approver") && has(wait, "Waiting for Maya Chen to approve 3 reminders"));
  assert.ok(has(wait, ">Billing<") && has(wait, "Billing writes the reminder"));
  assert.ok(has(wait, 'data-testid="approve"') && has(wait, 'data-testid="decline"') && has(wait, 'data-testid="stop-run"'));
  assert.ok(!has(wait, 'data-testid="undo-run"'), "an active run is stopped, not undone");
  assert.ok(has(page(s, <RunChat runId="rm0" />), 'data-testid="run-working"'), "a running run says it is working");
});

test("in Main the run chat carries the page header and a link to the Automation; a missing run says it is gone", () => {
  const s = createSampleRuns(northwind);
  const wide = page(s, <RunChat runId="rl1" wide />);
  assert.ok(has(wide, "Open the automation") && !has(wide, "Open in Main"));
  assert.ok(has(page(s, <RunChat runId="nope" />), "That run is gone."));
});

test("Undo this run previews first, then calls runs.undo and reports what was reversed and what stayed", async () => {
  const s = createSampleRuns(northwind);
  const preview = await previewUndo(s.data, "rl3");
  assert.deepEqual(preview.undone.map((u) => u.summary), ["Created the lead record for Priya Nair", "Filed the form answers on the record", "Created a task for Omar Haddad"]);
  assert.equal(preview.skipped[0]?.reason, "sent");
  assert.deepEqual(s.calls.map((c) => c.cap), ["runs.preview_undo"], "the preview changes nothing");
  assert.equal(s.replica.rows("undo").length, 1);
  const done = await undoRun(s.data, "rl3");
  assert.deepEqual(s.calls.map((c) => c.cap), ["runs.preview_undo", "runs.undo"]);
  assert.deepEqual(s.calls[1]?.input, { runId: "rl3" });
  assert.equal(done.text, "Undid 3 changes. 1 change could not be undone.");
  assert.equal(s.replica.rows("undo").length, 0, "the writes were reversed");
});

test("the Undo panel lists the changes, the ones that stay and why, and cannot confirm when nothing can be reversed", () => {
  const noop = (): void => undefined;
  const ready = renderToStaticMarkup(<UndoPanel state={{ phase: "ready", preview: { undone: [1, 2, 3, 4, 5, 6].map((n) => ({ eventId: `e${n}`, summary: `Change ${n}` })), skipped: [{ eventId: "s1", summary: "Email to Maya", reason: "sent" }, { eventId: "s2", summary: "Deploy", reason: "deployed" }] } }} onConfirm={noop} onCancel={noop} />);
  assert.ok(has(ready, "Undo what this run changed?") && has(ready, "6 changes will be reversed, 2 cannot be."));
  assert.ok(has(ready, "Change 1") && has(ready, "Change 4") && !has(ready, "Change 5") && has(ready, "and 2 more changes"));
  assert.ok(has(ready, "Email to Maya (already sent, stays)") && has(ready, "Deploy (already deployed, stays)"));
  assert.doesNotMatch(tag(ready, "confirm-undo"), /aria-disabled="true"/);
  const empty = renderToStaticMarkup(<UndoPanel state={{ phase: "ready", preview: { undone: [], skipped: [] } }} onConfirm={noop} onCancel={noop} />);
  assert.ok(has(empty, "This run changed nothing that can be undone."));
  assert.match(tag(empty, "confirm-undo"), /aria-disabled="true"/);
  assert.ok(has(renderToStaticMarkup(<UndoPanel state={{ phase: "loading" }} onConfirm={noop} onCancel={noop} />), "Looking at what this run changed"));
});

test("approve and decline act on the Approve task; the run goes on or stops", async () => {
  const s = createSampleRuns(northwind);
  assert.equal(await decideTask(s.data, "tsk_ri1", "approve"), "Approved. The run goes on.");
  assert.deepEqual(s.calls[0], { cap: "tasks.act", input: { taskId: "tsk_ri1", action: "approve" } });
  assert.equal(runOf(s, "ri1").status, "running");
  const t = createSampleRuns(northwind);
  assert.equal(await decideTask(t.data, "tsk_ri1", "reject"), "Declined. Nothing was sent.");
  assert.equal(runOf(t, "ri1").status, "stopped");
});

test("a message to the run goes into its own thread and shows in the chat; an empty one goes nowhere", async () => {
  const s = createSampleRuns(northwind);
  assert.equal(await postToRun(s.data, { id: "rl1", threadId: "thr_rl1" }, "   ", "1"), false);
  assert.equal(await postToRun(s.data, { id: "rl1" }, "hello", "1"), false, "a run with no thread has nowhere to post");
  assert.equal(s.calls.length, 0);
  assert.equal(await postToRun(s.data, { id: "rl1", threadId: "thr_rl1" }, " Why did it stop? ", "1"), true);
  assert.deepEqual(s.calls[0], { cap: "chat.post", input: { threadId: "thr_rl1", body: "Why did it stop?", idempotencyKey: "run-rl1-1" } });
  const out = page(s, <RunChat runId="rl1" />);
  assert.ok(has(out, "Why did it stop?") && has(out, ">You<"), "it shows as the person's own line");
});

test("retrying a failed run starts a new run that points back; the old one leaves Needs attention and Failed runs", async () => {
  const s = createSampleRuns(northwind);
  assert.ok(has(history(s), 'data-testid="row-attention-rl1"'));
  const out = (await s.data.call("runs.retry", { runId: "rl1", fromStep: "text" })) as { runId: string };
  assert.ok(runOf(s, out.runId).parentRun === "rl1" && runOf(s, out.runId).status === "running");
  const after = history(s);
  assert.ok(!has(after, 'data-testid="row-attention-rl1"') && !has(after, ">Needs attention<"), "handled");
  assert.ok(has(after, `data-testid="row-run-${out.runId}"`) && has(after, `data-testid="row-run-rl1"`), "both runs are in the history");
  const failedPage = page(s, <FailedRuns />);
  assert.ok(!has(failedPage, 'data-testid="row-run-rl1"') && has(failedPage, 'data-testid="row-run-rbig0"'));
});

test("Failed runs lists every failed run across Automations with the Automation's name, newest first", () => {
  const out = page(createSampleRuns(northwind), <FailedRuns />);
  assert.ok(has(out, 'data-testid="failed-runs"') && has(out, ">Failed runs<") && has(out, "2 runs across 2 automations"));
  assert.ok(has(out, "New lead follow-up · Elena Rivera arrived from the Meta lead form") && has(out, "Flag invoices over $5k to me · Invoice 1044, Greene &amp; Co, $7,900"));
  assert.ok(at(out, 'data-testid="row-run-rl1"') < at(out, 'data-testid="row-run-rbig0"'), "the newer failure first");
  assert.ok(has(out, "No Twilio key") && has(out, "The message was refused"));
  assert.ok(!has(out, "Priya Nair"), "succeeded runs stay out");
});

test("Failed runs is empty once everything was retried", async () => {
  const s = createSampleRuns(northwind);
  await s.data.call("runs.retry", { runId: "rl1" });
  await s.data.call("runs.retry", { runId: "rbig0" });
  const out = page(s, <FailedRuns />);
  assert.ok(has(out, "All clear") && has(out, "Nothing failed. A failed run waits here until you retry it.") && has(out, "None"));
});

const quiet = (copy: (t: string, what: string) => void = () => undefined): RunActions => ({ note: null, retry: async () => null, retryStep: async () => null, stop: async () => undefined, replay: async () => undefined, copy, say: () => undefined });
const labelsOf = (s: SampleRuns, r: Run, open: boolean, a: RunActions = quiet()): string[] => runMenu(r, a, s.data.nav, () => undefined, { x: 0, y: 0 }, open).flatMap((e) => ("label" in e ? [e.label] : []));

test("the row menu: open, copy and retry for a failed run nobody retried; Stop only while a run works", () => {
  const s = createSampleRuns(northwind);
  assert.deepEqual(labelsOf(s, runOf(s, "rl1"), true), ["Open to the Side", "Open in Main", "Copy Link", "Copy Trace Id", "Retry"]);
  assert.deepEqual(labelsOf(s, runOf(s, "rl3"), false), ["Open to the Side", "Open in Main", "Copy Link", "Copy Trace Id"]);
  assert.deepEqual(labelsOf(s, runOf(s, "ri1"), false), ["Open to the Side", "Open in Main", "Copy Link", "Copy Trace Id", "Stop"]);
});

test("the row menu does what it says: opens the run to the side or in Main, copies the link and the trace id", () => {
  const s = createSampleRuns(northwind);
  const copied: string[] = [];
  const items = runMenu(runOf(s, "rl3"), quiet((_t, what) => void copied.push(what)), s.data.nav, () => undefined, { x: 0, y: 0 }, false);
  for (const e of items) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(s.opened, ["side:rl3", "run:rl3"]);
  assert.deepEqual(copied, ["the link to this run", "the trace id"]);
});

test("no copy in any run screen uses an em dash, and Harbor Studio draws the same screens over its own runs", () => {
  const n = createSampleRuns(northwind);
  const all = [history(n), page(n, <RunChat runId="rl1" />), page(n, <RunChat runId="ri1" />), page(n, <FailedRuns />)];
  for (const out of all) assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash");
  const h = createSampleRuns(harbor);
  const out = page(h, <RunHistory subject={{ type: "automation", id: "aut_h1" }} currentVersion={2} />);
  assert.ok(has(out, "Moreno brief arrived") && has(out, "Lindqvist brief arrived") && has(out, ">Needs attention<") && !has(out, "Elena Rivera"));
  assert.ok(has(page(h, <RunChat runId="rh3" />), "Brief to project") && has(page(h, <RunChat runId="rh3" />), "The project template is missing"));
});
