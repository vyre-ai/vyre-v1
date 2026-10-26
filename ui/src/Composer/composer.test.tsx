// ui/Composer: the who-answers line follows lib/route.ts, symbols open grouped pickers, send is optimistic and inside the send budget.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { route } from "../../../lib/route.ts";
import type { RouteMessage, RouteThread } from "../../../lib/route.ts";
import { menuEntries } from "../Menu/index.tsx";
import { isItem, isReportItem, isSeparator } from "../Menu/props.ts";
import {
  Composer,
  answerLine,
  applyPick,
  canSend,
  composerMenu,
  detectTrigger,
  enterAction,
  initialState,
  isPopupItem,
  linksIn,
  plainText,
  popupFor,
  popupMove,
  quality,
  prepare,
  sendNow,
  whoAnswers,
} from "./index.tsx";
import type { ComposerLists, PopupItem, WhoContext } from "./index.tsx";

const lists: ComposerLists = {
  agents: ["Intake", "Docs", "Billing"],
  people: ["Sam Patel", "Maya Chen", "Omar Haddad"],
  folders: ["Projects/Rivera matter", "Agents/Intake/work", "Marketing"],
  channels: ["general", "intake", "rivera-engagement"],
  records: [{ t: "Rivera Holdings", s: "Client", sealed: 2 }, "Pruitt & Co."],
  files: ["referral-letter.pdf", "intake-form.docx"],
  commands: [{ t: "later", s: "Follow up later" }, { t: "memory", s: "Open memory" }, { t: "fork", s: "Fork this chat" }],
  templates: [{ t: "Welcome note", body: "Welcome to the firm. " }],
  snippets: [{ t: "Office hours", body: "We are open 9 to 5, Monday to Friday. " }],
};

// The same table as lib/tests/route.test.ts: the thread has Intake leading, Docs and Billing listening.
const ctx: WhoContext = { lead: "Intake", listening: ["Docs", "Billing"], agents: ["Intake", "Docs", "Billing"], people: ["Sam Patel", "Maya Chen", "Omar Haddad"] };
const thread: RouteThread = { agents: [{ id: "Intake", mode: "lead" }, { id: "Docs", mode: "listen" }, { id: "Billing", mode: "listen" }] };
const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });

test("the who-answers line matches the route table: plain goes to the lead", () => {
  const w = whoAnswers("Can you look at Tuesday?", ctx);
  const r = route(thread, { author: person("me"), mentions: [] });
  assert.deepEqual(w.responders, r.responders);
  assert.equal(w.line, "Intake will reply");
  assert.equal(w.dim, false);
});

test("the who-answers line matches the route table: @mentioned agents answer, the lead does not", () => {
  const w = whoAnswers("@Docs please check this", ctx);
  assert.deepEqual(w.responders, route(thread, { author: person("me"), mentions: [agent("Docs")] }).responders);
  assert.equal(w.line, "Docs will reply");
});

test("two mentions answer in the order typed, without duplicates", () => {
  const w = whoAnswers("@Billing and @Docs, @Billing again", ctx);
  const r = route(thread, { author: person("me"), mentions: [agent("Billing"), agent("Docs"), agent("Billing")] });
  assert.deepEqual(w.responders, r.responders);
  assert.equal(w.line, "Billing and Docs will reply");
});

test("addressed to a person with @: nobody answers, not even the lead", () => {
  const w = whoAnswers("@Sam can you take this?", ctx);
  const r = route(thread, { author: person("me"), mentions: [person("Sam Patel")] });
  assert.deepEqual(w.responders, r.responders);
  assert.equal(w.reason, "person_addressed");
  assert.equal(w.line, "Sam will see this · no agent will reply");
  assert.equal(w.dim, true);
});

test("an agent mention beats a person mention in the same message", () => {
  const w = whoAnswers("@Sam and @Docs", ctx);
  assert.deepEqual(w.responders, route(thread, { author: person("me"), mentions: [person("Sam Patel"), agent("Docs")] }).responders);
  assert.equal(w.line, "Docs will reply");
});

test("no lead: an unaddressed message has no reply and the line says how to ask one", () => {
  const w = whoAnswers("hello", { listening: ["Docs"], agents: ["Docs"], people: [] });
  const r = route({ agents: [{ id: "Docs", mode: "listen" }] }, { author: person("me"), mentions: [] } satisfies RouteMessage);
  assert.deepEqual(w.responders, r.responders);
  assert.equal(w.line, "No agent will reply · type @ to ask one");
  assert.equal(w.dim, true);
});

test("a first name inside a longer word is not a mention", () => {
  assert.equal(whoAnswers("email@Docsmith.example", ctx).line, "Intake will reply");
});

test("the caller's own line shows until the text addresses someone", () => {
  assert.equal(answerLine("hello", "Start a channel with Maya", ctx).line, "Start a channel with Maya");
  assert.equal(answerLine("@Docs hi", "Start a channel with Maya", ctx).line, "Docs will reply");
  assert.equal(answerLine("anything", "Intake will reply", undefined).line, "Intake will reply");
});

test("the rendered composer shows the who line, the field, the symbols and an up-arrow send", () => {
  const html = renderToStaticMarkup(<Composer whoWillAnswer="Intake will reply" lead="Intake" lists={lists} placeholder="Message Intake" />);
  assert.match(html, /Intake will reply/);
  assert.match(html, /data-testid="composer-who"/);
  assert.match(html, /placeholder="Message Intake"/);
  assert.match(html, /data-testid="composer-symbol-at"/);
  assert.match(html, /data-testid="composer-symbol-hash"/);
  assert.match(html, /data-testid="composer-symbol-slash"/);
  assert.match(html, /aria-label="Send"/);
  assert.match(html, /aria-disabled="true"/, "the arrow is disabled until there is text");
});

test("the symbols prop narrows the buttons and the recipients slot only mounts when it sends outside", () => {
  const some = renderToStaticMarkup(<Composer whoWillAnswer="x" symbols={["at"]} />);
  assert.match(some, /composer-symbol-at/);
  assert.doesNotMatch(some, /composer-symbol-hash|composer-symbol-slash/);
  assert.doesNotMatch(some, /composer-recipients/);
  const out = renderToStaticMarkup(<Composer whoWillAnswer="x" sendsOutside recipients={<span>To field</span>} />);
  assert.match(out, /composer-recipients/);
  assert.ok(out.indexOf("To field") < out.indexOf("composer-field"), "recipients sit above the field");
});

test("a working agent turns an empty send into Stop and a typed send into Queue with Interrupt beside it", () => {
  const stop = renderToStaticMarkup(<Composer whoWillAnswer="Intake is working" working />);
  assert.match(stop, /aria-label="Stop"/);
  assert.doesNotMatch(stop, /composer-interrupt/);
  const typed = renderToStaticMarkup(<Composer whoWillAnswer="Intake is working" working value="Use the new intake form" />);
  assert.match(typed, /aria-label="Queue"/);
  assert.match(typed, /composer-interrupt/);
});

test("chips, files, folder and the engine line render in the tray", () => {
  const html = renderToStaticMarkup(<Composer whoWillAnswer="x" folder="Projects/Rivera matter" chips={[{ kind: "Record", name: "Rivera Holdings" }]} attachments={[{ name: "referral-letter.pdf" }]} engineLine="Switched to Codex, picked up from the summary and the last 20 turns" />);
  assert.match(html, /Projects\/Rivera matter/);
  assert.match(html, /Rivera Holdings/);
  assert.match(html, /referral-letter\.pdf/);
  assert.match(html, /Switched to Codex/);
  assert.match(html, /composer-engine-line/);
});

test("the matcher tiers: exact, prefix, word start, inside, letters in order", () => {
  assert.equal(quality("intake", prepare("Intake")), 5);
  assert.equal(quality("int", prepare("Intake")), 4);
  assert.equal(quality("mat", prepare("Rivera matter")), 3);
  assert.equal(quality("ake", prepare("Intake")), 1);
  assert.equal(quality("rvm", prepare("rivera-engagement")), 0.5);
  assert.equal(quality("qz", prepare("rivera-engagement")), 0);
  assert.equal(quality("zz", prepare("Intake")), 0);
  assert.equal(quality("", prepare("Intake")), 1, "an empty query lists everything a little");
});

test("detectTrigger finds @ # / and [[ before the cursor and ignores paths", () => {
  assert.deepEqual(detectTrigger("hi @Do", 6), { ch: "@", start: 3, end: 6, query: "Do" });
  assert.deepEqual(detectTrigger("#riv", 4), { ch: "#", start: 0, end: 4, query: "riv" });
  assert.deepEqual(detectTrigger("/", 1), { ch: "/", start: 0, end: 1, query: "" });
  assert.deepEqual(detectTrigger("see [[Riv", 9), { ch: "[[", start: 4, end: 9, query: "Riv" });
  assert.equal(detectTrigger("/Users/alex", 11), null);
  assert.equal(detectTrigger("mail me@x.com", 13), null);
  assert.equal(detectTrigger("hi @Do now", 10), null, "a space ends the trigger");
  assert.equal(detectTrigger("hi @Do", 6, ["hash"]), null, "a symbol the composer does not offer never opens");
});

test("@ lists agents then people, narrowed by typing, at most eight", () => {
  const all = popupFor({ ch: "@", start: 0, end: 1, query: "" }, lists, true);
  assert.deepEqual(all.filter((e) => !isPopupItem(e)), [{ head: "Agents" }, { head: "People" }]);
  assert.equal(all.filter(isPopupItem).length, 6);
  const narrow = popupFor({ ch: "@", start: 0, end: 2, query: "ma" }, lists, true).filter(isPopupItem);
  assert.deepEqual(narrow.map((i) => i.label), ["Maya Chen", "Omar Haddad"]);
});

test("# groups are Folders, Channels, Records, Files; folders first when an agent leads, channels first with people", () => {
  const heads = (agentChat: boolean) => popupFor({ ch: "#", start: 0, end: 1, query: "" }, lists, agentChat).filter((e) => !isPopupItem(e)).map((e) => ("head" in e ? e.head : ""));
  assert.deepEqual(heads(true), ["Folders", "Channels", "Records", "Files"]);
  assert.deepEqual(heads(false), ["Channels", "Folders", "Records", "Files"]);
  const narrowed = popupFor({ ch: "#", start: 0, end: 4, query: "riv" }, lists, true).filter(isPopupItem).map((i) => i.label);
  assert.deepEqual(narrowed, ["Projects/Rivera matter", "rivera-engagement", "Rivera Holdings"]);
});

test("/ lists commands, templates and snippets", () => {
  const items = popupFor({ ch: "/", start: 0, end: 1, query: "" }, lists, true);
  assert.deepEqual(items.filter((e) => !isPopupItem(e)), [{ head: "Commands" }, { head: "Templates" }, { head: "Snippets" }]);
  assert.deepEqual(popupFor({ ch: "/", start: 0, end: 3, query: "off" }, lists, true).filter(isPopupItem).map((i) => i.label), ["Office hours"]);
});

test("arrow keys skip headings and wrap", () => {
  const entries = popupFor({ ch: "@", start: 0, end: 1, query: "" }, lists, true);
  const first = popupMove(entries, -1, 1);
  assert.ok(entries[first] && isPopupItem(entries[first]));
  const last = popupMove(entries, first, -1);
  assert.ok(last > first);
  assert.equal(popupMove(entries, last, 1), first);
});

const pickOf = (trigger: ReturnType<typeof detectTrigger>, text: string, label: string): { next: ReturnType<typeof initialState>; effect: ReturnType<typeof applyPick>["effect"] } => {
  assert.ok(trigger);
  const item = popupFor(trigger, lists, true).filter(isPopupItem).find((i) => i.label === label) as PopupItem;
  assert.ok(item, `${label} is in the popup`);
  return applyPick({ ...initialState(text), cursor: text.length }, trigger, item);
};

test("picking @ writes the first name and a space", () => {
  const text = "ask @Do";
  const r = pickOf(detectTrigger(text, text.length), text, "Docs");
  assert.equal(r.next.text, "ask @Docs ");
  assert.equal(r.next.cursor, 10);
});

test("picking a folder with # sets the folder chip and the thread folder; picking a record adds a chip", () => {
  const folder = pickOf(detectTrigger("#Mark", 5), "#Mark", "Marketing");
  assert.equal(folder.next.text, "");
  assert.equal(folder.next.folder, "Marketing");
  assert.deepEqual(folder.effect, { kind: "folder", folder: "Marketing" });
  const record = pickOf(detectTrigger("look at #Riv", 12), "look at #Riv", "Rivera Holdings");
  assert.deepEqual(record.next.chips, [{ kind: "Record", name: "Rivera Holdings" }]);
  assert.equal(record.next.text, "look at ");
});

test("[[ links a record in the text and the send carries the link", () => {
  const r = pickOf(detectTrigger("see [[Riv", 9), "see [[Riv", "Rivera Holdings");
  assert.equal(r.next.text, "see [[Rivera Holdings]] ");
  const sent = sendNow(r.next, "Intake will reply");
  assert.deepEqual(sent?.payload.links, ["Rivera Holdings"]);
  assert.deepEqual(linksIn("a [[One]] b [[Two words]]"), ["One", "Two words"]);
});

test("/ runs a command, and a template or snippet inserts its text", () => {
  const cmd = pickOf(detectTrigger("/fo", 3), "/fo", "fork");
  assert.deepEqual(cmd.effect, { kind: "command", name: "fork" });
  assert.equal(cmd.next.text, "");
  const tpl = pickOf(detectTrigger("/wel", 4), "/wel", "Welcome note");
  assert.equal(tpl.next.text, "Welcome to the firm. ");
  assert.equal(tpl.effect.kind, "none");
});

test("send clears the field, the tray and keeps the folder, in the same call", () => {
  const state = { ...initialState("Hello @Docs"), chips: [{ kind: "Record", name: "Rivera Holdings" }], files: [{ name: "a.pdf" }], folder: "Marketing" };
  const sent = sendNow(state, "Docs will reply", "queue");
  assert.ok(sent);
  assert.equal(sent.payload.text, "Hello @Docs");
  assert.equal(sent.payload.answers, "Docs will reply");
  assert.equal(sent.payload.folder, "Marketing");
  assert.equal(sent.next.text, "");
  assert.deepEqual(sent.next.chips, []);
  assert.deepEqual(sent.next.files, []);
  assert.equal(sent.next.folder, "Marketing");
  assert.equal(sendNow(initialState("   "), "x"), null, "an empty message does not send");
  assert.equal(canSend({ ...initialState(""), files: [{ name: "a.pdf" }] }), true, "a file alone can send");
});

test("Enter sends, Shift+Enter writes a line; email mode needs Cmd or Ctrl; Cmd+Enter interrupts a working agent", () => {
  assert.equal(enterAction({}, true, false), "send");
  assert.equal(enterAction({ shiftKey: true }, true, false), "newline");
  assert.equal(enterAction({ isComposing: true }, true, false), "newline");
  assert.equal(enterAction({}, false, false), "newline");
  assert.equal(enterAction({ metaKey: true }, false, false), "send");
  assert.equal(enterAction({ metaKey: true }, true, true), "interrupt");
  assert.equal(enterAction({}, true, true), "send");
});

test("the right-click menu ends with Report a problem, after a separator, and every item has an icon", () => {
  const entries = menuEntries({ items: composerMenu({ attach: () => undefined, paste: () => undefined, clear: () => undefined }) });
  const last = entries[entries.length - 1];
  assert.ok(last && isReportItem(last));
  const before = entries[entries.length - 2];
  assert.ok(before && isSeparator(before));
  const items = entries.filter(isItem);
  assert.deepEqual(items.map((i) => i.label), ["Attach Files…", "Paste as Plain Text", "Clear Draft", "Report a problem"]);
  assert.ok(items.every((i) => typeof i.icon === "string" && i.icon.length > 0));
});

test("plain-text paste keeps line breaks and drops control characters", () => {
  assert.equal(plainText("a\r\nb\u0007\tc"), "a\nb c");
});
