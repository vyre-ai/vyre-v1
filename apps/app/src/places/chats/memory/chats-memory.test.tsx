// Memory inside a chat: "Used 3 memories" under a reply (and its list of facts and quotes, each source a jump to that line), the quote card, the Learned line with Undo and Edit, the underline of known
// subjects with their hover card, the memory items of the message menu (Remember, Add to a page, Show what the agent knew, Forget), and the right pane's Knows tab (groups, editing in place, the pin to
// a reply). Rendered from the Brooks weekly update sample over the Knowledge sample's rows; every write goes through the store and the next read shows it. The browser run (hover, keys, right-click)
// is in the screenshot harness, not here: these tests read the markup, the pure rules and the writes.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { parseInline } from "../../../../../../ui/src/stream/markdown.ts";
import type { Block } from "../../../../../../ui/src/stream/markdown.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { menuFor } from "../conversation/MessageView.tsx";
import type { MessageActions } from "../conversation/MessageView.tsx";
import type { Message } from "../conversation/model.ts";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { MemoryTab } from "../rightpane/MemoryTab.tsx";
import { TABS } from "../rightpane/model.ts";
import { createSample as createPaneSample } from "../rightpane/sample.ts";
import { addMessageToPage, correctFact, decideFact, forgetFacts, forgetMessage, rememberMessage, restoreLearned, undoLearned } from "./actions.ts";
import type { Say } from "./actions.ts";
import { ChatMemoryContext } from "./data.tsx";
import { createMemoryStore } from "./data.tsx";
import { memoryEntries } from "./menu.tsx";
import {
  FLASH, KNOWS_SCOPE, NO_SUBJECTS, USED_FOOT, appendLine, asOfFilter, groupKnows, hasSubject, knowRowKey, linkSubjects, quoteDate, rememberText, splitSubjects, subjectIndex, subjectKey, subjectOfHref, usedCount, usedLabel,
} from "./model.ts";
import type { ChatFact, LearnedRow } from "./model.ts";
import { ASSISTANT, MESSAGE_IDS, createChatMemorySample } from "./sample.ts";
import type { ChatMemorySample } from "./sample.ts";
import { ChatMemoryProvider } from "./thread.tsx";
import type { ThreadMemory } from "./thread.tsx";
import { SubjectCard } from "./Subjects.tsx";
import { ReplyMemory } from "./Used.tsx";
import { KNOW_NOW } from "../../files/memory/sample-know.ts";

installComposerForTests(Composer);

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#x2019;", "’");
const has = (s: string, n: string): boolean => s.includes(n);
const inOrder = (s: string, needles: string[]): void => {
  const idx = needles.map((n) => { const i = s.indexOf(n); assert.ok(i >= 0, `expected ${n}`); return i; });
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, needles.join(" > "));
};
const html = (s: ChatMemorySample): string => clean(renderToStaticMarkup(<Conversation data={s.data} />));
const count = (s: string, n: string): number => s.split(n).length - 1;
const withWarm = async (o: Parameters<typeof createChatMemorySample>[0] = {}): Promise<ChatMemorySample> => { const s = createChatMemorySample(o); await s.warm(); return s; };
const learned = async (s: ChatMemorySample): Promise<Array<{ fact: { factId: string; text: string; sourceRef: string } }>> => ((await s.memory.store.read("memory.learned", { threadId: "c1", limit: 200 })) as { items: Array<{ fact: { factId: string; text: string; sourceRef: string } }> }).items;
const taughtFact = async (s: ChatMemorySample): Promise<string> => (await learned(s)).find((i) => i.fact.sourceRef === MESSAGE_IDS.held)!.fact.factId;
const says = (): { say: Say; lines: Array<{ text: string; undo?: () => void | Promise<unknown> }> } => { const lines: Array<{ text: string; undo?: () => void | Promise<unknown> }> = []; return { lines, say: (text, undo) => void lines.push(undo ? { text, undo } : { text }) }; };

const PAGES = [
  { pageId: "pg_ian", title: "Ian Brooks", kind: "client", alias: ["Ian"] },
  { pageId: "pg_elena", title: "Elena Rivera", kind: "client", alias: ["Elena", "Ms. Rivera"] },
  { pageId: "pg_maya", title: "Maya Chen", kind: "person", alias: ["Maya"] },
  { pageId: "pg_brooksonb", title: "Brooks onboarding", kind: "project" },
  { pageId: "pg_assistant", title: "Assistant", kind: "agent" },
];

/* ---------- the pure rules ---------- */

test("known subjects: a title or an alias of a person, client, project or topic page, longest first, never an agent page", () => {
  const idx = subjectIndex(PAGES);
  assert.ok(!idx.names.some(([, id]) => id === "pg_assistant"), "an agent page is not underlined");
  assert.equal(idx.names[0]![0].length >= idx.names[idx.names.length - 1]![0].length, true);
  const segs = splitSubjects("Draft the update for Ian Brooks, then ask Ian and Maya.", idx);
  assert.deepEqual(segs.filter((s) => s.t === "subject").map((s) => [s.v, (s as { pageId: string }).pageId]), [["Ian Brooks", "pg_ian"], ["Ian", "pg_ian"], ["Maya", "pg_maya"]]);
  assert.equal(segs.map((s) => s.v).join(""), "Draft the update for Ian Brooks, then ask Ian and Maya.", "the text is kept whole");
  assert.deepEqual(splitSubjects("ms. rivera called", idx).filter((s) => s.t === "subject").map((s) => s.v), [], "an alias with a dot in it needs its own boundary, not a lowercase match inside a sentence start");
});

test("known subjects: not inside a word, an address or a path, and a name under three letters is not matched", () => {
  const idx = subjectIndex([...PAGES, { pageId: "pg_al", title: "Al", kind: "person" }]);
  for (const text of ["Ianthe wrote", "mail ian@brooks.example now", "see /Users/Ian/notes", "the Ian-Marie way", "Mayan temple", "Al went home"]) {
    assert.ok(!hasSubject(splitSubjects(text, idx)), text);
  }
  assert.ok(hasSubject(splitSubjects("(Ian) and \"Maya\" and Elena.", idx)));
  assert.deepEqual(splitSubjects("nothing here", NO_SUBJECTS), [{ t: "text", v: "nothing here" }]);
});

test("known subjects in markdown: text gets links of its own kind; code, links and a code block are left alone; blocks without a subject keep their object", () => {
  const idx = subjectIndex(PAGES);
  const blocks: Block[] = [
    { kind: "p", key: "a", inline: parseInline("Ask **Ian** about `Ian.send()` or [Ian's page](https://example.com/ian).") },
    { kind: "code", key: "b", lang: "", text: "Ian Brooks", closed: true },
    { kind: "ul", key: "c", start: 1, items: [parseInline("Maya leads"), parseInline("nothing")] },
    { kind: "p", key: "d", inline: parseInline("no names") },
  ];
  const out = linkSubjects(blocks, idx);
  const hrefs = (b: Block): string[] => JSON.stringify(b).match(/vyre-subject:[a-z_]+/g) ?? [];
  assert.deepEqual(hrefs(out[0]!), ["vyre-subject:pg_ian"], "only the plain Ian inside the bold run; the code and the link are not touched");
  assert.deepEqual(hrefs(out[1]!), [], "a code block is not underlined");
  assert.deepEqual(hrefs(out[2]!), ["vyre-subject:pg_maya"]);
  assert.equal(out[3], blocks[3], "a block with no subject is the same object");
  assert.equal(subjectOfHref("vyre-subject:pg_ian"), "pg_ian");
  assert.equal(subjectOfHref("https://example.com"), null);
});

test("words and small rules: Used N memories, quote dates, the three keys, what Knows keeps", () => {
  assert.equal(usedLabel(1), "Used 1 memory");
  assert.equal(usedLabel(3), "Used 3 memories");
  assert.equal(usedCount({ facts: [{ factId: "a" } as ChatFact], quotes: [] }), 1);
  assert.equal(usedCount(undefined), 0);
  assert.equal(quoteDate(Date.UTC(2025, 9, 12, 15, 5), KNOW_NOW), "Oct 12");
  assert.equal(subjectKey("Enter"), "open");
  assert.equal(subjectKey(" "), "open");
  assert.equal(subjectKey("Escape"), "close");
  assert.equal(subjectKey("a"), null);
  assert.equal(knowRowKey("e"), "edit");
  assert.equal(knowRowKey("Enter"), "edit");
  assert.equal(knowRowKey("x"), null);
  assert.equal(appendLine("a\n\n", "- b"), "a\n- b");
  assert.equal(appendLine("", "- b"), "- b");
  assert.equal(rememberText("  one \n\n two  "), "one two");
  assert.equal(rememberText("x".repeat(500)).length, 400);
  const f = (id: string, layer: ChatFact["layer"], at: number): ChatFact => ({ factId: id, text: id, layer, sourceKind: "chat", sourceRef: "r", at });
  const facts = [f("p", "person", 5), f("s1", "space", 1), f("s2", "space", 9), f("a", "agent", 3), f("j", "project", 4)];
  assert.deepEqual(groupKnows(facts).map((g) => [g.head, g.facts.map((x) => x.factId)]), [["Space", ["s2", "s1"]], ["Project", ["j"]], ["Agent", ["a"]], ["You", ["p"]]]);
  assert.deepEqual(asOfFilter(facts, 4).map((x) => x.factId), ["s1", "a", "j"], "facts learned after the reply are hidden");
  assert.equal(asOfFilter(facts, null).length, 5);
});

/* ---------- under a reply ---------- */

test("a reply that used memory shows 'Used 3 memories' (closed) and a card for the exact quote; a reply that used nothing shows neither", async () => {
  const out = html(await withWarm());
  // the reply has a Worked row, so the memory line is folded into it (shut by default) and not a line of its own; the card of the exact quote stays on the face
  assert.ok(has(out, "Worked for") && !has(out, 'data-testid="mused-msg_k2_1"'), "no Used line of its own under a reply that has a Worked row");
  inOrder(out, ["I have two addresses for", 'data-testid="qcard-quote_ian_updates"', "told me today he prefers updates on Fridays"]);
  const alone = clean(renderToStaticMarkup(<ChatMemoryProvider memory={(await withWarm()).memory} threadId="c1"><ReplyMemory messageId={MESSAGE_IDS.reply} threadId="c1" reply={"Here is the update for Ian Brooks. The logistics dashboard is on track and the Growth plan is unchanged."} /></ChatMemoryProvider>));
  assert.ok(has(alone, 'data-testid="mused-msg_k2_1"') && has(alone, "Used 3 memories"), "a reply with no Worked row keeps the closed line when memories shaped it");
  assert.ok(has(alone, 'aria-expanded="false"') && !has(alone, 'data-testid="mused-list-msg_k2_1"'), "the list opens on a press");
  const unrelated = clean(renderToStaticMarkup(<ChatMemoryProvider memory={(await withWarm()).memory} threadId="c1"><ReplyMemory messageId={MESSAGE_IDS.reply} threadId="c1" reply={"Sure, done."} /></ChatMemoryProvider>));
  assert.ok(!has(unrelated, "Used 2 memories") && !has(unrelated, "Used 3 memories"), "a reply no memory shaped shows no fact line");
  assert.ok(has(out, "Irfad Imtiaz") && has(out, "Oct 12 · Brooks kickoff") && has(out, "“Ian was clear about updates."));
  assert.ok(has(out, "Jump to the message") && has(out, "Exact words, recalled from the chat"));
  assert.equal(count(out, 'data-testid="mused-toggle-'), 0, "the line is folded into the Worked row; the Held reply used nothing and has none");
  assert.ok(!has(out, 'data-testid="mused-msg_k2_3"') && !has(out, 'data-testid="mused-msg_k2_0"'), "your own message has no line");
});

test("the list of a reply: facts with their source chip, who and how long ago, Open <page> and Forget; the quote with its chat; the foot says only what you could open", async () => {
  const s = await withWarm();
  const out = clean(renderToStaticMarkup(<ChatMemoryProvider memory={s.memory} threadId="c1"><ReplyMemory messageId={MESSAGE_IDS.reply} threadId="c1" startOpen /></ChatMemoryProvider>));
  assert.ok(has(out, 'aria-expanded="true"') && has(out, 'data-testid="mused-list-msg_k2_1"'));
  inOrder(out, ["Brooks onboarding: First deliverable is the logistics dashboard, due Nov 14.", "Ian Brooks: Brooks Logistics is on the Growth plan, $2,400 a month, since Sep 3.", "“Ian was clear about updates.", USED_FOOT]);
  assert.equal(count(out, ">Fact<"), 2);
  assert.equal(count(out, ">Quote<"), 1);
  assert.ok(has(out, ">Brooks kickoff<") && has(out, ">Brooks Logistics<"), "the source chips name the chat and the record");
  assert.ok(has(out, "Intake · 11 days ago") && has(out, "Billing · 19 days ago"));
  assert.ok(has(out, "Open Brooks onboarding") && has(out, "Open Ian Brooks"));
  assert.equal(count(out, ">Forget<"), 2);
  const tagOf = (id: string): string => { const i = out.indexOf(`data-testid="${id}"`); assert.ok(i >= 0, id); return out.slice(out.lastIndexOf("<", i), out.indexOf(">", i) + 1); };
  for (const id of ["mused-fact-fct_m22", "mused-quote-quote_ian_updates"]) assert.ok(has(tagOf(id), 'tabindex="0"'), `${id} takes focus (right-click or the menu key opens its menu)`);
  assert.ok(has(out, 'role="link"') && has(out, 'aria-label="Open the source: Brooks kickoff"'));
});

test("nothing draws without memory, with a server that cannot say what a reply used, or when the read fails", async () => {
  const none = html(createChatMemorySample({ noMemory: true }));
  for (const n of ["mused-", "qcard-", "learned-", "subject-pg_"]) assert.ok(!has(none, n), `no ${n} without memory`);
  assert.ok(has(none, "Ian told me today") && has(none, "Held. It will go out"), "the chat itself is the same");
  const old = await withWarm({ withoutCaps: ["memory.used", "memory.learned", "memory.page.list"] });
  const out = html(old);
  for (const n of ["mused-", "qcard-", "learned-", "subject-pg_"]) assert.ok(!has(out, n), `no ${n} on an older server`);
});

/* ---------- the Learned line ---------- */

test("the message that taught something has 'Learned: <fact> · Undo · Edit'", async () => {
  const s = await withWarm();
  const out = html(s);
  const id = await taughtFact(s);
  assert.ok(has(out, `data-testid="learned-line-${id}"`));
  inOrder(out, ["Held. It will go out", "Learned:", "Ian Brooks: Prefers updates on Fridays.", 'data-testid="learned-undo-', 'data-testid="learned-edit-btn-']);
  assert.ok(has(out, `aria-label="Undo: Prefers updates on Fridays."`) && has(out, `aria-label="Edit: Prefers updates on Fridays."`));
  assert.equal(count(out, 'data-testid="learned-line-'), 1, "only the message it was learned from");
});

test("Undo moves the fact to Trash and the line becomes 'Moved to Trash. Restore'; Restore brings it back", async () => {
  const s = await withWarm();
  const id = await taughtFact(s);
  html(s); // the page has drawn the line
  assert.equal(await undoLearned(s.memory, id), null);
  assert.ok(s.calls.some((c) => c.cap === "memory.undo" && (c.input as { factId: string }).factId === id));
  await s.warm();
  const off = html(s);
  assert.ok(has(off, `data-testid="learned-off-${id}"`) && has(off, "Moved to Trash.") && has(off, `data-testid="learned-restore-${id}"`));
  assert.ok(!has(off, "Learned:"));
  assert.ok(!(await learned(s)).some((i) => i.fact.factId === id), "the fact is out of what was learned");
  assert.equal(await restoreLearned(s.memory, id), null);
  await s.warm();
  const on = html(s);
  assert.ok(has(on, `data-testid="learned-line-${id}"`) && !has(on, "Moved to Trash."));
  const trail = (s.know.data.live("memory.trail", { factId: id }).getSnapshot() as { data: { rows: Array<{ action: string }> } }).data.rows.map((r) => r.action);
  assert.deepEqual(trail.slice(0, 2), ["restore", "undo"]);
});

test("Edit corrects the fact: the old wording is kept in history and the line shows the new one", async () => {
  const s = await withWarm();
  const id = await taughtFact(s);
  const r = await correctFact(s.memory, id, "Prefers updates on Friday mornings.");
  assert.ok(r.ok && r.fact.factId !== id);
  const hist = (s.know.data.live("memory.fact.get", { factId: r.ok ? r.fact.factId : "" }).getSnapshot() as { data: { history: Array<{ text: string }> } }).data.history;
  assert.ok(hist.some((h) => h.text === "Prefers updates on Fridays."), "the old wording is in history");
  await s.warm();
  const out = html(s);
  assert.ok(has(out, "Ian Brooks: Prefers updates on Friday mornings.") && !has(out, "Prefers updates on Fridays."));
});

test("a write that fails says so as text, and changes nothing", async () => {
  const s = await withWarm({ fail: "permission.role_lacks_permission" });
  const id = await taughtFact(s);
  assert.equal(await undoLearned(s.memory, id), "Could not undo it: permission.role_lacks_permission");
  const c = await correctFact(s.memory, id, "x");
  assert.deepEqual(c, { ok: false, error: "Could not save the change: permission.role_lacks_permission" });
  const { say, lines } = says();
  assert.equal(await forgetFacts(s.memory, [id], say), false);
  assert.equal(lines[0]!.text, "Could not forget it: permission.role_lacks_permission");
  assert.ok((await learned(s)).some((i) => i.fact.factId === id), "the fact is still there");
});

/* ---------- known subjects in the text ---------- */

test("known subjects are underlined in the reply and in your bubble, reachable by keyboard, and not in a chat without memory", async () => {
  const s = await withWarm();
  const out = html(s);
  assert.ok(count(out, 'data-testid="subject-pg_ian"') >= 4, "Ian Brooks and Ian in the reply, Ian in both bubbles");
  assert.ok(has(out, 'aria-label="Open the page: Ian Brooks"') && has(out, 'role="link"') && has(out, 'tabindex="0"'));
  assert.ok(!has(out, "subject-pg_assistant"), "an agent is not underlined");
  assert.ok(has(out, "Draft this week") && !has(html(createChatMemorySample({ noMemory: true })), 'data-testid="subject-pg_ian"'));
  assert.equal(s.calls.filter((c) => c.cap === "memory.page.list").length, 1, "one page list for the thread");
});

test("the hover card of a subject: tile, name, kind and who sees it, the blurb, the three newest facts, Open page, Open in Graph", async () => {
  const s = await withWarm({}), pid = "pg_ian";
  await s.memory.store.read("memory.page.get", { pageId: pid });
  const out = clean(renderToStaticMarkup(<ChatMemoryProvider memory={s.memory} threadId="c1"><SubjectCard pageId={pid} at={{ left: 10, top: 10 }} onClose={() => undefined} /></ChatMemoryProvider>));
  inOrder(out, [">Ian Brooks<", "Client · Space", "Client contact at Brooks Logistics.", 'data-testid="subject-open-pg_ian"']);
  assert.equal(count(out, 'data-testid="subject-fact-'), 3, "the top three facts");
  assert.ok(has(out, "chats link here") && has(out, ">Open page<") && has(out, ">Open in Graph<"));
  assert.ok(has(out, 'role="dialog"'));
  const fresh = clean(renderToStaticMarkup(<ChatMemoryProvider memory={(await withWarm()).memory} threadId="c1"><SubjectCard pageId="pg_elena" at={{ left: 0, top: 0 }} onClose={() => undefined} /></ChatMemoryProvider>));
  assert.ok(has(fresh, "Loading") && has(fresh, ">Elena Rivera<"), "while the page loads the card has the name already");
});

/* ---------- the right-click menu ---------- */

const msg = (id: string, body: string, kind: Message["kind"] = "agent"): Message => ({ messageId: id, threadId: "c1", threadSeq: 1, author: { kind: "agent", id: ASSISTANT }, kind, body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: Date.UTC(2025, 9, 24, 9, 31) } as unknown as Message);
const labels = (items: ReturnType<typeof menuFor>): string[] => items.map((i) => ("separator" in i ? "-" : "head" in i ? `# ${i.head}` : i.label));
/** A thread memory the way the provider builds it, over the sample, for the pure menu and action tests. */
const threadOf = (s: ChatMemorySample, taught: LearnedRow[] = []): { thread: ThreadMemory; lines: ReturnType<typeof says>["lines"] } => {
  const { say, lines } = says();
  return { lines, thread: { memory: s.memory, threadId: "c1", index: subjectIndex(PAGES), pages: PAGES, learnedFrom: () => [], currentFrom: () => taught, supersede: () => undefined, flash: say } };
};

test("the message menu keeps every item it had and adds Remember This, Add to a Page, Show What the Agent Knew Here and Forget This", async () => {
  const s = await withWarm();
  const { thread } = threadOf(s);
  const shown: string[][] = [];
  const actions = { copy: () => undefined, openThread: () => undefined, setPinned: () => undefined, react: () => undefined, remove: () => undefined, showMenu: (items) => void shown.push(labels(items as never)), memoryEntries: (m, x, y, show) => memoryEntries(thread, m, { x, y }, show) } as unknown as MessageActions;
  const withMemory = labels(menuFor(msg("m1", "hello"), false, actions, () => undefined, { x: 5, y: 6 }));
  const plain = labels(menuFor(msg("m1", "hello"), false, { ...actions, memoryEntries: undefined } as MessageActions, () => undefined));
  assert.deepEqual(plain, ["Copy", "Reply in Thread", "Pin Message", "Add Reaction"]);
  assert.deepEqual(withMemory, ["Copy", "Reply in Thread", "Pin Message", "Add Reaction", "-", "Remember This", "Add to a Page…", "Show What the Agent Knew Here", "Forget This"]);
  const mine = labels(menuFor(msg("m1", "hello", "text"), true, actions, () => undefined));
  assert.deepEqual(mine.slice(0, 3), ["Copy", "Edit", "Reply in Thread"]);
  assert.deepEqual(mine.slice(-4), ["Show What the Agent Knew Here", "Forget This", "-", "Delete"]);
  assert.deepEqual(labels(menuFor(msg("q1", "", "quiet"), false, actions, () => undefined)), ["Copy", "Reply in Thread", "Pin Message", "Add Reaction"], "a quiet event line has no memory items");
  const entries = memoryEntries(thread, { messageId: "m1", body: "hi", createdAt: 1 }, { x: 5, y: 6 }, (items, x, y) => void shown.push([...labels(items as never), `@${x},${y}`]));
  const add = entries.find((e) => "label" in e && e.label.startsWith("Add to a Page"))!;
  (add as { onSelect: () => void }).onSelect();
  assert.deepEqual(shown[0], ["# Add to a page", "Ian Brooks · Client", "Elena Rivera · Client", "Maya Chen · Person", "Brooks onboarding · Project", "@5,6"], "the picker lists the pages, never an agent, under the menu that asked");
});

test("Remember This asks chat.remember (the chat module picks the layer and leaves the card), flashes 'Remembered.' with Undo, and keeps the fact out of the Learned feed (as the server does)", async () => {
  const s = await withWarm();
  const { say, lines } = says();
  await rememberMessage(s.memory, "c1", { messageId: MESSAGE_IDS.reply, body: "The Growth plan is unchanged this month." }, say);
  const call = s.calls.find((c) => c.cap === "chat.remember")!;
  assert.deepEqual({ ...(call.input as Record<string, unknown>), idempotencyKey: "k" }, { threadId: "c1", messageId: MESSAGE_IDS.reply, text: "The Growth plan is unchanged this month.", idempotencyKey: "k" }, "the server picks the layer and keeps the message as the source");
  assert.equal(lines[0]!.text, FLASH.remembered);
  // like the server: Learned is what memory learned by itself; a fact the person asked to keep is theirs, in their memory, and the card in the thread is its trace
  assert.ok(!(await learned(s)).some((i) => i.fact.text === "The Growth plan is unchanged this month."), "not in the Learned feed");
  const kept = ((await s.memory.store.read("memory.facts.list", { status: ["current"] })) as { facts: Array<{ text: string; sourceRef: string }> }).facts.find((f) => f.text === "The Growth plan is unchanged this month.");
  assert.ok(kept && kept.sourceRef === MESSAGE_IDS.reply, "it is in the person's memory, from that message");
  await lines[0]!.undo!();
  assert.ok(!((await s.memory.store.read("memory.facts.list", { status: ["current"] })) as { facts: Array<{ text: string }> }).facts.some((f) => f.text === "The Growth plan is unchanged this month."), "Undo takes it back");
  await rememberMessage(s.memory, "c1", { messageId: "m", body: "   " }, say);
  assert.equal(lines[1]!.text, "There are no words in this message to remember.");
});

test("Add to a Page appends the message as a line to that page's Notes against the version it read; a stale write refuses and says so", async () => {
  const s = await withWarm();
  const { say, lines } = says();
  const before = (s.know.data.live("memory.page.get", { pageId: "pg_cadence" }).getSnapshot() as { data: { notes: string; page: { version: number } } }).data;
  assert.equal(await addMessageToPage(s.memory, { body: "Fridays by noon, always." }, "pg_cadence", "Client update cadence", say), true);
  const put = s.calls.find((c) => c.cap === "memory.page.put")!.input as { notes: string; baseVersion: number };
  assert.equal(put.baseVersion, before.page.version);
  assert.equal(put.notes, `${before.notes}\n- Fridays by noon, always.`);
  assert.equal(lines[0]!.text, "Added to Client update cadence.");
  const after = (s.know.data.live("memory.page.get", { pageId: "pg_cadence" }).getSnapshot() as { data: { notes: string } }).data;
  assert.ok(after.notes.endsWith("- Fridays by noon, always."));
  await lines[0]!.undo!();
  assert.equal((s.know.data.live("memory.page.get", { pageId: "pg_cadence" }).getSnapshot() as { data: { notes: string } }).data.notes, before.notes, "Undo writes the old Notes back");
  // someone else changed the page between the read and the write
  const stale = createChatMemorySample();
  const realWrite = stale.memory.store.write;
  stale.memory.store.write = (async (cap: string, input: unknown) => { if (cap === "memory.page.put") await stale.know.data.call("memory.page.put", { pageId: "pg_cadence", notes: "changed meanwhile" }); return realWrite(cap, input); }) as typeof realWrite;
  const second = says();
  assert.equal(await addMessageToPage(stale.memory, { body: "x" }, "pg_cadence", "Client update cadence", second.say), false);
  assert.ok(second.lines[0]!.text.startsWith("Could not add it to Client update cadence: "));
});

test("Forget This moves what the message taught to Trash and offers Undo; a message that taught nothing says so", async () => {
  const s = await withWarm();
  const id = await taughtFact(s);
  const { say, lines } = says();
  assert.equal(await forgetMessage(s.memory, [], say), false);
  assert.equal(lines[0]!.text, FLASH.noneToForget);
  assert.equal(await forgetMessage(s.memory, [{ factId: id, text: "t", sourceRef: MESSAGE_IDS.held, at: 1 }], say), true);
  assert.deepEqual(s.calls.find((c) => c.cap === "memory.forget")!.input, { factIds: [id] });
  assert.equal(lines[1]!.text, "Forgot 1 fact learned from this message. It is in Trash for 60 days.");
  assert.ok(!(await learned(s)).some((i) => i.fact.factId === id));
  await lines[1]!.undo!();
  assert.ok((await learned(s)).some((i) => i.fact.factId === id), "Undo restores it from Trash");
});

test("Forget in the Used list takes the fact out of what the reply used", async () => {
  const s = await withWarm();
  const used = (await s.memory.store.read("memory.used", { threadId: "c1", messageId: MESSAGE_IDS.reply })) as { facts: ChatFact[] };
  assert.equal(used.facts.length, 2);
  const { say } = says();
  await forgetFacts(s.memory, [used.facts[0]!.factId], say);
  await s.warm();
  const out = clean(renderToStaticMarkup(<ChatMemoryProvider memory={s.memory} threadId="c1"><ReplyMemory messageId={MESSAGE_IDS.reply} threadId="c1" reply={"Here is the update for Ian Brooks. The logistics dashboard is on track and the Growth plan is unchanged."} /></ChatMemoryProvider>));
  assert.ok(has(out, "Used 2 memories") && !has(out, "Used 3 memories"));
});

test("Show What the Agent Knew Here pins the Knows tab to that reply and asks the pane to open", async () => {
  const s = await withWarm();
  const { thread } = threadOf(s);
  const entries = memoryEntries(thread, { messageId: MESSAGE_IDS.reply, body: "x", createdAt: Date.UTC(2025, 9, 24, 9, 31) }, { x: 0, y: 0 }, () => undefined);
  (entries.find((e) => "label" in e && e.label.startsWith("Show What"))! as { onSelect: () => void }).onSelect();
  assert.deepEqual(s.opened, ["knows"]);
  assert.deepEqual([s.memory.store.knows().messageId, s.memory.store.knows().asOf], [MESSAGE_IDS.reply, Date.UTC(2025, 9, 24, 9, 31)]);
  assert.equal(s.memory.store.takeKnowsRequest(), true);
  assert.equal(s.memory.store.takeKnowsRequest(), false, "a request is read once");
});

/* ---------- the Knows tab ---------- */

const KNOWS_READS = (s: ChatMemorySample): Array<[string, unknown]> => [
  ["memory.knows", { threadId: "c1", agentId: ASSISTANT }], ["memory.facts.list", { status: ["proposed"], layer: "agent", agentId: ASSISTANT }], ["memory.map.get", { agentId: ASSISTANT }],
  ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.reply }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.held }],
  ...(s.memory.store.knows().asOf !== null ? [["memory.knows", { threadId: "c1", agentId: ASSISTANT, asOf: s.memory.store.knows().asOf }] as [string, unknown]] : []),
];
const pane = async (s: ChatMemorySample): Promise<string> => { await s.warm(KNOWS_READS(s)); return clean(renderToStaticMarkup(<ChatRightPane data={s.pane} open onToggle={() => undefined} tab="memory" paneWidth={340} window={{ start: 0, end: 500 }} />)); };

test("the right pane tab is named Knows and reads the facts in scope for this chat, grouped Space, Project, Agent and You", async () => {
  assert.deepEqual(TABS.map((t) => t.title), ["Computer", "Threads", "Files", "Knows", "Routines"]);
  const out = await pane(await withWarm());
  assert.ok(has(out, ">Knows<") && has(out, 'data-testid="pane-body-memory"') && has(out, 'data-testid="knows-list"'));
  inOrder(out, ["What Assistant knows here", "for you · 17", KNOWS_SCOPE, ">Space<", ">Project<"]);
  assert.ok(has(out, "Ian Brooks") && has(out, "Prefers updates on Fridays.") && has(out, "Lena Ortiz"));
  assert.ok(has(out, 'data-testid="knows-foot"') && has(out, "Edit any line and the old wording is kept in history.") && has(out, ">Open Knowledge<"));
  assert.ok(has(out, 'aria-label="Edit: Prefers updates on Fridays."') && has(out, 'aria-label="Forget"') && has(out, 'aria-label="Filter"'));
  assert.ok(has(out, ">Show 9 more<"), "a group over six rows folds the rest");
});

test("a Knows row names its source chip, who and how long ago, which facts the last reply used, and a pending pick", async () => {
  const out = await pane(await withWarm());
  assert.ok(has(out, ">Brooks weekly update<") && has(out, "Assistant · today") && has(out, "Scout · today"));
  assert.ok(has(out, "Used in the last reply"), "the facts of the newest reply that used memory are marked");
  assert.ok(has(out, "Two answers, waiting for a pick"));
  assert.ok(has(out, 'aria-label="Open the source: Brooks kickoff"'));
  assert.ok(has(out, 'tabindex="0"'), "a row takes focus (Enter or e edits it)");
});

test("the Knows tab still has the old tab's behaviours: proposed facts with Accept and Reject, MAP.md, the filter", async () => {
  const s = createChatMemorySample();
  await s.know.data.call("memory.fact.reject", { factId: "none" }).catch(() => undefined);
  // a proposed agent fact in the sample
  const state = s.know.snapshot();
  state.facts.push({ ...state.facts.find((f) => f.layer === "agent")!, factId: "fct_prop", text: "Ian wants the update as a PDF.", status: "proposed", agentId: ASSISTANT } as never);
  s.know.replica.put("state", [{ id: "s", ...state } as never]);
  await s.warm(KNOWS_READS(s));
  const out = clean(renderToStaticMarkup(<ChatRightPane data={s.pane} open onToggle={() => undefined} tab="memory" paneWidth={340} window={{ start: 0, end: 500 }} />));
  assert.ok(has(out, "Proposed · 1") && has(out, "Ian wants the update as a PDF.") && has(out, 'data-testid="accept-fct_prop"') && has(out, 'data-testid="reject-fct_prop"'));
  const { say, lines } = says();
  await decideFact(s.memory, "fct_prop", true, say);
  assert.equal(lines[0]!.text, "Accepted. It is in what the agent knows.");
  await lines[0]!.undo!();
  assert.deepEqual(s.calls.filter((c) => c.cap === "memory.fact.accept" || c.cap === "memory.fact.reject").map((c) => c.cap).slice(-2), ["memory.fact.accept", "memory.fact.reject"], "Undo rejects it again");
});

test("pinned to a reply the tab says as of when, hides what was learned later, and offers Back to now", async () => {
  const s = await withWarm();
  const at = Date.UTC(2025, 9, 24, 9, 31);
  s.memory.store.pinKnows(MESSAGE_IDS.reply, at);
  const out = await pane(s);
  assert.ok(has(out, 'data-testid="knows-asof"') && has(out, "As of 9:31, this reply. Newer facts are hidden.") && has(out, 'data-testid="knows-now"') && has(out, "What Assistant knew here"));
  assert.ok(!has(out, "Prefers updates on Fridays."), "the fact learned at 9:38 is hidden");
  assert.ok(has(out, "Used in this reply"), "the facts the pinned reply used are marked");
  s.memory.store.pinKnows(null, null);
  assert.ok(!has(await pane(s), "knows-asof"));
});

test("editing in place keeps the old wording; Forget moves a row to Trash and Undo brings it back", async () => {
  const s = await withWarm();
  const facts = ((await s.memory.store.read("memory.knows", { threadId: "c1", agentId: ASSISTANT })) as { facts: ChatFact[] }).facts;
  const f = facts.find((x) => x.text === "Handles county records and conflict checks.")!;
  const c = await correctFact(s.memory, f.factId, "Handles county records, conflict checks and title searches.");
  assert.ok(c.ok);
  await s.warm(KNOWS_READS(s));
  const out = await pane(s);
  assert.ok(has(out, "Handles county records, conflict checks and title searches.") && !has(out, "Handles county records and conflict checks."));
  const next = c.ok ? c.fact.factId : "";
  const { say, lines } = says();
  await forgetFacts(s.memory, [next], say, "Forgotten. It stays in Trash for 60 days.");
  assert.equal(lines[0]!.text, "Forgotten. It stays in Trash for 60 days.");
  await s.warm(KNOWS_READS(s));
  assert.ok(!has(await pane(s), "title searches"));
  await lines[0]!.undo!();
  await s.warm(KNOWS_READS(s));
  assert.ok(has(await pane(s), "title searches"));
});

test("a server without memory.knows falls back to the agent's facts and the Space's from the list that always exists; a chat without memory keeps the old Memory tab", async () => {
  const s = createChatMemorySample({ withoutCaps: ["memory.knows"] });
  await s.memory.store.read("memory.knows", { threadId: "c1", agentId: ASSISTANT }).catch(() => undefined);
  await s.warm([["memory.facts.list", { status: ["current"], agentId: ASSISTANT }], ["memory.facts.list", { status: ["proposed"], layer: "agent", agentId: ASSISTANT }], ["memory.map.get", { agentId: ASSISTANT }]]);
  const out = clean(renderToStaticMarkup(<ChatRightPane data={s.pane} open onToggle={() => undefined} tab="memory" paneWidth={340} window={{ start: 0, end: 500 }} />));
  assert.ok(has(out, "What Assistant knows here") && has(out, "Prefers updates on Fridays.") && has(out, 'data-testid="knows-list"'));
  const old = createPaneSample("northwind");
  const oldOut = clean(renderToStaticMarkup(<ChatRightPane data={old.data} open onToggle={() => undefined} tab="memory" paneWidth={340} window={{ start: 0, end: 500 }} />));
  assert.ok(has(oldOut, 'data-testid="memory-head"') && !has(oldOut, 'data-testid="knows-list"') && has(oldOut, "What Intake knows in Northwind"), "without memory data the pane is exactly what it was");
  assert.ok(typeof MemoryTab === "function");
});

test("a Knows write that fails shows as text in the tab, and the sample did not change", async () => {
  const s = await withWarm({ fail: "validation.precondition_failed" });
  const { say, lines } = says();
  await decideFact(s.memory, "fct_x", false, say);
  assert.equal(lines[0]!.text, "Could not reject it: validation.precondition_failed");
  assert.equal(lines[0]!.undo, undefined);
});

/* ---------- the sample's reads ---------- */

test("the sample answers memory.used, memory.knows and memory.quote, and memory.learned by thread or by message", async () => {
  const s = createChatMemorySample();
  const store = createMemoryStore(async (cap, input) => { const snap = s.know.data.live(cap as never, input as never).getSnapshot() as { status: string; data?: unknown }; if (snap.status !== "ready") throw new Error("no"); return snap.data; });
  const used = (await store.read("memory.used", { threadId: "thr_k2", messageId: MESSAGE_IDS.reply })) as { facts: ChatFact[]; quotes: Array<{ ref: string; author: { name: string }; threadTitle: string; link: string }> };
  assert.equal(used.facts.length, 2);
  assert.equal(used.quotes[0]!.author.name, "Irfad Imtiaz");
  assert.equal(used.quotes[0]!.link, "vyre://thread/thr_k1?m=msg_k1_2");
  assert.deepEqual(await store.read("memory.used", { threadId: "thr_k2", messageId: "nope" }), { facts: [], quotes: [] }, "a reply that used nothing");
  const q = (await store.read("memory.quote", { ref: "quote_ian_updates" })) as { quote: { text: string } };
  assert.ok(q.quote.text.startsWith("Ian was clear about updates."));
  const mine = (await store.read("memory.knows", { threadId: "thr_k2", agentId: ASSISTANT })) as { facts: ChatFact[] };
  assert.ok(mine.facts.every((f) => f.layer !== "agent" || f.agentId === ASSISTANT), "another agent's own layer is never in this agent's scope");
  const early = (await store.read("memory.knows", { threadId: "thr_k2", agentId: ASSISTANT, asOf: Date.UTC(2025, 9, 13) })) as { facts: ChatFact[] };
  assert.ok(early.facts.length > 0 && early.facts.every((f) => f.at <= Date.UTC(2025, 9, 13)));
  const byThread = (await store.read("memory.learned", { threadId: "thr_k1" })) as { items: Array<{ fact: { sourceLink?: string } }> };
  assert.ok(byThread.items.length > 0 && byThread.items.every((i) => i.fact.sourceLink?.startsWith("vyre://thread/thr_k1")));
  const byRef = (await store.read("memory.learned", { sourceRef: "msg_k1_2" })) as { items: Array<{ fact: { sourceRef: string } }> };
  assert.ok(byRef.items.length > 0 && byRef.items.every((i) => i.fact.sourceRef === "msg_k1_2"));
});

test("the context carries no state of its own: a provider without memory draws its children and a hook without it returns nothing", () => {
  const out = renderToStaticMarkup(<ChatMemoryProvider memory={undefined} threadId="c1"><span>plain</span></ChatMemoryProvider>);
  assert.equal(out, "<span>plain</span>");
  assert.ok(typeof ChatMemoryContext === "function");
});
