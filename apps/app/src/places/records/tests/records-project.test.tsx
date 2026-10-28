// Records > project page (spec 3.4, 2.12): Overview, Plan, Files and Chat. The overview reads the brief, status update, milestones, late and waiting, people and links; the Plan is the shared
// Plan over the project's tasks, and an edit writes projects.reschedule while a slip asks to move the later tasks or keep their dates; the chat is the project's one channel with an arrow-out mark
// on every thread. Screens render with react-dom/server over react-native-web (ruling 28), where effects do not run, so each tab is rendered with the data the page loads for it and the writes are
// checked through the calls the page makes. Path mapping: the packet names apps/app/tests/records-project*.test.tsx, which lanes-check rejects as outside lane L9d; the lane's tests live beside the screens.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { applyMoves, dragChanges, itemOf, slipText, toDay } from "../../../../../../ui/src/Plan/index.tsx";
import { ChatTab, FilesTab, ImportedHistoryView, OverviewTab, ProjectPage, ProjectPageDataProvider, TAB_SPECS, cascadeWords, dateWords, dueWords, editsBetween, fromIso, isoDay, listProjectImports, planStages, planTasks, whoOf } from "../projectpage/index.ts";
import type { Overview, PlanOut } from "../projectpage/index.ts";
import { SAMPLE_NOW, createSampleProject } from "../projectpage/sample.ts";
import type { SampleProject } from "../projectpage/sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const within = (s: SampleProject, el: ReactNode): string => clean(renderToStaticMarkup(<ProjectPageDataProvider value={s.data}>{el}</ProjectPageDataProvider>));
const has = (s: string, n: string): boolean => s.includes(n);
const at = (s: string, n: string): number => { const i = s.indexOf(n); assert.ok(i >= 0, `expected ${n}`); return i; };
const call = async <T,>(s: SampleProject, cap: string, input: unknown): Promise<T> => (await s.data.call(cap, input)) as T;

test("the page has four tabs in order, and draws its loading frame before the project arrives", () => {
  assert.deepEqual(TAB_SPECS.map((t) => t.title), ["Overview", "Plan", "Files", "Chat"]);
  const out = within(createSampleProject(), <ProjectPage projectId="pj_0" />);
  assert.ok(has(out, 'data-testid="project-loading"') && !has(out, "Rivera engagement"));
});

test("overview: status, lead and due under the name, the strip, the goal and update, the next milestones, what is late or waiting, people and links", async () => {
  const s = createSampleProject();
  const o = await call<Overview>(s, "projects.overview", { projectId: "pj_0" });
  const out = within(s, <OverviewTab o={o} now={SAMPLE_NOW} />);
  assert.ok(has(out, 'data-testid="project-goal"') && has(out, "Sign the engagement letter"));
  assert.ok(has(out, "Drafted by Intake") && has(out, "5 h ago"), "the update says who drafted it");
  assert.ok(has(out, 'data-testid="project-next"') && has(out, "Consult on Tuesday") && has(out, "Kickoff"), "the next milestones");
  assert.ok(has(out, 'data-testid="project-waiting"') && has(out, "Draft the engagement letter"), "waiting on a review");
  assert.ok(has(out, ">Maya Chen<") && has(out, ">Lead<") && has(out, ">Reviewer<") && has(out, ">Agent<") === false, "people with their role");
  assert.ok(has(out, 'data-testid="project-linked"') && has(out, "Elena Rivera"));
  assert.ok(has(out, 'data-testid="project-pinned"') && has(out, "Consult fee.md"), "pinned files by name");
  assert.ok(at(out, 'data-testid="project-next"') < at(out, 'data-testid="project-people"'));
  assert.equal(o.project.openTasks, 6);
  assert.equal(o.project.lateTasks, 0);
});

test("the words: due, dates and the Plan's people", () => {
  assert.equal(dueWords(SAMPLE_NOW + 5 * 86_400_000, SAMPLE_NOW), "Due in 5 days");
  assert.equal(dueWords(SAMPLE_NOW, SAMPLE_NOW), "Due today");
  assert.equal(dueWords(SAMPLE_NOW - 3 * 86_400_000, SAMPLE_NOW), "3 days late");
  assert.equal(dueWords(undefined, SAMPLE_NOW), "No due date");
  assert.equal(dateWords(Date.UTC(2025, 9, 24)), "Oct 24");
  assert.deepEqual(whoOf("agt_docs", (id) => id), { name: "agt_docs", kind: "agent" });
  assert.equal(whoOf(undefined, (id) => id), null);
  assert.equal(isoDay(fromIso("2025-10-24")), "2025-10-24");
  assert.equal(cascadeWords({ moves: [1, 2, 3], holds: [{ reason: "pinned" }], summary: "" }), "3 later tasks move, 1 still holds");
});

test("plan: the project's stages and tasks become the Plan's, with dependencies, people and review rings", async () => {
  const s = createSampleProject();
  const plan = await call<PlanOut>(s, "projects.plan", { projectId: "pj_0" });
  const stages = planStages(plan);
  const tasks = planTasks(plan, s.data.nameOf);
  assert.deepEqual(stages.map((x) => x.name), ["Intake", "Draft", "Review", "Deliver"]);
  assert.equal(tasks.length, 8);
  const consult = tasks.find((t) => t.id === "t5")!;
  assert.equal(consult.kind, "milestone");
  assert.equal(consult.end, undefined);
  assert.deepEqual(tasks.find((t) => t.id === "t3")!.deps, ["t2"]);
  assert.equal(tasks.find((t) => t.id === "t3")!.status, "doing");
  assert.equal(tasks.find((t) => t.id === "t3")!.reviewer?.name, "Maya Chen");
  assert.equal(tasks.find((t) => t.id === "t1")!.status, "done");
});

test("a plan edit shows the cascade proposal: moving a bar later says which later tasks move, and the edit is one reschedule", async () => {
  const s = createSampleProject();
  const plan = await call<PlanOut>(s, "projects.plan", { projectId: "pj_0" });
  const before = planTasks(plan, s.data.nameOf);
  const items = before.map(itemOf);
  const t3 = items.find((i) => i.id === "t3")!;
  const move = applyMoves(items, dragChanges(items, "resize-end", "t3", ["t3"], 2), () => "slip1");
  assert.ok(move !== null && move.slip !== null, "a slip waits for apply or keep");
  const words = slipText(move.items, move.slip!);
  assert.match(words.title, /slipped 2 days/);
  assert.match(words.body, /later/, "it names the later tasks that move");
  assert.ok(move.slip!.moves.length >= 1);
  assert.equal(move.items.find((i) => i.id === "t3")!.e, t3.e + 2);
  const after = before.map((t) => (t.id === "t3" ? { ...t, end: isoDay(fromIso(t.end!) + 2 * 86_400_000) } : t));
  const edits = editsBetween(before, after);
  assert.deepEqual(edits.map((e) => e.taskId), ["t3"]);
  assert.equal(edits[0]!.due, fromIso(after.find((t) => t.id === "t3")!.end!));
  assert.equal(edits[0]!.start, undefined, "the start did not move");
  await call(s, "projects.reschedule", { projectId: "pj_0", taskId: "t3", due: edits[0]!.due });
  const again = await call<PlanOut>(s, "projects.plan", { projectId: "pj_0" });
  assert.equal(again.tasks.find((t) => t.taskId === "t3")!.due, edits[0]!.due);
  void toDay;
});

test("an agent's cascade proposal is applied or kept as one call, and keeping moves nothing", async () => {
  const s = createSampleProject();
  const c = await call<{ proposalId: string; moves: unknown[]; holds: { reason: string }[]; summary: string }>(s, "projects.cascade", { projectId: "pj_0", taskId: "t3", due: SAMPLE_NOW + 4 * 86_400_000 });
  assert.match(c.summary, /later tasks move, the Tuesday consult still holds/);
  assert.match(c.holds[0]!.reason, /pinned/);
  const t4Before = s.rows.find((r) => r.taskId === "t4")!.start;
  assert.deepEqual(await call(s, "projects.apply_cascade", { projectId: "pj_0", proposalId: c.proposalId, decision: "keep", idempotencyKey: "k1" }), { moved: 0 });
  assert.equal(s.rows.find((r) => r.taskId === "t4")!.start, t4Before, "keep leaves the dates");
  const c2 = await call<{ proposalId: string; moves: unknown[] }>(s, "projects.cascade", { projectId: "pj_0", taskId: "t3", due: SAMPLE_NOW + 4 * 86_400_000 });
  const out = await call<{ moved: number }>(s, "projects.apply_cascade", { projectId: "pj_0", proposalId: c2.proposalId, decision: "apply", idempotencyKey: "k2" });
  assert.equal(out.moved, c2.moves.length);
  assert.notEqual(s.rows.find((r) => r.taskId === "t4")!.start, t4Before, "apply moves them");
  await assert.rejects(() => call(s, "projects.apply_cascade", { projectId: "pj_0", proposalId: "gone", decision: "apply", idempotencyKey: "k3" }), /gone/);
});

test("chat is the project channel: one chat, every thread with its arrow-out mark", async () => {
  const s = createSampleProject();
  const o = await call<Overview>(s, "projects.overview", { projectId: "pj_0" });
  const out = within(s, <ChatTab o={o} channelName="#rivera-engagement" now={SAMPLE_NOW} />);
  assert.ok(has(out, 'data-testid="project-chat-is-channel"') && has(out, "#rivera-engagement") && has(out, "so everything said here is said there"));
  assert.ok(has(out, "Engagement letter wording") && has(out, "Retainer amount"));
  for (const t of ["thr_letter", "thr_billing"]) assert.ok(has(out, `data-testid="arrow-out-${t}"`), `arrow-out on ${t}`);
  assert.ok(has(out, "Open #rivera-engagement in Chats"));
  s.data.nav.openThread("thr_letter");
  s.data.nav.openChannel("chn_rivera");
  assert.deepEqual(s.opened, ["thread:thr_letter", "channel:chn_rivera"]);
});

test("imported coding history is discoverable inside its Project and never leaks another Project", async () => {
  const calls: unknown[] = [];
  const pages = [
    { sessions: [
      { conversationId: "isc_here", provider: "codex" as const, sourceKey: "codex:1", sourceSessionId: "1", title: "Fix the release", startedAt: SAMPLE_NOW - 2_000, importedAt: SAMPLE_NOW - 1_000, projectId: "pj_0" },
      { conversationId: "isc_other", provider: "claude_code" as const, sourceKey: "claude:2", sourceSessionId: "2", title: "Other repo", startedAt: SAMPLE_NOW - 3_000, importedAt: SAMPLE_NOW - 900, projectId: "pj_other" },
    ], next: "2" },
    { sessions: [{ conversationId: "isc_live", provider: "claude_code" as const, sourceKey: "claude:3", sourceSessionId: "3", title: "Ship the app", startedAt: SAMPLE_NOW - 4_000, importedAt: SAMPLE_NOW - 800, projectId: "pj_0", continuedThreadId: "thr_live" }] },
  ];
  const rows = await listProjectImports(async (cap, input) => { calls.push({ cap, input }); return pages.shift()!; }, "pj_0");
  assert.deepEqual(rows.map((x) => x.conversationId), ["isc_here", "isc_live"]);
  assert.deepEqual(calls, [{ cap: "sessions.list", input: { limit: 100 } }, { cap: "sessions.list", input: { limit: 100, cursor: "2" } }]);

  const s = createSampleProject();
  const html = within(s, <ImportedHistoryView archives={rows} now={SAMPLE_NOW} busy={false} error="" onRead={() => undefined} onRetry={() => undefined} onContinue={() => undefined} onOpenThread={s.data.nav.openThread} />);
  assert.match(html, /Imported coding history/);
  assert.match(html, /Fix the release/);
  assert.match(html, /Codex/);
  assert.match(html, /Ship the app/);
  assert.match(html, /Claude Code/);
  assert.match(html, /Open continued chat/);
  assert.doesNotMatch(html, /Other repo/);

  const transcript = within(s, <ImportedHistoryView archives={rows} transcript={{ session: rows[0]!, messages: [{ sourceMessageId: "m1", role: "user", text: "Please fix the release gate", at: SAMPLE_NOW - 2_000 }] }} now={SAMPLE_NOW} busy={false} error="" onRead={() => undefined} onRetry={() => undefined} onContinue={() => undefined} onOpenThread={s.data.nav.openThread} />);
  assert.match(transcript, /Please fix the release gate/);
  assert.match(transcript, /Continue with your assistant/);
  assert.match(transcript, /Close archive/);
});

test("files: the folder opens in Files, and pinned files open in the viewer", async () => {
  const s = createSampleProject();
  const o = await call<Overview>(s, "projects.overview", { projectId: "pj_0" });
  const out = within(s, <FilesTab o={o} />);
  assert.ok(has(out, 'data-testid="project-open-folder"') && has(out, "Consult fee.md") && has(out, "Offer.png"));
  s.data.nav.openFolder(o.project.folderId);
  s.data.nav.openFile("f_note");
  assert.deepEqual(s.opened, ["folder:fld_rivera", "file:f_note"]);
  const none = within(s, <FilesTab o={{ ...o, pinnedFiles: [] }} />);
  assert.ok(has(none, 'data-testid="project-no-pins"'));
});

test("a missing project says so, and no copy on these screens uses an em dash", async () => {
  const s = createSampleProject();
  await assert.rejects(() => call(s, "projects.reschedule", { projectId: "pj_0", taskId: "nope" }), /No such task/);
  const o = await call<Overview>(s, "projects.overview", { projectId: "pj_0" });
  const all = [within(s, <OverviewTab o={o} now={SAMPLE_NOW} />), within(s, <ChatTab o={o} channelName="#x" now={SAMPLE_NOW} />), within(s, <FilesTab o={o} />)].join("\n");
  assert.ok(!has(all, String.fromCharCode(0x2014)));
});
