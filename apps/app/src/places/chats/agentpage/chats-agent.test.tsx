// Agent page: the screen (P-L9b_05; mapped from apps/app/tests/chats-agent.test.tsx because lane L9b owns only apps/app/src/places/chats/). The photo, name, status and role line;
// Chat and Automation runs; the strip; five tabs in the shared tab strip; the role line edits in place with Undo and is read-only with a lock for a person who may not change the
// agent; routine posts carry "Sent by <agent> on a routine <person> set"; Settings shows the files with their line counts, suggestions, limits, keys and the routines you set.
// Rendered from the sample Spaces through the live screen queries; every write changes what the next render shows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPage, AgentPageLoading } from "./AgentPage.tsx";
import { acceptSuggestion, dismissSuggestion, moveToTrash, pause, resume, saveRoleLine, setRoutine, startChat } from "./actions.ts";
import type { PageDeps } from "./actions.ts";
import {
  AGENT_MD_LIMIT, LOCKED_NOTE, ROLE_MAX, TABS, accountLine, chatsOf, dollars, instructionsLine, isTabKey, limitRows, mineOnly, roleToSave, routineLabel, routineNote, spendLine, spendRatio, statusLine,
  stripOf, suggestionTitle,
} from "./model.ts";
import type { AgentRow, Routine, Summary, TabKey, Thread } from "./model.ts";
import { SAMPLE_NOW, createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample, tab: TabKey = "chats"): string => clean(renderToStaticMarkup(<AgentPage data={s.data} tab={tab} window={ALL} />));
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const inOrder = (s: string, needles: string[]): void => { const idx = needles.map((n) => at(s, n)); assert.deepEqual([...idx].sort((a, b) => a - b), idx, `in the order ${needles.join(" > ")}`); };
const deps = (s: Sample): { d: PageDeps; notes: { text: string; undo?: () => Promise<void> | void }[] } => {
  const notes: { text: string; undo?: () => Promise<void> | void }[] = [];
  return { notes, d: { call: s.data.call, note: (text, undo) => notes.push(undo ? { text, undo } : { text }) } };
};
const agentNow = (s: Sample): AgentRow => (s.replica.rows("agents") as unknown as AgentRow[]).find((a) => a.agentId === s.data.agent.agentId)!;
const summaryOf = (s: Sample): Summary => (s.data.screens.query("chats.agent-page", "summary", { agentId: s.data.agent.agentId }).getSnapshot() as unknown as { data: Summary }).data;
const tabs: TabKey[] = ["chats", "memory", "files", "computer", "settings"];

test("the page reads: photo and name with the status, the role line, Chat and Automation runs, the strip, then five tabs in order", () => {
  const out = html(createSample("owner"));
  inOrder(out, ['data-testid="agent-page"', 'data-testid="agent-name"', ">Intake<", 'data-testid="agent-status"', ">Working<", 'data-testid="role-line"', 'data-testid="chat-button"', 'data-testid="runs-button"', 'data-testid="agent-strip"', ">Chats<", ">Memory<", ">Files<", ">Computer<", ">Settings<"]);
  assert.ok(has(out, ">Books first calls and follows up on cold inquiries<"));
  assert.deepEqual(TABS.map((t) => t.title), ["Chats", "Memory", "Files", "Computer", "Settings"]);
  assert.ok(has(out, "Automation runs") && has(out, 'data-testid="folder-button"') && has(out, 'data-testid="computer-button"') && has(out, 'data-testid="more-button"'));
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("the strip: chats this week, open tasks, runs today, spend against the limit, memory facts, proposed facts", () => {
  const s = createSample("owner");
  const out = html(s);
  inOrder(out, ['data-testid="stat-chats"', "chats this week", 'data-testid="stat-tasks"', "open tasks", 'data-testid="stat-runs"', "runs today", 'data-testid="stat-spend"', "of $5 today", 'data-testid="stat-facts"', "memory facts", 'data-testid="stat-proposed"', "proposed facts"]);
  assert.deepEqual(stripOf(summaryOf(s)).map((x) => [x.key, x.value]), [["chats", "3"], ["tasks", "4"], ["runs", "6"], ["spend", "$0.42"], ["facts", "4"], ["proposed", "3"]]);
  assert.equal(spendLine(summaryOf(s)), "$0.42 of $5 today");
  assert.ok(has(out, 'data-testid="spend-bar"'));
  assert.equal(Math.round(spendRatio(summaryOf(s)) * 100), 8);
  assert.equal(dollars(0), "$0.00");
  assert.equal(dollars(12_000_000), "$12");
  assert.equal(dollars(1_500_000_000), "$1.5k");
  assert.equal(stripOf({ ...summaryOf(s), chatsThisWeek: 1, openTasks: 1, runsToday: 1, memoryFacts: 1, proposedFacts: 1 }).map((x) => x.label).join("|"), "chat this week|open task|run today|of $5 today|memory fact|proposed fact");
});

test("Chats tab: what it is working on, its chats newest first, what it is linked to", () => {
  const s = createSample("owner");
  const out = html(s, "chats");
  inOrder(out, ['data-testid="label-l-working"', "Acme launch intake", "Follow up with Dev Rao", 'data-testid="label-l-chats"', "Acme intake", "Weekly lead report", 'data-testid="label-l-linked"', "#intake"]);
  assert.ok(has(out, 'data-testid="page-body-chats"'));
  const all = (s.replica.rows("threads") as unknown as Thread[]);
  assert.deepEqual(chatsOf("agt_intake", all).map((t) => t.threadId), ["c1", "c5"], "chats only, newest first; threads and helpers stay in the right pane");
});

test("a press on Chat starts a chat with the agent and opens it; a failed start says so and opens nothing", async () => {
  const s = createSample("owner");
  const { d, notes } = deps(s);
  const id = await startChat(d, "agt_intake", "Intake");
  assert.ok(id !== null && id.startsWith("c_new"));
  assert.deepEqual(s.calls.map((c) => c.cap), ["chat.start"]);
  assert.deepEqual(s.calls[0]!.input, { kind: "chat", agentIds: ["agt_intake"], idempotencyKey: (s.calls[0]!.input as { idempotencyKey: string }).idempotencyKey });
  assert.ok(has(html(s), `data-testid="row-chat-${id}"`), "the new chat is in the list");
  s.failNext("chat.start");
  assert.equal(await startChat(d, "agt_intake", "Intake"), null);
  assert.equal(notes[notes.length - 1]!.text, "Could not start a chat with Intake. Try again.");
});

test("the role line: Enter saves to description with an inline Undo that restores the version the save returned", async () => {
  const s = createSample("owner");
  const { d, notes } = deps(s);
  assert.equal(roleToSave("  Books first calls   and  more  ", "Books first calls and follows up on cold inquiries"), "Books first calls and more");
  assert.equal(roleToSave("Books first calls and follows up on cold inquiries ", "Books first calls and follows up on cold inquiries"), null, "unchanged: nothing to save");
  assert.equal(roleToSave("   ", "x"), null, "empty: nothing to save");
  assert.equal(roleToSave("x".repeat(ROLE_MAX + 40), "y")?.length, ROLE_MAX);
  const before = agentNow(s).role!;
  assert.equal(await saveRoleLine(d, "agt_intake", "Books consults and chases forms", before), true);
  assert.deepEqual(s.calls.map((c) => c.cap), ["agents.role_line.set"]);
  assert.deepEqual(s.calls[0]!.input, { agentId: "agt_intake", description: "Books consults and chases forms" });
  assert.equal(agentNow(s).role, "Books consults and chases forms");
  assert.ok(has(html(s), "Books consults and chases forms"));
  const saved = notes[notes.length - 1]!;
  assert.equal(saved.text, "Role line saved.");
  assert.ok(saved.undo, "the save offers Undo");
  await saved.undo!();
  assert.deepEqual(s.calls.map((c) => c.cap), ["agents.role_line.set", "agents.restore_version"]);
  assert.deepEqual(s.calls[1]!.input, { agentId: "agt_intake", file: "agent.toml", versionId: "ver_1" });
  assert.equal(agentNow(s).role, before, "the old line is back");
  assert.equal(notes[notes.length - 1]!.text, `Role line is back to "${before}".`);
  s.failNext("agents.role_line.set");
  assert.equal(await saveRoleLine(d, "agt_intake", "Something else", before), false);
  assert.equal(notes[notes.length - 1]!.text, "Could not save the role line. Try again.");
  assert.equal(agentNow(s).role, before, "a failed save changes nothing");
});

test("a person who may not change the agent sees the role line read-only, with the lock and the reason, and no way to edit it", () => {
  const owner = html(createSample("owner"));
  const viewer = html(createSample("viewer"));
  assert.ok(has(owner, 'aria-label="Role line: Books first calls and follows up on cold inquiries. Press to edit"'));
  assert.ok(has(viewer, `Role line: Books first calls and follows up on cold inquiries. ${LOCKED_NOTE}`));
  assert.ok(!has(viewer, "Press to edit"));
  const tag = viewer.slice(viewer.lastIndexOf("<", at(viewer, 'data-testid="role-line"')), viewer.indexOf(">", at(viewer, 'data-testid="role-line"')) + 1);
  assert.ok(!has(tag, 'role="button"'), "not a button");
});

test("routine posts carry the label; only the routines you set are shown, and nobody else sees or edits a routine", () => {
  assert.equal(routineLabel("Intake", "Omar Haddad"), "Sent by Intake on a routine Omar Haddad set");
  const s = createSample("owner");
  const out = html(s, "settings");
  assert.ok(has(out, "Sent by Intake on a routine Omar Haddad set") && has(out, 'data-testid="routine-label-note"'));
  inOrder(out, ['data-testid="label-l-routines"', 'data-testid="row-automation-runs"', "Morning lead sweep", "Watch #intake for new clients", "Chase missing intake forms"]);
  const all = s.replica.rows("routines") as unknown as Routine[];
  assert.equal(all.length, 3);
  assert.equal(mineOnly(all, "usr_omar").length, 3);
  assert.equal(mineOnly(all, "usr_irfad").length, 0);
  const viewer = html(createSample("viewer"), "settings");
  assert.ok(!has(viewer, "Morning lead sweep") && !has(viewer, "routine-label-note") && !has(viewer, "Sent by Intake"));
  assert.ok(has(viewer, 'data-testid="routines-empty"') && has(viewer, "You have not set a routine for Intake."));
  assert.ok(has(viewer, 'data-testid="row-automation-runs"'), "Automation runs is still there for the agent's own runs");
});

test("a routine's switch turns it on or off with an Undo; the row says when it runs and when it last ran", async () => {
  const s = createSample("owner");
  const { d, notes } = deps(s);
  const r = (s.replica.rows("routines") as unknown as Routine[]).find((x) => x.routineId === "r3")!;
  assert.equal(routineNote(r, s.data.clock()), "Weekdays at 08:00 · next Mon 08:00");
  assert.equal(await setRoutine(d, "agt_intake", r, false), true);
  const saved = (s.replica.rows("routines") as unknown as Routine[]).find((x) => x.routineId === "r3")!;
  assert.equal(saved.enabled, false);
  assert.equal(notes[notes.length - 1]!.text, "Morning lead sweep is paused.");
  await notes[notes.length - 1]!.undo!();
  assert.equal((s.replica.rows("routines") as unknown as Routine[]).find((x) => x.routineId === "r3")!.enabled, true);
  assert.ok(has(html(s, "settings"), 'aria-label="Morning lead sweep on"'));
});

test("Settings: AGENT.md against 150 lines, agent.toml, model, account, memory, computer, limits, access and keys (names only)", () => {
  const s = createSample("owner");
  const out = html(s, "settings");
  inOrder(out, ['data-testid="label-l-files"', "93 of 150 lines", 'data-testid="row-setting-toml"', 'data-testid="row-setting-model"', "opus, then sonnet", "Runs on the account of whoever asks", "Proposes facts for you to accept", "Has its own computer", 'data-testid="label-l-limits"', "Spend per day", "Turns per day", "Minutes per run", 'data-testid="label-l-access"', "calendar.read", "#CRM_API, #CALENDAR_BOOKING (names only)"]);
  assert.ok(has(out, "Instructions") && has(out, "AGENT.md") && has(out, "agent.toml") && has(out, "Limits"));
  assert.equal(instructionsLine(93), "93 of 150 lines");
  assert.equal(instructionsLine(140), "140 of 150 lines, nearly full");
  assert.equal(instructionsLine(AGENT_MD_LIMIT + 1), "151 of 150 lines, over the limit");
  assert.equal(accountLine({ ...agentNow(s), accountPolicy: "key", accountKey: "#TEAM_ANTHROPIC" }), "Runs on the key #TEAM_ANTHROPIC");
  assert.deepEqual(limitRows({}), []);
  assert.deepEqual(limitRows({ dayCostMicros: 5_000_000, tokensPerDay: 1_200_000 }).map((l) => [l.label, l.value]), [["Spend per day", "$5"], ["Tokens per day", "1,200,000"]]);
  assert.ok(has(html(createSample("personal"), "settings"), "Agent computers need a Team Space"));
});

test("a broken agent.toml shows the line and message and says the last good version is running", () => {
  const out = html(createSample("broken"), "settings");
  assert.ok(has(out, "Line 12: unknown key limits.on_limitt. The last good version is running."));
  assert.ok(!has(html(createSample("owner"), "settings"), "last good version"));
});

test("suggested changes: the owner accepts or dismisses; a person who cannot change the agent sees them as suggested only", async () => {
  const s = createSample("owner");
  const out = html(s, "settings");
  inOrder(out, ['data-testid="label-l-sug"', "AGENT.md: Offer Thursday morning times. Maya blocks them.", 'data-testid="accept-sg1"', 'data-testid="dismiss-sg1"', "Template change to agent.toml", "Widens what the agent may do: a Space admin approves it"]);
  const list = s.data.screens.query("chats.agent-page", "suggestions", { agentId: "agt_intake" }).getSnapshot() as unknown as { data: { suggestions: Parameters<typeof suggestionTitle>[0][] } };
  assert.equal(suggestionTitle(list.data.suggestions[0]!), "AGENT.md: Offer Thursday morning times. Maya blocks them.");
  const { d, notes } = deps(s);
  assert.equal(await acceptSuggestion(d, list.data.suggestions[0]!), true);
  assert.equal(await dismissSuggestion(d, list.data.suggestions[1]!), true);
  assert.deepEqual(s.calls.map((c) => c.cap), ["agents.suggestion.accept", "agents.suggestion.dismiss"]);
  assert.deepEqual(s.calls[0]!.input, { suggestionId: "sg1" });
  assert.equal(notes[0]!.text, "Accepted. AGENT.md has the change.");
  assert.ok(!has(html(s, "settings"), "Suggested changes"), "both are resolved, so the section is gone");
  const viewer = html(createSample("viewer"), "settings");
  assert.ok(has(viewer, 'data-testid="suggested-sg1"') && !has(viewer, 'data-testid="accept-sg1"'));
});

test("Pause and Resume write and change the status line with the reason; Move to Trash asks first", async () => {
  const s = createSample("owner");
  const { d, notes } = deps(s);
  assert.ok(has(html(s, "settings"), 'data-testid="row-pause"') && !has(html(s, "settings"), 'data-testid="row-resume"'));
  assert.equal(await pause(d, "agt_intake", "Intake", "Paused from the agent page"), true);
  assert.equal(agentNow(s).status, "paused");
  assert.equal(statusLine(agentNow(s), s.data.nameOf), "Paused by Omar Haddad: Paused from the agent page");
  const out = html(s, "settings");
  assert.ok(has(out, "Paused by Omar Haddad: Paused from the agent page") && has(out, 'data-testid="row-resume"'));
  assert.equal(notes[notes.length - 1]!.text, "Intake is paused. Its routines wait until you resume it.");
  await notes[notes.length - 1]!.undo!();
  assert.equal(agentNow(s).status, "awake", "Undo resumes it");
  await pause(d, "agt_intake", "Intake", "x");
  assert.equal(await resume(d, "agt_intake", "Intake"), true);
  assert.equal(agentNow(s).pausedBy, undefined);
  assert.ok(has(html(createSample("paused")), "Paused by Maya Chen: Waiting for the new retainer terms"));
  assert.ok(has(html(s, "settings"), 'data-testid="row-trash"') && !has(html(s, "settings"), 'data-testid="trash-confirm"'));
  assert.equal(await moveToTrash(d, "agt_intake", "Intake"), true);
  assert.equal(s.calls[s.calls.length - 1]!.cap, "agents.delete");
  s.failNext("agents.delete");
  assert.equal(await moveToTrash(d, "agt_intake", "Intake"), false);
  assert.equal(notes[notes.length - 1]!.text, "Could not move Intake to Trash. Try again.");
  const viewer = html(createSample("viewer"), "settings");
  assert.ok(!has(viewer, 'data-testid="row-pause"') && !has(viewer, 'data-testid="row-trash"'), "no Pause or Trash without the right to change the agent");
});

test("Memory, Files and Computer are the right pane's tabs read from the same data, so the page adds no second copy", () => {
  const s = createSample("owner");
  const memory = html(s, "memory");
  assert.ok(has(memory, 'data-testid="page-body-memory"') && has(memory, "Consult invoices go out the same day as the call."));
  const files = html(s, "files");
  assert.ok(has(files, "AGENT.md") && has(files, "agent.toml"));
  const computer = html(s, "computer");
  assert.ok(has(computer, "Filling the supplier records form"));
  for (const t of tabs) assert.ok(has(html(s, t), `data-testid="page-body-${t}"`), t);
  assert.ok(isTabKey("settings") && !isTabKey("routines"));
});

test("states: the frame before data, offline, a Personal Space, and no em dash in any copy", () => {
  assert.ok(has(clean(renderToStaticMarkup(<AgentPageLoading />)), 'data-testid="agent-page-loading"') && has(clean(renderToStaticMarkup(<AgentPage />)), 'data-testid="agent-page-loading"'));
  assert.ok(has(html(createSample("owner", { online: false })), 'data-testid="agent-offline"'));
  const personal = html(createSample("personal"), "settings");
  assert.ok(has(personal, "Assistant") && !has(personal, 'data-testid="computer-button"'));
  const variants: Variant[] = ["owner", "viewer", "paused", "broken", "personal"];
  for (const v of variants) for (const t of tabs) assert.ok(!html(createSample(v), t).includes(String.fromCharCode(0x2014)), `${v} ${t}`);
});

test("sample clock: Friday 24 October 2025, 10:00", () => {
  assert.equal(new Date(SAMPLE_NOW).toISOString(), "2025-10-24T10:00:00.000Z");
});
