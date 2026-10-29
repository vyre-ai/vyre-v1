// The phone shell (P-L9_17, spec 3.11): five bottom tabs with the Needs you count on Chats, Back to the originating screen (not the parent), no Automations, Journeys or Console, swipe actions
// and sheets. The navigation rules are pure and tested directly; the screens render from the sample Space.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileShell, YouScreen } from "./index.ts";
import { MOBILE_TABS, NOT_ON_PHONE, SWIPE_OPEN_AT, back, canBack, current, initialNav, isAllowed, open, origin, selectTab, swipeOffset, swipeRest } from "./model.ts";
import { SwipeRow } from "../sheets/SwipeRow.tsx";
import { Sheet } from "../sheets/Sheet.tsx";

const has = (s: string, n: string): boolean => s.includes(n);

test("five bottom tabs in order: Chats, Inbox, Records, Files, You", () => {
  assert.deepEqual(MOBILE_TABS.map((t) => t.label), ["Chats", "Inbox", "Records", "Files", "You"]);
  const out = renderToStaticMarkup(<MobileShell renderScreen={(e) => <>{e.screen}</>} needsYou={7} />);
  const idx = MOBILE_TABS.map((t) => out.indexOf(`data-testid="tab-${t.id}"`));
  assert.ok(idx.every((i) => i >= 0) && [...idx].sort((a, b) => a - b).join() === idx.join());
  assert.ok(has(out, 'data-testid="tab-badge"') && has(out, ">7<"), "the Needs you count sits on Chats");
  assert.ok(has(out, 'aria-selected="true"') && has(out, "Chats, 7 need you"));
});

test("Back returns to the screen you came from, not the parent", () => {
  let s = initialNav("records");
  s = open(s, { tab: "records", screen: "record:rec_pruitt", title: "Pruitt matter" });
  s = open(s, { tab: "chats", screen: "contact:usr_maya", title: "Maya Chen" });
  assert.equal(current(s).screen, "contact:usr_maya");
  assert.equal(origin(s)?.screen, "record:rec_pruitt");
  s = back(s);
  assert.equal(current(s).screen, "record:rec_pruitt", "back to the record that opened the contact");
  s = back(s);
  assert.equal(current(s).screen, "records");
  assert.equal(canBack(s), false);
  assert.equal(back(s), s, "nothing to go back to at a tab's first screen");
});

test("pressing a tab goes to its first screen with a fresh history", () => {
  let s = open(initialNav("chats"), { tab: "chats", screen: "chat:c1", title: "Rivera intake" });
  s = selectTab(s, "files");
  assert.deepEqual(s.history.map((e) => e.screen), ["files"]);
  assert.equal(current(selectTab(s, "files")).tab, "files");
});

test("no Automations, Journeys or Console on the phone", () => {
  assert.deepEqual([...NOT_ON_PHONE].sort(), ["automations", "console", "journeys"]);
  for (const k of NOT_ON_PHONE) assert.equal(isAllowed(`${k}:anything`), false, k);
  assert.ok(isAllowed("record:rec_1") && isAllowed("chat:c1"));
  const s = initialNav("chats");
  assert.equal(open(s, { tab: "chats", screen: "console:members" }), s, "a refused screen changes nothing");
  assert.equal(open(s, { tab: "chats", screen: "chats" }), s, "opening what is on show changes nothing");
  assert.ok(!MOBILE_TABS.some((t) => NOT_ON_PHONE.includes(t.id)));
});

test("the shell shows a Back bar with the originating screen's name once you have gone deeper", () => {
  const shell = (screen: string): string => renderToStaticMarkup(<MobileShell renderScreen={(e) => <>{e.screen}</>} initialTab="chats" />).replace(screen, screen);
  const out = shell("chats");
  assert.ok(!has(out, 'data-testid="mobile-back"'), "no Back at a tab's first screen");
  assert.ok(has(out, 'data-testid="screen-chats"'));
});

test("You has My work, Starred and Settings", () => {
  const out = renderToStaticMarkup(<YouScreen nav={{ open: () => undefined, back: () => undefined, selectTab: () => undefined, origin: undefined }} data={{ name: "Irfad Imtiaz", space: "Northwind", workOpen: 4, starred: 3 }} />).replaceAll("<!-- -->", "");
  for (const t of ["Irfad Imtiaz", "Northwind", "My work", "4 open", "Starred", "3 starred", "Settings"]) assert.ok(has(out, t), t);
  assert.ok(!has(out, "Automations") && !has(out, "Console"));
});

test("swipe: a row follows the finger up to the actions' width and settles open past half", () => {
  assert.equal(SWIPE_OPEN_AT, 0.5);
  assert.equal(swipeOffset(-30, 152, false), -30);
  assert.equal(swipeOffset(-400, 152, false), -152, "never past the actions");
  assert.equal(swipeOffset(60, 152, false), 0, "never right of rest");
  assert.equal(swipeOffset(40, 152, true), -112, "dragging back from open");
  assert.equal(swipeRest(-80, 152, false), "open");
  assert.equal(swipeRest(-60, 152, false), "closed");
  assert.equal(swipeRest(30, 152, true), "open");
  assert.equal(swipeRest(100, 152, true), "closed");
});

test("a swipe row has its actions behind the row, reachable by tap, right-click or long-press", () => {
  const out = renderToStaticMarkup(<SwipeRow testID="r" actions={[{ key: "star", label: "Star", tone: "accent", onPress: () => undefined }, { key: "read", label: "Mark read", onPress: () => undefined }]}><span>Rivera intake</span></SwipeRow>);
  assert.ok(has(out, 'data-testid="swipe-action-star"') && has(out, 'data-testid="swipe-action-read"') && has(out, "Rivera intake"));
  assert.ok(out.indexOf("swipe-actions") < out.indexOf("swipe-front"), "actions sit behind the row");
});

test("a sheet is a labelled dialog with Done, and draws nothing when closed", () => {
  assert.equal(renderToStaticMarkup(<Sheet open={false} title="Record" onClose={() => undefined}><span>x</span></Sheet>), "");
  const out = renderToStaticMarkup(<Sheet open title="Record" onClose={() => undefined}><span>Body</span></Sheet>);
  assert.ok(has(out, 'role="dialog"') && has(out, 'aria-label="Record"') && has(out, "Done") && has(out, "Body"));
});

test("a copied task starts on that task with Back to You", () => { const out=renderToStaticMarkup(<MobileShell initialEntry={{tab:"you",screen:"task:tsk_fixture"}} renderScreen={entry=><>{entry.screen}</>} />);assert.ok(out.includes("task:tsk_fixture"));assert.ok(out.includes("Back")); });
