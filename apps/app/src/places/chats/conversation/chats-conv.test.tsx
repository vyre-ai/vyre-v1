// Chats conversation (P-L9b_04; mapped from apps/app/tests/chats-conv.test.tsx because lane L9b owns only apps/app/src/places/chats/): the page renders from the kept copy in the order spec 3.2 gives; a send is on the page before chat.post answers; while an agent works a plain send
// queues and Interrupt sends it now; the lead and listening agents show their mode marks; streamed text lands once per frame; the last 50 messages open in under 100 ms.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation, ConversationLoading } from "./Conversation.tsx";
import { HoverBar, MessageView } from "./MessageView.tsx";
import * as act from "./actions.ts";
import {
  WINDOW, beforeCursor, byOrder, dayLabel, faces, lastMessages, leadOf, mentionsIn, mergePages, pendingMessage, queueNote, queuedCount, respondersFor, sendKind, stillPending, stopLabel,
  swapNeeded, timeline, whoLine, workOf, workingAgents, bodyBlocks, findMatches, reportLabel, matchLine, modelLabel, participants, placeholderFor, summarizeOpen, openVerdict, CHAT_OPEN_BUDGET_MS,
} from "./model.ts";
import { changeCount, editedNote, isPlanFile, isProposal, planFileLine, proposalActs, proposalData } from "./proposal.tsx";
import type { Message, Pending, Thread } from "./model.ts";
import { DIRECTORY, SAMPLE_NOW, createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";
import { createStreamStore } from "../../../../../../ui/src/stream/index.ts";

installComposerForTests(Composer);

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample): string => clean(renderToStaticMarkup(<Conversation data={s.data} />));
const has = (s: string, n: string): boolean => s.includes(n);
const at = (s: string, n: string): number => { const i = s.indexOf(n); assert.ok(i >= 0, `expected ${n}`); return i; };
const inOrder = (s: string, needles: string[]): void => { const idx = needles.map((n) => at(s, n)); assert.deepEqual([...idx].sort((a, b) => a - b), idx, needles.join(" > ")); };
const thread = (s: Sample): Thread => (s.data.screens.query("chats.conversation", "thread", { threadId: s.data.threadId }).getSnapshot() as { data: { thread: Thread } }).data.thread;
const msgs = (s: Sample): Message[] => (s.data.screens.query("chats.conversation", "messages", { threadId: s.data.threadId }).getSnapshot() as { data: { messages: Message[] } }).data.messages;
const ctx = (s: Sample) => ({ meId: "usr_irfad", nameOf: s.data.nameOf, kindOf: s.data.kindOf, clock: s.data.clock() });

test("the page reads: header with title and faces, your bubbles, Intake's folded work, cards, the composer line", () => {
  const out = html(createSample("idle"));
  inOrder(out, ['data-testid="conversation-head"', 'data-testid="conversation-title"', 'data-testid="conversation-faces"', "New client: Elena Rivera", "Intake is on it", "Worked for 14s, 3 steps", "Tuesday has two openings", "Book 2pm.", "Worked for 6s, 2 steps", 'data-testid="composer"']);
  assert.ok(has(out, "client-intake.pdf") && has(out, 'data-testid="proposal-b2"'));
  assert.ok(has(out, "Intake will reply") && has(out, "Message Intake…"));
});

test("faces carry mode marks: Intake leads, Docs listens, and each face opens its mode menu", () => {
  const s = createSample("idle");
  const out = html(s);
  assert.ok(has(out, 'data-testid="face-agt_intake"') && has(out, 'data-testid="face-agt_docs"'));
  assert.ok(has(out, "Intake, leads") && has(out, "Docs, listening"));
  assert.deepEqual(faces(thread(s), s.data.nameOf, []).map((f) => [f.name, f.mode]), [["Intake", "lead"], ["Docs", "listen"]]);
  assert.equal(swapNeeded(thread(s), "agt_docs")?.agentId, "agt_intake");
  assert.equal(swapNeeded(thread(s), "agt_intake"), null);
});

test("who will reply comes from the engine's route(): the lead, a mention, a person, or nobody", () => {
  const s = createSample("idle");
  const t = thread(s);
  assert.equal(whoLine(t, s.data.nameOf), "Intake will reply");
  assert.deepEqual(respondersFor(t, [], "usr_irfad"), ["agt_intake"]);
  assert.deepEqual(respondersFor(t, mentionsIn("@Docs check this", DIRECTORY), "usr_irfad"), ["agt_docs"]);
  assert.deepEqual(respondersFor(t, mentionsIn("@Maya can you look", DIRECTORY), "usr_irfad"), []);
  const none = createSample("nolead");
  assert.equal(whoLine(thread(none), none.data.nameOf), "No agent will reply · type @ to ask one");
  assert.equal(leadOf(thread(none)), undefined);
  assert.ok(has(html(none), "No agent will reply"));
});

test("the last 50 messages are on the page; older ones are one request away and merge without repeats", () => {
  const s = createSample("long");
  const live = msgs(s);
  assert.equal(live.length, WINDOW);
  const out = html(s);
  assert.ok(has(out, 'data-testid="earlier-button"') && has(out, "Show earlier messages"));
  assert.ok(!has(out, "Question 1:"), "the oldest message is not drawn");
  const page = s.data.screens.query("chats.conversation", "messages", { threadId: "c1", before: beforeCursor(live)! }).getSnapshot() as unknown as { data: { messages: Message[]; hasMore: boolean } };
  assert.equal(page.data.messages.length, 50);
  const all = mergePages(live, page.data.messages);
  assert.equal(all.length, 100);
  assert.equal(mergePages(all, page.data.messages).length, 100, "no repeats");
  assert.equal(lastMessages(all, 50).hiddenLocal, 50);
  assert.deepEqual(byOrder(all).map((m) => m.threadSeq), [...all].map((m) => m.threadSeq).sort((a, b) => a - b));
});

test("while an agent works a plain send queues; Interrupt sends it now with the new message's id", async () => {
  const s = createSample("streaming");
  assert.deepEqual(workingAgents(msgs(s), new Set(["m7"])), ["agt_intake"]);
  assert.equal(sendKind("interrupt", false), "queue");
  assert.equal(sendKind("interrupt", true), "interrupt");
  await act.sendMessage(s.data, { text: "Use Thursday instead", mentions: [], key: "k1", kind: "queue", working: true });
  assert.deepEqual(s.calls.map((c) => c.cap), ["chat.post"]);
  await act.sendMessage(s.data, { text: "Stop, use Thursday", mentions: [], key: "k2", kind: "interrupt", working: true });
  assert.deepEqual(s.calls.map((c) => c.cap), ["chat.post", "chat.post", "engine.interrupt"]);
  const sentId = msgs(s).find((m) => m.body === "Stop, use Thursday")!.messageId;
  assert.deepEqual(s.calls[2]!.input, { threadId: "c1", messageId: sentId });
  assert.equal(queuedCount(msgs(s), "usr_irfad", true), 2);
  assert.equal(queueNote(2, "Intake"), "2 messages queued for Intake's next step");
});

test("stop and stop all: the header says which, and each calls its capability; the steps are kept", async () => {
  const s = createSample("busy");
  const out = html(s);
  assert.ok(has(out, 'data-testid="stop-button"') && has(out, "Working") && has(out, 'data-testid="helpers-button"') && has(out, "2 helpers running"));
  const working = workingAgents(msgs(s));
  assert.deepEqual(working.sort(), ["agt_docs", "agt_intake"]);
  assert.equal(stopLabel(working, s.data.nameOf), "Stop all");
  assert.equal(stopLabel(["agt_docs"], s.data.nameOf), "Stop Docs");
  await act.stopAgent(s.data, "agt_docs");
  assert.deepEqual(s.calls[0], { cap: "engine.stop", input: { threadId: "c1", agentId: "agt_docs" } });
  assert.deepEqual(workingAgents(msgs(s)), ["agt_intake"]);
  await act.stopAll(s.data);
  assert.equal(s.calls[1]!.cap, "engine.stop_all");
  assert.deepEqual(workingAgents(msgs(s)), []);
  assert.ok(msgs(s).every((m) => m.blocks.length === 0 || m.blocks.every((b) => b.state !== "live")) && msgs(s).some((m) => m.blocks.length > 0), "steps stay");
});

test("mode: making Docs lead turns Intake into a listener; one lead per thread", async () => {
  const s = createSample("idle");
  const r = await act.setMode(s.data, "agt_docs", "lead");
  assert.equal(r.leadAgentId, "agt_docs");
  assert.deepEqual(thread(s).agents.map((a) => [a.agentId, a.mode]), [["agt_intake", "listen"], ["agt_docs", "lead"]]);
  assert.ok(has(html(s), "Docs will reply"));
  await act.addAgent(s.data, "agt_research");
  await act.removeAgent(s.data, "agt_docs");
  assert.deepEqual(thread(s).agents.map((a) => a.agentId), ["agt_intake", "agt_research"]);
});

test("streaming: text is on the page up to the last delta, with the work folded and Working in the header", () => {
  const s = createSample("streaming");
  const out = html(s);
  assert.ok(has(out, 'data-testid="body-m7"') && has(out, "consult fee") && has(out, "retainer is"));
  assert.ok(has(out, "Worked for 8s, 2 steps") && has(out, 'data-testid="conversation-live"') && has(out, 'data-testid="stop-button"'));
  s.push(" Shall I send it to Maya?");
  assert.ok(has(html(s), "Shall I send it to Maya?"));
});

test("streamed deltas append once per frame", () => {
  let frame: (() => void) | null = null;
  const store = createStreamStore({ request: (cb) => { frame = () => cb(0); return 1; }, cancel: () => { frame = null; } });
  for (let i = 0; i < 100; i++) store.push("word ");
  assert.equal(store.stats().appends, 0, "nothing is appended before the frame");
  (frame as (() => void) | null)?.();
  assert.equal(store.stats().deltas, 100);
  assert.equal(store.stats().appends, 1, "one append for 100 deltas");
});

test("an error is one inline row: what, why, next, What happened, Copy trace id; Retry carries the turn", async () => {
  const s = createSample("errors");
  const out = html(s);
  assert.ok(has(out, "Docs did not read fee-schedule.csv") && has(out, "Restricted data only goes to a model on your computer."));
  for (const t of ["Switch to Llama 3.3 on this computer", "Ask for access", "Retry", "What happened?", "Copy trace id", "Report a problem"]) assert.ok(has(out, t), t);
  assert.ok(has(out, "Changed 1 file in Rivera matter") && has(out, "Review changes") && has(out, "Rivera engagement letter"));
  await act.retryTurn(s.data, "turn_9").catch(() => undefined);
  assert.equal(s.calls[0]!.cap, "engine.turn.retry");
});

test("cards: a plan waits for approval and a question waits for an answer; both write", async () => {
  const s = createSample("plan");
  const out = html(s);
  assert.ok(has(out, "Rivera onboarding plan") && has(out, 'data-testid="blk-plan-p1-approve"') && has(out, "Send the engagement letter"));
  assert.ok(has(out, "Who signs the engagement letter?") && has(out, "Maya Chen") && has(out, "Omar Haddad"));
  await act.answerBlock(s.data, "q1", "maya");
  await act.approvePlan(s.data, "plan_1");
  await act.setPlanMode(s.data, false);
  assert.deepEqual(s.calls.map((c) => c.cap), ["chat.answer_block", "chat.approve_plan", "threads.set_plan_mode"]);
  assert.ok(has(html(s), "You answered: maya"), "the shared question card shows the answer that was written");
});

test("message writes: edit, pin, react, thread and delete go through their capabilities and change the page", async () => {
  const s = createSample("idle");
  await act.editMessage(s.data, "m3", "Book 4pm.");
  await act.setPinned(s.data, "m3", true);
  await act.react(s.data, "m4", "👍", false);
  const tid = await act.openMessageThread(s.data, "m4");
  const out = html(s);
  assert.ok(has(out, "Book 4pm.") && has(out, "edited") && has(out, 'data-testid="pinned-m3"') && has(out, "👍 1"));
  assert.equal(tid, "t_m4");
  await act.deleteMessage(s.data, "m3");
  assert.ok(!has(html(s), "Book 4pm."));
  assert.ok(has(html(createSample("idle")), 'data-testid="hover-m3"'), "every row has its toolbar");
});

test("states: offline, closed, empty frame before data, and no em dash", () => {
  assert.ok(has(html(createSample("idle", { online: false })), 'data-testid="conversation-offline"') && has(html(createSample("idle", { online: false })), "Tuesday has two openings"));
  assert.ok(has(html(createSample("closed")), 'data-testid="conversation-closed"') && !has(html(createSample("closed")), 'data-testid="composer-field"'));
  assert.ok(has(clean(renderToStaticMarkup(<ConversationLoading />)), 'data-testid="conversation-loading"') && has(clean(renderToStaticMarkup(<Conversation />)), 'data-testid="conversation-loading"'));
  const variants: Variant[] = ["idle", "streaming", "busy", "errors", "plan", "long", "nolead", "closed"];
  for (const v of variants) assert.ok(!html(createSample(v)).includes(String.fromCharCode(0x2014)), v);
});

test("work folds, day labels and timeline grouping", () => {
  const s = createSample("idle");
  const m2 = msgs(s).find((m) => m.messageId === "m2")!;
  assert.equal(workOf(m2)?.summary, "Worked for 14s, 3 steps");
  assert.equal(dayLabel(SAMPLE_NOW, s.data.clock()), "Today");
  assert.equal(dayLabel(SAMPLE_NOW - 86_400_000, s.data.clock()), "Yesterday");
  const kinds = timeline(msgs(s), ctx(s)).map((i) => i.kind);
  assert.deepEqual(kinds.slice(0, 4), ["day", "me", "event", "other"]);
});

const noActions = {
  copy: () => undefined, edit: () => undefined, setPinned: () => undefined, react: () => undefined, openThread: () => undefined, remove: () => undefined, openAgent: () => undefined, openBeside: () => undefined,
  answer: () => undefined, approvePlan: () => undefined, retryTurn: () => undefined, errorNext: () => undefined, retrySend: () => undefined, discardSend: () => undefined, showMenu: () => undefined,
  host: { invoke: () => undefined, open: () => undefined },
};

/* ---------- the lead's review (changes requested): the proposal inline, the plan card, the header, the composer ---------- */

test("the AGENT.md proposal is inline: the diff with Accept, Edit and Reject, not a collapsed card", () => {
  const s = createSample("idle");
  const out = html(s);
  const block = msgs(s).find((m) => m.messageId === "m5")!.blocks[0]!;
  assert.ok(isProposal(block));
  assert.ok(has(out, " · proposed by Intake"));
  inOrder(out, ['data-testid="proposal-b2"', "2 changes", 'data-testid="proposal-b2-why"', "## How you work", "4. Offer three consult times using the booking tool.", "Skip Thursday mornings.", "## You do not", "Offer Thursday morning times", 'data-testid="proposal-b2-accept"', 'data-testid="proposal-b2-edit-open"', 'data-testid="proposal-b2-reject"']);
  assert.ok(has(out, "Accept") && has(out, "Edit") && has(out, "Reject"));
  assert.ok(!has(out, "Intake wants to change its instructions"), "no collapsed card");
  assert.equal(changeCount(1), "1 change");
});

test("Accept and Reject are the changeset capabilities; an edit goes back as a request with the lines; a person who may not accept suggests", async () => {
  const s = createSample("idle");
  const d = proposalData(msgs(s).find((m) => m.messageId === "m5")!.blocks[0]!.data);
  const host = { invoke: (cap: string, input: Record<string, unknown>) => s.data.call(cap, input), open: () => undefined };
  const acts = proposalActs(host, d, "b2");
  await acts.accept();
  await acts.reject();
  await acts.sendEdited(["4. Offer three times. Never Thursday mornings.", "  "]);
  await acts.suggest();
  assert.deepEqual(s.calls.map((c) => c.cap), ["changesets.approve", "changesets.discard", "changesets.request_changes", "changesets.request_changes"]);
  const approve = s.calls[0]!.input as { changesetId: string; idempotencyKey: string };
  assert.equal(approve.changesetId, "chg_cs1");
  assert.ok(approve.idempotencyKey.startsWith("idem_b2_approve_"));
  assert.equal((s.calls[2]!.input as { note: string }).note, editedNote("AGENT.md", ["4. Offer three times. Never Thursday mornings."]));
  assert.ok((s.calls[3]!.input as { note: string }).note.startsWith("Suggested to Maya Chen: "));
});

test("the plan card is on the page: name, open comments, click to open beside the chat", () => {
  const s = createSample("idle");
  const out = html(s);
  const block = msgs(s).find((m) => m.messageId === "m4")!.blocks.find((b) => b.id === "pl1")!;
  assert.ok(isPlanFile(block));
  inOrder(out, ['data-testid="plancard-pl1"', "Plan · 1 open comment · click to open beside the chat", "client-intake.pdf"]);
  assert.equal(planFileLine(2), "Plan · 2 open comments · click to open beside the chat");
});

test("the header has the agent chip with a face and mode mark, the participants count, search and the pane", () => {
  const s = createSample("idle");
  const out = html(s);
  inOrder(out, ['data-testid="conversation-title"', 'data-testid="face-agt_intake"', ">Intake<", 'data-testid="participants-button"', 'data-testid="find-button"', 'data-testid="pane-button"', 'data-testid="more-button"']);
  assert.ok(has(out, "3 in this thread"));
  assert.deepEqual(participants(thread(s), s.data.nameOf).map((p) => [p.name, p.role]), [["You", "Person"], ["Intake", "Leads"], ["Docs", "Listening"]]);
});

test("find in chat: matches are ignoring case and accents, counted, and stepped", () => {
  const s = createSample("idle");
  const all = msgs(s);
  assert.deepEqual(findMatches(all, "tuesday"), ["m2", "m4"]);
  assert.deepEqual(findMatches(all, "  "), []);
  assert.deepEqual(findMatches(all, "zzz"), []);
  assert.equal(matchLine(2, 0, "tuesday"), "1 of 2");
  assert.equal(matchLine(0, 0, "zzz"), "No matches");
  assert.equal(matchLine(0, 0, ""), "");
  assert.deepEqual(findMatches([{ ...all[0]!, body: "Café Rivera" }], "cafe"), ["m1"]);
});

test("the composer has the model chip (Opus) and the computer button; its placeholder names who answers", () => {
  const s = createSample("idle");
  const out = html(s);
  assert.ok(has(out, 'data-testid="model-chip"') && has(out, "Model: Opus") && has(out, 'data-testid="computer-button"') && has(out, "Intake's computer"));
  assert.ok(has(out, "Message Intake…"));
  assert.equal(modelLabel("opus"), "Opus");
  assert.equal(placeholderFor(thread(s), s.data.nameOf, true), "Queue a message for when Intake finishes…");
  assert.ok(!has(html(createSample("nolead")), 'data-testid="model-chip"'));
});

test("switching the model lists the allowed models and sets the lead's model; the header and composer follow", async () => {
  const s = createSample("idle");
  const models = await act.listModels(s.data);
  assert.deepEqual(models.map((m) => m.title), ["Opus", "Sonnet", "Haiku", "Llama 3.3 on this computer"]);
  await act.setModel(s.data, "agt_intake", models[1]!);
  assert.deepEqual(s.calls.map((c) => c.cap), ["engine.models.list", "engine.set_model"]);
  assert.deepEqual(s.calls[1]!.input, { threadId: "c1", agentId: "agt_intake", provider: "anthropic", model: "sonnet" });
  assert.ok(has(html(s), "Model: Sonnet"));
});

test("the browser chat-open probe: one warm-up discarded, the median of five against the unchanged 100 ms budget, the worst printed, exactly 50 messages", () => {
  assert.equal(CHAT_OPEN_BUDGET_MS, 100);
  const ok = summarizeOpen([40, 90, 55, 61, 48], 50);
  assert.equal(ok.median, 55);
  assert.equal(ok.worst, 90);
  assert.equal(ok.ok, true, "a worst run over the median does not fail the median");
  assert.equal(summarizeOpen([120, 130, 110, 140, 125], 50).ok, false, "median over the budget fails");
  assert.equal(summarizeOpen([40, 41, 42, 43, 44], 49).ok, false, "not the last 50 messages");
  assert.equal(summarizeOpen([40, 41, 42, 43, 44], 51).ok, false, "not the last 50 messages");
  assert.equal(summarizeOpen([40, 41, 42], 50).ok, false, "fewer than five counted runs");
  assert.equal(summarizeOpen([], 50).ok, false);
});

test("the probe line is never backwards: a fast open with 50 rows is ok, a slow one is over budget, a wrong count says so", () => {
  assert.equal(openVerdict(summarizeOpen([40, 48, 50, 52, 60], 50)), "ok");
  assert.equal(openVerdict(summarizeOpen([110, 120, 130, 140, 150], 50)), "OVER BUDGET");
  assert.equal(openVerdict(summarizeOpen([40, 48, 50, 52, 60], 49)), "WRONG ROW COUNT (49 of 50)");
  assert.equal(openVerdict(summarizeOpen([40, 48], 50)), "TOO FEW RUNS (2 of 5)");
});

test("the long sample's last 50 rows are 50 timeline rows (messages and events), the count the probe checks", () => {
  const s = createSample("long");
  const rows = lastMessages(msgs(s), WINDOW).rows;
  assert.equal(rows.length, 50);
  const out = html(s);
  const n = (out.match(/data-testid="(?:msg|event)-[^"]+"/g) ?? []).length;
  assert.equal(n, 50);
});

test("the diff draws removed lines red and added lines green, and Accept is the dark button with its check while Edit and Reject carry their icons", () => {
  const out = html(createSample("idle"));
  const del = out.slice(out.lastIndexOf("<", out.indexOf('data-testid="diff-del"')), out.indexOf(">", out.indexOf('data-testid="diff-del"')) + 1);
  const add = out.slice(out.lastIndexOf("<", out.indexOf('data-testid="diff-add"')), out.indexOf(">", out.indexOf('data-testid="diff-add"')) + 1);
  assert.ok(has(del, "var(--danger)") && has(add, "var(--ok)"));
  assert.equal(out.split('data-testid="diff-del"').length - 1, 1, "one removed line");
  assert.equal(out.split('data-testid="diff-add"').length - 1, 2, "two added lines");
  const accept = out.slice(at(out, 'data-testid="proposal-b2-accept"'), at(out, 'data-testid="proposal-b2-edit-open"'));
  assert.ok(has(accept, "<svg"), "Accept has its check icon");
  const edit = out.slice(at(out, 'data-testid="proposal-b2-edit-open"'), at(out, 'data-testid="proposal-b2-reject"'));
  assert.ok(has(edit, "<svg"), "Edit has its icon");
  const reject = out.slice(at(out, 'data-testid="proposal-b2-reject"'), at(out, 'data-testid="proposal-b2-reject"') + 900);
  assert.ok(has(reject, "<svg"), "Reject has its icon");
});

test("the error row offers Report a problem, which opens the shared report sheet with the message and the trace id", async () => {
  const { setReportProblemHandler } = await import("../../../../../../ui/src/Menu/index.tsx");
  const seen: { label?: string }[] = [];
  const off = setReportProblemHandler((c) => seen.push(c));
  const { reportProblem } = await import("../../../../../../ui/src/Menu/index.tsx");
  reportProblem({ label: reportLabel("Docs did not read fee-schedule.csv", "tr_5e20b4") });
  off();
  assert.deepEqual(seen, [{ label: "Docs did not read fee-schedule.csv (trace tr_5e20b4)" }]);
  assert.ok(has(html(createSample("errors")), 'data-testid="err-report"'));
});

test("the hover bar draws Copy, Edit (yours only), Reply and More while the row is hovered or focused, and none of them before: fifty hidden bars were most of the first frame", () => {
  const s = createSample("idle");
  const m3 = msgs(s).find((m) => m.messageId === "m3")!;
  const m4 = msgs(s).find((m) => m.messageId === "m4")!;
  const bar = (m: Message, mine: boolean, visible: boolean): string => clean(renderToStaticMarkup(<HoverBar m={m} mine={mine} a={noActions} onEdit={() => undefined} visible={visible} />));
  const mine = bar(m3, true, true);
  assert.ok(has(mine, 'data-testid="act-copy-m3"') && has(mine, 'data-testid="act-edit-m3"') && has(mine, 'data-testid="act-reply-m3"') && has(mine, 'data-testid="act-more-m3"'));
  const theirs = bar(m4, false, true);
  assert.ok(has(theirs, 'data-testid="act-copy-m4"') && !has(theirs, 'data-testid="act-edit-m4"') && has(theirs, 'data-testid="act-more-m4"'));
  const idle = bar(m3, true, false);
  assert.ok(has(idle, 'data-testid="hover-m3"') && !has(idle, "act-copy-m3") && !has(idle, "<svg"));
  assert.ok(!has(html(s), 'data-testid="act-copy-m3"'), "a resting page draws no bar buttons");
});
