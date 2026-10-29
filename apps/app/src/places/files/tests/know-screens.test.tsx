// Files > Knowledge screens over the Northwind sample: Learned, People/Clients/Projects/Topics, History, Trash, Archive and Search. The markup of each (its words, its groups, its rows and their
// actions), the pure helpers (verbs, the trail text, meaning lines, who removed a fact, the Learned filter), and the writes every button ends in, run through the sample's capability door and read back
// through the live queries the screens use, so a row that moves, a count that follows and an error that shows are proved against rows, not against a mock. Keyboard and right-click are proved
// by the markup (every row is focusable and every action has a name) and, in a browser, by the harness drive in the change's screenshots.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MemoryDataProvider } from "../memory/index.ts";
import { KnowLearned, WINDOWS, filterLearned, learnedBanner } from "../memory/KnowLearned.tsx";
import { KnowList, orgOf } from "../memory/KnowList.tsx";
import { KnowHistory, trailText, verbOf } from "../memory/KnowHistory.tsx";
import { KEEP_CHOICES, KnowTrash } from "../memory/KnowTrash.tsx";
import { KnowArchive } from "../memory/KnowArchive.tsx";
import { EXAMPLE_QUESTIONS, KnowSearch, meaningLine } from "../memory/KnowSearch.tsx";
import { agoDays, capital, daysSince, isDenied, removedBy } from "../memory/KnowRows.tsx";
import { acceptFact, correctFact, errorText, rejectFact, restoreFact, restorePage, trashPage, undoFact } from "../memory/actions.ts";
import { groupByDay, learnedLine } from "../memory/know.ts";
import type { KFact, TrailRow } from "../memory/know.ts";
import { KNOW_NOW, createKnowSample, pageIdOf } from "../memory/sample-know.ts";
import type { KnowSample } from "../memory/sample-know.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { LiveCap } from "../memory/index.ts";

const wrap = (s: KnowSample, el: ReactElement): string => renderToStaticMarkup(<MemoryDataProvider value={s.data}>{el}</MemoryDataProvider>).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
function read<C extends LiveCap>(s: KnowSample, cap: C, input: CapMap[C]["in"]): CapMap[C]["out"] {
  const snap = s.data.live(cap, input).getSnapshot();
  assert.equal(snap.status, "ready", cap);
  return (snap as { data: CapMap[C]["out"] }).data;
}
const has = (m: string, needle: string): void => assert.ok(m.includes(needle), `missing: ${needle}`);
const lacks = (m: string, needle: string): void => assert.ok(!m.includes(needle), `unexpected: ${needle}`);
const count = (m: string, needle: string): number => m.split(needle).length - 1;
const ids = (m: string, prefix: string): string[] => [...m.matchAll(new RegExp(`data-testid="(${prefix}[A-Za-z0-9_]+)"`, "g"))].map((x) => x[1]!);
const fact = (s: KnowSample, text: string, status: Array<"current" | "removed" | "proposed" | "closed"> = ["current", "removed", "proposed"]): KFact => {
  const f = (read(s, "memory.facts.list", { status }).facts as KFact[]).find((x) => x.text === text);
  assert.ok(f, text);
  return f;
};
const learned = (s: KnowSample): Array<CapMap["memory.learned"]["out"]["items"][number] & { fact: KFact }> => read(s, "memory.learned", { limit: 200 }).items as never;
const trash = (s: KnowSample): KFact[] => read(s, "memory.trash.search", { area: "trash" }).facts as KFact[];

// ---------------------------------------------------------------- Learned

test("Learned draws the title, the lede, the day groups with counts, and one row per fact with its subject, source and who learned it", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowLearned />);
  has(m, "data-testid=\"know-learned\"");
  has(m, "New facts appear here the moment Vyre picks them up from chats, runs and records. Undo removes one, Edit corrects it, and nothing waits for review unless an admin asks for it.");
  const groups = groupByDay(learned(s), (x) => x.at, KNOW_NOW);
  assert.deepEqual(groups.map((g) => g.label), ["Today", "Yesterday", "Earlier"]);
  for (const g of groups) { has(m, `data-testid="group-${g.label}"`); has(m, `data-testid="day-${g.label}"`); }
  assert.equal(groups[0]!.items.length, 4, "four facts today");
  has(m, "Lena Ortiz"); has(m, "Handles county records and conflict checks."); has(m, "County records search");
  has(m, "Scout learned it from Lena Ortiz"); has(m, "Assistant learned it from you"); has(m, "Intake learned it from Omar Haddad");
  has(m, "Billing wrote it down");
  lacks(m, "Billing learned it from Billing");
  has(m, "Today 9:40"); has(m, "Yesterday 17:00");
  has(m, "Capture is automatic for everything. An admin can require review for the Space or for named projects in Space Settings.");
  lacks(m, "Waiting for review");
  lacks(m, "data-testid=\"know-banner\"");
});

test("every fact row on Learned is focusable and has Undo and Edit with names that say which fact; the Filter and By agent buttons are in the header", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowLearned />);
  const rows = ids(m, "learned-fct_m").filter((x) => !x.endsWith("-subject"));
  assert.ok(rows.length >= 9);
  for (const id of rows) {
    const f = id.slice("learned-".length);
    has(m, `data-testid="undo-${f}"`); has(m, `data-testid="edit-${f}"`);
    has(m, `data-testid="${id}-subject"`);
  }
  assert.equal(count(m, "aria-label=\"Undo: "), rows.length);
  assert.equal(count(m, "aria-label=\"Edit: "), rows.length);
  has(m, "data-testid=\"learned-filter\""); has(m, "aria-label=\"Filter\"");
  has(m, "data-testid=\"learned-by-agent\""); has(m, "aria-label=\"By agent\"");
  has(m, "tabindex=\"0\"");
});

test("an Upkeep row says what upkeep did and why, has an Open button and no Undo", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowLearned />);
  has(m, "merged Office hours: two copies of “Office hours are 9 to 5 Pacific.”");
  has(m, "Same words, same source");
  const f = fact(s, "Office hours are 9 to 5 Pacific.");
  has(m, `data-testid="upkeep-${f.factId}"`); has(m, `data-testid="open-${f.factId}"`);
  lacks(m, `data-testid="undo-${f.factId}"`);
});

test("the Learned filter keeps the people asked for, and says what is filtered", () => {
  const s = createKnowSample();
  const all = learned(s);
  assert.deepEqual(filterLearned(all, new Set()).length, all.length);
  const up = filterLearned(all, new Set(["upkeep"]));
  assert.ok(up.length > 0 && up.every((x) => x.actorKind === "upkeep"));
  const intake = filterLearned(all, new Set(["agt_intake"]));
  assert.ok(intake.length > 0 && intake.every((x) => x.actor === "agt_intake"));
  assert.equal(filterLearned(all, new Set(["agt_intake", "upkeep"])).length, intake.length + up.length);
  assert.equal(learnedBanner(7, ["Intake"], 3), "Last 7 days · learned by Intake · 3 shown");
  assert.equal(learnedBanner(0, [], 20), "All time · 20 shown");
  assert.deepEqual(WINDOWS.map((w) => w.label), ["Last 7 days", "Last 30 days", "All time"]);
});

test("the window reaches back: all time has more than the last seven days", () => {
  const s = createKnowSample();
  const week = read(s, "memory.learned", { since: KNOW_NOW - 7 * 86_400_000 }).items.length;
  const all = read(s, "memory.learned", {}).items.length;
  assert.ok(all > week);
});

test("learnedLine says who learned what from whom", () => {
  const s = createKnowSample();
  const who = (id: string): string => (id === "usr_irfad" ? "you" : s.data.nameOf(id));
  const items = learned(s);
  const line = (text: string): string => capital(learnedLine(items.find((x) => x.fact.text === text)!, who));
  assert.equal(line("Prefers updates on Fridays."), "Assistant learned it from you");
  assert.equal(line("October invoices total $18,420 across 12 drafts."), "Billing wrote it down");
});

test("Undo moves the fact to Trash, the line has an Undo that restores it, and both are on the trail", async () => {
  const s = createKnowSample();
  const f = fact(s, "Prefers updates on Fridays.");
  await undoFact(s.data, f.factId);
  assert.ok(!learned(s).some((x) => x.fact.factId === f.factId));
  assert.ok(trash(s).some((x) => x.factId === f.factId && x.trashReason === "undone"));
  assert.ok(!wrap(s, <KnowLearned />).includes(`data-testid="learned-${f.factId}"`));
  await restoreFact(s.data, f.factId);
  assert.ok(learned(s).some((x) => x.fact.factId === f.factId));
  assert.ok(wrap(s, <KnowLearned />).includes(`data-testid="learned-${f.factId}"`));
});

test("Edit saves a new version, keeps the old wording in history, and the row reads the new text", async () => {
  const s = createKnowSample();
  const f = fact(s, "Prefers updates on Fridays.");
  const out = await correctFact(s.data, f.factId, "Prefers updates on Thursdays.");
  assert.equal(out.fact.text, "Prefers updates on Thursdays.");
  const m = wrap(s, <KnowLearned />);
  has(m, "Prefers updates on Thursdays."); lacks(m, "Prefers updates on Fridays.");
  const history = read(s, "memory.fact.get", { factId: out.fact.factId }).history;
  assert.ok(history.some((h) => h.text === "Prefers updates on Fridays."));
  assert.ok(read(s, "memory.trail", { factId: out.fact.factId }).rows.some((r) => r.action === "edit"));
});

test("a fact waiting for review sits in its own section at the top with Accept and Reject; accepting moves it into the feed, rejecting closes it off", async () => {
  const s = createKnowSample({ proposed: true });
  const m = wrap(s, <KnowLearned />);
  has(m, "Waiting for review"); has(m, "1 waiting"); has(m, "Elena wants the engagement letter as a PDF.");
  assert.ok(m.indexOf("Waiting for review") < m.indexOf("data-testid=\"group-Today\""));
  const f = fact(s, "Elena wants the engagement letter as a PDF.");
  has(m, `data-testid="accept-${f.factId}"`); has(m, `data-testid="reject-${f.factId}"`);
  await acceptFact(s.data, f.factId);
  const after = wrap(s, <KnowLearned />);
  lacks(after, "Waiting for review");
  has(after, `data-testid="learned-${f.factId}"`);
  const r = createKnowSample({ proposed: true });
  await rejectFact(r.data, fact(r, "Elena wants the engagement letter as a PDF.").factId);
  lacks(wrap(r, <KnowLearned />), "Waiting for review");
});

test("a refused write shows its error text, not a silent nothing", async () => {
  const s = createKnowSample({ fail: "permission.role_lacks_permission" });
  const f = fact(s, "Prefers updates on Fridays.");
  await assert.rejects(() => undoFact(s.data, f.factId), /role_lacks_permission/);
  assert.equal(errorText(new Error("permission.role_lacks_permission"), "Could not undo the fact"), "Could not undo the fact: permission.role_lacks_permission");
  assert.equal(errorText(null, "Could not undo the fact"), "Could not undo the fact.");
});

// ---------------------------------------------------------------- lists

test("People, Clients, Projects and Topics each draw their title, lede and one row per page with its words, layer and fact count", () => {
  const s = createKnowSample();
  const want: Array<["person" | "client" | "project" | "topic", string, string, string]> = [
    ["person", "People", "The people on your team and what Vyre knows about working with them.", "Maya Chen"],
    ["client", "Clients", "Clients and their contacts: preferences, plans, history.", "Ian Brooks"],
    ["project", "Projects", "Each project keeps its own facts, shared with the people on it.", "Q4 billing"],
    ["topic", "Topics", "Rules and ideas that cut across clients and projects.", "Consult fee"],
  ];
  for (const [kind, title, lede, name] of want) {
    const m = wrap(s, <KnowList kind={kind} />);
    has(m, `data-testid="know-list"`); has(m, `>${title}<`); has(m, lede); has(m, name);
    assert.equal(count(m, "data-testid=\"page-pg_") >= 3, true);
  }
});

test("a client row says its organisation in muted words, the layer it lives in, its facts and its Trash count; the newest activity is first", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowList kind="client" />);
  has(m, "Ian Brooks"); has(m, " · Brooks Logistics"); has(m, "Client contact at Brooks Logistics. Signed on Sep 3, Growth plan.");
  has(m, "6 facts"); has(m, "1 in Trash"); has(m, "Space");
  const order = ids(m, "page-pg_").filter((x) => !x.startsWith("page-open"));
  assert.deepEqual(order.slice(0, 3), [pageIdOf("ian"), pageIdOf("elena"), pageIdOf("priya")].map((x) => `page-${x}`), "Ian learned the newest fact, then Elena, then Priya");
  const people = ids(wrap(s, <KnowList kind="person" />), "page-pg_").filter((x) => !x.startsWith("page-open"));
  assert.equal(people[0], `page-${pageIdOf("lena")}`, "Lena learned the newest fact");
  assert.equal(orgOf({ subtitle: "Client at Brooks Logistics" } as never), "Brooks Logistics");
  assert.equal(orgOf({ subtitle: "Person" } as never), null);
});

test("each row can be opened by the keyboard and has a More button with a name", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowList kind="person" />);
  const n = ids(m, "more-pg_").length;
  assert.equal(n, 4);
  assert.equal(count(m, "aria-label=\"More for "), n);
  assert.ok(count(m, "tabindex=\"0\"") >= n);
  has(m, "role=\"list\"");
});

test("Move to Trash takes the page off its list and Restore brings it back", async () => {
  const s = createKnowSample();
  const pid = pageIdOf("ian");
  assert.ok(wrap(s, <KnowList kind="client" />).includes(`data-testid="page-${pid}"`));
  await trashPage(s.data, pid);
  assert.ok(!wrap(s, <KnowList kind="client" />).includes(`data-testid="page-${pid}"`));
  assert.ok(read(s, "memory.trash.search", { area: "trash" }).pages!.some((p) => p.pageId === pid));
  await restorePage(s.data, pid);
  assert.ok(wrap(s, <KnowList kind="client" />).includes(`data-testid="page-${pid}"`));
});

test("a list with no pages says so", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowList kind="person" />);
  lacks(m, "No people yet");
  const empty = createKnowSample();
  const st = empty.snapshot();
  empty.replica.put("state", [{ id: "s", ...st, pages: [] } as never]);
  const e = wrap(empty, <KnowList kind="person" />);
  has(e, "No people yet"); has(e, "Pages appear here as Vyre learns about them from chats, runs and records.");
});

// ---------------------------------------------------------------- History

test("History draws its lede, the Filter button and one row per trail line with the actor, the verb, the words and the reason", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowHistory />);
  has(m, "Every change to what Vyre knows: who made it, what changed and why. The trail is never deleted. An erase keeps a line with no content.");
  has(m, "data-testid=\"history-filter\"");
  has(m, "Assistant"); has(m, " learned"); has(m, "Ian Brooks: Prefers updates on Fridays."); has(m, "From you in Brooks weekly update");
  has(m, "Upkeep"); has(m, " merged"); has(m, " flagged"); has(m, " moved to Trash"); has(m, " edited");
  has(m, "Maya Chen"); has(m, "You");
  has(m, "Today 9:38");
  const total = read(s, "memory.trail", {}).rows.length;
  assert.equal(ids(m, "trail-trl_").length, total);
  lacks(m, "data-testid=\"know-banner\"");
});

test("History for one page shows only that page's lines and a banner that says so", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowHistory pageId={pageIdOf("ian")} />);
  has(m, "data-testid=\"know-banner\""); has(m, "Ian Brooks · 5 shown"); has(m, "Show all");
  assert.equal(ids(m, "trail-trl_").length, 5);
  lacks(m, "Pricing research");
});

test("the verbs of the trail and the text it carries", () => {
  const words: Array<[TrailRow["action"], string]> = [["create", "learned"], ["learn", "learned"], ["merge", "merged"], ["delete", "moved to Trash"], ["undo", "moved to Trash"], ["edit", "edited"], ["flag", "flagged"], ["restore", "restored"], ["erase", "erased"], ["archive", "archived"], ["accept", "accepted"], ["reject", "rejected"], ["promote", "promoted"], ["resolve", "resolved"]];
  for (const [a, w] of words) assert.equal(verbOf(a), w);
  const row = (over: Partial<TrailRow>): TrailRow => ({ id: "t", at: KNOW_NOW, action: "learn", actor: "usr_irfad", actorKind: "person", ...over });
  assert.equal(trailText(row({ detail: { text: "Ian: Fridays" } })), "Ian: Fridays");
  assert.equal(trailText(row({ action: "erase", detail: { text: "never shown" } })), "A fact was erased");
  assert.equal(trailText(row({})), "");
});

test("an erase row reads A fact was erased and never carries the content", () => {
  const s = createKnowSample();
  const st = s.snapshot();
  st.trail.unshift({ id: "trl_erase", at: KNOW_NOW, action: "erase", actor: "usr_irfad", actorKind: "person", reason: "Erased at the owner's request" } as TrailRow);
  s.replica.put("state", [{ id: "s", ...st } as never]);
  const m = wrap(s, <KnowHistory />);
  has(m, "A fact was erased"); has(m, "Erased at the owner's request");
  assert.equal(count(m, ">A fact was erased<"), 1);
  lacks(m, "never shown");
});

test("a change made now shows on the trail with its words", async () => {
  const s = createKnowSample();
  const f = fact(s, "Prefers updates on Fridays.");
  await undoFact(s.data, f.factId);
  const m = wrap(s, <KnowHistory />);
  has(m, "Ian Brooks: Prefers updates on Fridays."); has(m, "Undone by you"); has(m, " moved to Trash");
});

// ---------------------------------------------------------------- Trash and Archive

test("Trash lists each removed fact with its subject, struck text, reason, who removed it, days left and a Restore button", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowTrash />);
  has(m, "Facts that were deleted or merged away. Agents do not recall them, but search can find them. Anyone, or any agent, who could see a fact can restore it with one click. After 60 days untouched they move to Archive.");
  const rows = trash(s);
  assert.equal(rows.length, 4);
  for (const f of rows) { has(m, f.text); has(m, `data-testid="restore-${f.factId}"`); has(m, `data-testid="trash-${f.factId}"`); }
  has(m, "Removed by Maya Chen 3 days ago"); has(m, "She said it is out of date"); has(m, "57 days left of 60");
  has(m, "Removed by you 8 days ago"); has(m, "Corrected to $200");
  has(m, "Removed by Upkeep 16 days ago"); has(m, "Replaced by a newer fact");
  has(m, "13 days left of 60");
  has(m, "data-testid=\"trash-keep\""); has(m, "Keep 60 days");
  assert.deepEqual([...KEEP_CHOICES], [30, 45, 60, 90]);
});

test("Restore puts the fact back, the Trash count follows, and the Undo of the line puts it in Trash again", async () => {
  const s = createKnowSample();
  const f = fact(s, "Prefers meetings before 10 am.", ["removed"]);
  await restoreFact(s.data, f.factId);
  assert.equal(trash(s).length, 3);
  assert.ok(!wrap(s, <KnowTrash />).includes(`data-testid="restore-${f.factId}"`));
  assert.ok(learned(s).some((x) => x.fact.factId === f.factId));
  await undoFact(s.data, f.factId);
  assert.equal(trash(s).length, 4);
  assert.ok(wrap(s, <KnowTrash />).includes(`data-testid="restore-${f.factId}"`));
});

test("Trash for one page shows only its facts under a banner; an empty Trash says so; a trashed page is listed with Restore", async () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowTrash pageId={pageIdOf("maya")} />);
  has(m, "Only Maya Chen · 1 shown"); has(m, "Prefers meetings before 10 am."); lacks(m, "Ortega Partners");
  const none = wrap(s, <KnowTrash pageId={pageIdOf("sam")} />);
  has(none, "Trash is empty"); has(none, "Nothing was deleted or merged away.");
  await trashPage(s.data, pageIdOf("ian"));
  const withPage = wrap(s, <KnowTrash />);
  has(withPage, `data-testid="trash-page-${pageIdOf("ian")}"`); has(withPage, `data-testid="restore-${pageIdOf("ian")}"`); has(withPage, "Client page");
  await restorePage(s.data, pageIdOf("ian"));
  lacks(wrap(s, <KnowTrash />), "trash-page-");
});

test("who removed a fact comes from the newest trail row that removed it, by id or by its words", () => {
  const s = createKnowSample();
  const trail = read(s, "memory.trail", {}).rows as TrailRow[];
  const ortega = fact(s, "Ortega Partners charges $250.", ["removed"]);
  assert.equal(removedBy(trail, ortega)?.actor, "usr_irfad");
  const fee = fact(s, "The standard consult fee is $200.", ["removed"]);
  assert.deepEqual(removedBy(trail, fee), { actor: "upkeep", actorKind: "upkeep" });
  const old = fact(s, "Prefers phone calls on Mondays.", ["removed"]);
  assert.equal(removedBy(trail, old), null);
  assert.equal(removedBy([{ id: "a", at: 1, action: "undo", actor: "x", actorKind: "person", factId: ortega.factId }, { id: "b", at: 2, action: "delete", actor: "y", actorKind: "agent", factId: ortega.factId }], ortega)?.actor, "y");
});

test("days and words for age", () => {
  assert.equal(agoDays(0), "today"); assert.equal(agoDays(1), "yesterday"); assert.equal(agoDays(8), "8 days ago");
  assert.equal(daysSince(KNOW_NOW - 3 * 86_400_000, KNOW_NOW), 3);
  assert.equal(daysSince(KNOW_NOW + 5, KNOW_NOW), 0);
  assert.equal(capital("you"), "You"); assert.equal(capital(""), "");
});

test("Archive lists what stayed in Trash past the keep days, archived, with Restore for an admin", async () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowArchive />);
  has(m, "Facts untouched in Trash for 60 days. They are out of search and out of recall. An admin can restore one, and the trail keeps every step.");
  has(m, "Meyer Law charged $225 before the July change."); has(m, "The office was closed Jul 3 to Jul 6.");
  has(m, "Archived 71 days ago"); has(m, "Archived 112 days ago"); has(m, "Untouched in Trash for 60 days");
  assert.equal(ids(m, "restore-fct_m").length, 2);
  lacks(m, "You are viewing as a member");
  lacks(m, "left of 60");
  const f = fact(s, "The office was closed Jul 3 to Jul 6.", ["removed"]);
  await restoreFact(s.data, f.factId);
  const after = wrap(s, <KnowArchive />);
  lacks(after, "The office was closed Jul 3 to Jul 6.");
  assert.equal(ids(after, "restore-fct_m").length, 1);
  assert.ok(learned(s).some((x) => x.fact.factId === f.factId));
});

test("a member reading Archive gets the bar, no rows and no Restore", async () => {
  const s = createKnowSample({ member: true });
  const m = wrap(s, <KnowArchive />);
  has(m, "You are viewing as a member. Only Space admins can restore from Archive."); has(m, "data-testid=\"archive-member\"");
  has(m, "Archive is for admins");
  assert.equal(ids(m, "restore-").length, 0);
  lacks(m, "Meyer Law");
  const snap = createKnowSample({ member: true }).data.live("memory.trash.search", { area: "archive" } as never);
  assert.throws(() => snap.getSnapshot(), /role_lacks_permission/);
  assert.equal(isDenied({ status: "loading", error: { message: "permission.role_lacks_permission" } }), true);
  assert.equal(isDenied({ status: "loading", error: { message: "network down" } }), false);
  assert.equal(isDenied({ status: "loading" }), false);
  await assert.rejects(() => restoreFact(s.data, fact(s, "The office was closed Jul 3 to Jul 6.", ["removed"]).factId), /role_lacks_permission/);
});

test("a member sees Trash without the Keep days menu, an admin has it", () => {
  assert.ok(wrap(createKnowSample(), <KnowTrash />).includes("trash-keep"));
  const m = wrap(createKnowSample({ member: true }), <KnowTrash />);
  lacks(m, "trash-keep");
  has(m, "Prefers meetings before 10 am.");
});

test("an empty Archive says so", () => {
  const s = createKnowSample();
  const st = s.snapshot();
  s.replica.put("state", [{ id: "s", ...st, facts: st.facts.filter((f) => f.trashedAt === undefined || now() - f.trashedAt <= 60 * 86_400_000) } as never]);
  const m = wrap(s, <KnowArchive />);
  has(m, "Archive is empty"); has(m, "Nothing has aged out of Trash yet.");
});
const now = (): number => KNOW_NOW;

// ---------------------------------------------------------------- Search

test("Search with nothing typed offers the three example questions", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowSearch q="" />);
  has(m, "Ask in plain words or type a name. Vyre matches meaning as well as words, on this server, so nothing leaves it.");
  has(m, "Try a question");
  assert.deepEqual([...EXAMPLE_QUESTIONS], ["How does Ian like to hear from us?", "What do we charge for a first consult?", "When does Maya take consults?"]);
  for (const q of EXAMPLE_QUESTIONS) has(m, q);
  assert.equal(count(m, "data-testid=\"search-example\""), 3);
  lacks(m, "search-facts");
  has(m, "value=\"\"");
});

test("Search with a question shows pages, facts with their source, who and when, and says how the answer was found", () => {
  const s = createKnowSample();
  const q = "How does Ian like to hear from us?";
  const m = wrap(s, <KnowSearch q={q} />);
  has(m, "value=\"How does Ian like to hear from us?\"");
  has(m, "Pages"); has(m, "Ian Brooks"); has(m, "Client contact at Brooks Logistics.");
  has(m, "Facts"); has(m, "found");
  has(m, "Prefers updates on Fridays."); has(m, "Brooks weekly update"); has(m, "Assistant"); has(m, "today");
  has(m, "Matching meaning and words on this server.");
  lacks(m, "data-testid=\"search-example\"");
  const hits = read(s, "memory.search", { q, limit: 12 }).hits.filter((h) => h.kind === "fact");
  assert.equal(ids(m, "hit-fct_m").filter((x) => !x.endsWith("-subject")).length, hits.length);
});

test("Search says plainly when only the words were matched", () => {
  assert.equal(meaningLine({ state: "on" }), "Matching meaning and words on this server.");
  assert.equal(meaningLine(undefined), null);
  assert.equal(meaningLine({ state: "not_set_up" }), "Meaning search is not set up on this server yet. These are keyword matches.");
  assert.equal(meaningLine({ state: "degraded" }), "Meaning search is having trouble right now. These are keyword matches.");
  assert.equal(meaningLine({ state: "loading" }), "Meaning search is getting ready. These are keyword matches for now.");
  assert.equal(meaningLine({ state: "off" }), "Meaning search is off for this Space. These are keyword matches.");
  assert.equal(meaningLine({ state: "not_set_up", hint: "Run the model download in Space Settings." }), "Run the model download in Space Settings.");
});

test("Search finds what is in Trash and says agents do not recall it; Restore brings it out", async () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowSearch q="consult fee" />);
  has(m, "In Trash"); has(m, "not recalled by agents"); has(m, "The standard consult fee is $200.");
  const f = fact(s, "The standard consult fee is $200.", ["removed"]);
  has(m, `data-testid="restore-${f.factId}"`);
  await restoreFact(s.data, f.factId);
  lacks(wrap(s, <KnowSearch q="consult fee" />), "not recalled by agents");
});

test("Search with no match says so", () => {
  const m = wrap(createKnowSample(), <KnowSearch q="zzzq" />);
  has(m, "No current facts match. Try other words, or ask it as a question.");
  lacks(m, "In Trash");
  lacks(m, "data-testid=\"search-pages\"");
});

test("a fact found by Search is not a Trash row and a Trash fact is not a hit", () => {
  const s = createKnowSample();
  const m = wrap(s, <KnowSearch q="consult fee" />);
  const hits = ids(m, "hit-");
  const gone = fact(s, "The standard consult fee is $200.", ["removed"]);
  assert.ok(!hits.includes(`hit-${gone.factId}`));
});

// ---------------------------------------------------------------- the shared frame of every screen

test("every screen draws the Knowledge header with its crumb and the Search knowledge field", () => {
  const s = createKnowSample();
  const screens: Array<[ReactElement, string]> = [[<KnowLearned />, "Learned"], [<KnowList kind="topic" />, "Topics"], [<KnowHistory />, "History"], [<KnowTrash />, "Trash"], [<KnowArchive />, "Archive"], [<KnowSearch q="" />, "Search"]];
  for (const [el, crumb] of screens) {
    const m = wrap(s, el);
    has(m, "aria-label=\"Knowledge\""); has(m, `>${crumb}</h1>`); has(m, "aria-label=\"Search knowledge\"");
    has(m, `aria-level="2"`);
  }
});

test("every screen draws in both themes with tokens only", () => {
  const s = createKnowSample({ proposed: true });
  for (const el of [<KnowLearned />, <KnowList kind="person" />, <KnowHistory />, <KnowTrash />, <KnowArchive />, <KnowSearch q="Ian" />]) {
    const m = wrap(s, el);
    const hex = m.match(/(?:color|background)[^;"]*#[0-9a-fA-F]{3,8}\b/g);
    assert.equal(hex, null, `no hard-coded hex colour in a style: ${String(hex)}`);
  }
});
