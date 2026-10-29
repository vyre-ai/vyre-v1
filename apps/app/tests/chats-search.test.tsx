// Search across every chat: the words and the pieces of a result, the page and its states, and how the Chats place gets there and back (Cmd+Shift+F, /search, the sidebar's search, a result that
// opens its chat on the message). The server half is modules/chat/tests/g27.test.ts; here `chat.search` is answered by a stand-in that returns what the contract says.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchPage, Row } from "../src/places/chats/search/SearchPage.tsx";
import type { SearchData } from "../src/places/chats/search/SearchPage.tsx";
import { chatTitle, highlight, statusLine, whenLine, wordsOf } from "../src/places/chats/search/model.ts";
import type { Hit, SearchOut } from "../src/places/chats/search/model.ts";
import { START, step } from "../src/places/chats/mounts/route.ts";
import { createGo } from "../src/places/chats/mounts/data.ts";
import { ChatsMounted } from "../src/places/chats/mounts/ChatsMounted.tsx";
import { PEOPLE, createMountSample } from "../src/places/chats/mounts/sample.ts";
import type { Act } from "../src/places/chats/mounts/route.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const names: Record<string, string> = { usr_irfad: "You", usr_maya: "Maya Chen", agt_intake: "Intake", agt_docs: "Docs" };
const nameOf = (id: string): string => names[id] ?? id;
const clock = { now: Date.UTC(2026, 9, 30, 12, 0), offsetMin: 0 };

const hit = (o: Partial<Hit> = {}): Hit => ({
  messageId: "msg_1", threadId: "thr_1", threadSeq: 12, author: { kind: "agent", id: "agt_intake" }, snippet: "The Rivera estate needs a trust amendment before Friday", at: Date.UTC(2026, 9, 29, 15, 30),
  score: 0.9, found: "keyword", thread: { kind: "chat", agentIds: ["agt_intake"], memberIds: ["usr_irfad"] }, ...o,
});
const data = (o: Partial<SearchData> = {}): SearchData => ({
  call: async () => ({ hits: [], meaning: false, sealedChats: 0, tookMs: 1 }), me: { id: "usr_irfad", name: "You" }, nameOf, kindOf: (id) => (id.startsWith("agt_") ? "agent" : "person"), clock: () => clock,
  query: "", openMessage: () => undefined, openThread: () => undefined, close: () => undefined, copy: () => undefined, ...o,
});

test("a chat is named by its channel, its title, or who it is with, never by an id", () => {
  assert.equal(chatTitle(hit({ thread: { kind: "channel", channelName: "intake", agentIds: [], memberIds: [] } }), nameOf, "usr_irfad"), "#intake");
  assert.equal(chatTitle(hit({ thread: { kind: "chat", title: "Plan the launch", agentIds: ["agt_intake"], memberIds: [] } }), nameOf, "usr_irfad"), "Plan the launch");
  assert.equal(chatTitle(hit(), nameOf, "usr_irfad"), "Intake");
  assert.equal(chatTitle(hit({ thread: { kind: "chat", agentIds: ["agt_intake", "agt_docs", "agt_x"], memberIds: [] } }), nameOf, "usr_irfad"), "Intake and 2 more");
  assert.equal(chatTitle(hit({ thread: { kind: "chat", agentIds: [], memberIds: ["usr_irfad", "usr_maya"] } }), nameOf, "usr_irfad"), "Maya Chen");
  assert.equal(chatTitle(hit({ thread: { kind: "chat", agentIds: [], memberIds: ["usr_irfad"] } }), nameOf, "usr_irfad"), "Chat");
});

test("the words of the question are marked in the snippet, case aside, and words side by side are one mark", () => {
  assert.deepEqual(wordsOf("Rivera, estate! the"), ["rivera", "estate", "the"]);
  assert.deepEqual(highlight("The Rivera estate needs a trust", "rivera estate"), [{ text: "The ", mark: false }, { text: "Rivera estate", mark: true }, { text: " needs a trust", mark: false }]);
  assert.deepEqual(highlight("Nothing here", "zzz"), [{ text: "Nothing here", mark: false }]);
  assert.deepEqual(highlight("plain", ""), [{ text: "plain", mark: false }]);
  assert.deepEqual(highlight("estate and Estate", "estate").filter((p) => p.mark).length, 2);
});

test("the line under the box says how the search ran and what it left out", () => {
  const out = (o: Partial<SearchOut>): SearchOut => ({ hits: [], meaning: false, sealedChats: 0, tookMs: 3, ...o });
  assert.equal(statusLine(null, false, ""), "");
  assert.equal(statusLine(null, true, "rivera"), "Searching");
  assert.equal(statusLine(out({ hits: [hit()] }), false, "rivera"), "1 result by words");
  assert.equal(statusLine(out({ hits: [hit(), hit({ messageId: "m2" })], meaning: true }), false, "rivera"), "2 results by words and meaning");
  assert.equal(statusLine(out({}), false, "rivera"), "Nothing found by words");
  assert.equal(statusLine(out({ hits: [hit()], sealedChats: 2 }), false, "rivera"), "1 result by words. 2 end-to-end chats are not searched here.");
  assert.equal(whenLine(Date.UTC(2026, 9, 29, 15, 30), clock), "Yesterday, 15:30");
});

test("a result row names who wrote it, the chat it is in and when, marks the matched words, and is a button for the keyboard and the pointer", () => {
  const html = clean(renderToStaticMarkup(<Row h={hit()} i={0} on query="rivera estate" data={data()} onHover={() => undefined} open={() => undefined} menu={{ show: () => undefined, element: null } as never} />));
  assert.ok(html.includes('data-testid="hit-msg_1"'));
  assert.ok(html.includes("in Intake"));
  assert.ok(html.includes("Yesterday, 15:30"));
  assert.ok(html.includes("Rivera estate"));
  assert.ok(!/usr_|agt_/.test(html.replace(/data-testid="[^"]*"/g, "").replace(/aria-label="[^"]*"/g, "")), "no ids in what is read");
  const similar = clean(renderToStaticMarkup(<Row h={hit({ found: "meaning" })} i={3} on={false} query="x" data={data()} onHover={() => undefined} open={() => undefined} menu={{ show: () => undefined, element: null } as never} />));
  assert.ok(similar.includes('data-testid="similar-3"'));
});

test("the page opens empty with a prompt, the box starts with the words it was given, and Back is a button", () => {
  const html = clean(renderToStaticMarkup(<SearchPage data={data()} />));
  assert.ok(html.includes('data-testid="chat-search"'));
  assert.ok(html.includes("Find anything said in any of your chats"));
  assert.ok(html.includes('data-testid="search-back"'));
  const typed = clean(renderToStaticMarkup(<SearchPage data={data({ query: "closing date" })} />));
  assert.ok(typed.includes('value="closing date"'));
  assert.ok(typed.includes('data-testid="search-clear"'));
});

test("the place gets to the search and back: the box remembers the chat it came from, a result opens its chat on the message", () => {
  const s = createMountSample();
  const acts: Act[] = [];
  const go = createGo(s.rt, (a) => void acts.push(a), (id) => PEOPLE.find((p) => p.id === id)?.name ?? id, () => undefined);
  const inChat = step(START, { t: "chat", threadId: "c1" });
  go.search("closing");
  const searching = step(inChat, acts[0]!);
  assert.deepEqual(searching.route, { view: "search", q: "closing", from: "c1" });
  go.search();
  assert.deepEqual(step(searching, acts[1]!).route, { view: "search", q: "", from: "c1" }, "searching again keeps where it came from");
  go.closeSearch();
  assert.deepEqual(step(searching, acts[2]!).route, { view: "chat", threadId: "c1" });
  go.message("c2", "m_77");
  const there = step(searching, acts[3]!);
  assert.deepEqual(there.route, { view: "chat", threadId: "c2", focus: "m_77" });
  assert.deepEqual(step(START, { t: "chat", threadId: "c2" }).route, { view: "chat", threadId: "c2" }, "an ordinary open carries no focus");
});

test("the Chats place draws the search page when asked, and its sidebar search goes there", () => {
  const s = createMountSample();
  const html = clean(renderToStaticMarkup(<ChatsMounted rt={s.rt} initial={step(step(START, { t: "chat", threadId: "c1" }), { t: "search", q: "" })} window={{ start: 0, end: 500 }} />));
  assert.ok(html.includes('data-testid="chat-search"'));
  assert.ok(!html.includes('data-testid="conversation"'), "the search takes the middle; the chat is back with Back or Escape");
});
