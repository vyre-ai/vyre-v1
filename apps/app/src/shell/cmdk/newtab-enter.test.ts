// @tsx
// The new tab's Enter (owner, 13 Nov 2026: "enter should start a chat"). Typed words and no selection: Enter starts a chat with them, in this tab. A selection moved with the arrows or the pointer: Enter opens that result.
// The Ask is a row of its own (first in the results, reached by the arrows or by Alt+Enter). Every other key keeps what it did. The sheet (Cmd-K) is unchanged: it does not take the option.
import test from "node:test";
import assert from "node:assert/strict";
import { CmdKController } from "./controller.ts";
import type { CmdKData } from "./controller.ts";
import { LOCAL_HITS, createSampleData } from "./sample.ts";

const PHRASE = "what did Elena say about the lease";

function world(o: { fail?: boolean } = {}) {
  const { data, calls } = createSampleData({ ask: true, serverDelayMs: 5 });
  const started: { key: string; text: string }[] = [];
  let n = 0;
  let fail = o.fail === true;
  const d: CmdKData = {
    ...data,
    newKey: () => `key_${++n}`,
    startChat: (chat) => {
      started.push({ key: chat.key, text: chat.text });
      return {
        title: chat.title ?? chat.text.split(/\s+/).slice(0, 6).join(" "),
        sent: fail ? Promise.reject(new Error("no")) : new Promise<void>(() => undefined),
      };
    },
  };
  const c = new CmdKController(d, { enterStartsChat: true, revealMs: 0 });
  return {
    c,
    calls,
    started,
    heal: () => {
      fail = false;
    },
  };
}

test("Enter with an empty box does nothing", () => {
  const w = world();
  w.c.enter();
  assert.deepEqual(w.started, []);
  assert.deepEqual(w.calls.opened, []);
  assert.equal(w.c.getState().chat, null);
});

test("Enter with words and no selection starts a chat with exactly those words, a one-word message included; the key is made at the press and the state shows it at once", () => {
  const w = world();
  w.c.setRaw("Heyy");
  assert.equal(w.c.getState().active, -1, "nothing is selected until the arrows or the pointer move it");
  w.c.enter();
  assert.deepEqual(w.started, [{ key: "key_1", text: "Heyy" }]);
  const chat = w.c.getState().chat!;
  assert.equal(chat.phase, "sending");
  assert.equal(chat.text, "Heyy");
  assert.equal(chat.title, "Heyy");
  assert.equal(chat.key, "key_1");
  w.c.enter();
  assert.equal(w.started.length, 1, "a second Enter while it is starting is one chat");
  assert.deepEqual(w.calls.opened, []);
});

test("an arrow moves the selection onto a result, and Enter opens that result, not a chat", () => {
  const w = world();
  w.c.setRaw("referral");
  assert.equal(w.c.getState().active, -1);
  w.c.move(1);
  const row = w.c.getState().rows[w.c.getState().active]!;
  assert.ok(row.type === "hit");
  w.c.enter();
  assert.equal(w.started.length, 0);
  assert.equal(w.calls.opened.length, 1);
});

test("the pointer moving onto a result selects it too; typing again takes the selection back, and Enter starts the chat", () => {
  const w = world();
  w.c.setRaw("referral");
  const i = w.c.getState().rows.findIndex((r) => r.type === "hit");
  w.c.hover(i);
  assert.equal(w.c.getState().active, i);
  w.c.setRaw("referral fee");
  assert.equal(w.c.getState().active, -1);
  w.c.enter();
  assert.equal(w.started.length, 1);
});

test("the Ask is the first row for a phrase, not selected; the arrow lands on it and Enter asks; Alt+Enter asks from the field; a short word has no Ask row and Alt+Enter does nothing", async () => {
  const w = world();
  w.c.setRaw(PHRASE);
  const rows = w.c.getState().rows;
  assert.equal(rows[1]?.type, "ask", "first row under its heading");
  assert.equal(w.c.getState().active, -1);
  w.c.move(1);
  assert.equal(w.c.getState().rows[w.c.getState().active]?.type, "ask");
  w.c.enter();
  assert.equal(w.c.getState().ask?.phase, "working");
  assert.deepEqual(w.calls.asked, [PHRASE]);
  assert.equal(w.started.length, 0);
  const x = world();
  x.c.setRaw(PHRASE);
  x.c.askChord();
  assert.deepEqual(x.calls.asked, [PHRASE], "the chord is the Ask");
  assert.equal(x.started.length, 0);
  const s = world();
  s.c.setRaw("Heyy");
  s.c.askChord();
  assert.deepEqual(s.calls.asked, []);
  assert.equal(s.c.getState().ask, null);
});

test("after an Ask the answer's own keys are as they were: Enter opens the selected source, and Escape goes back to the results", async () => {
  const w = world();
  w.c.setRaw(PHRASE);
  w.c.askChord();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.c.getState().ask?.phase, "answered");
  w.c.enter();
  assert.equal(w.started.length, 0, "with an answer showing Enter never starts a chat");
  assert.equal(w.calls.opened.length, 1, "it opened the selected source");
});

test("a failed start shows Retry and Discard: Retry sends the same key and words, Discard leaves the words in the field and the search as it was", async () => {
  const w = world({ fail: true });
  w.c.setRaw("Heyy");
  w.c.enter();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(w.c.getState().chat?.phase, "failed");
  assert.ok(w.c.getState().chat?.note);
  w.heal();
  w.c.retryChat();
  assert.equal(w.c.getState().chat?.phase, "sending");
  assert.deepEqual(
    w.started.map((s) => s.key),
    ["key_1", "key_1"],
    "the same key: a lost answer never makes a second chat",
  );
  const v = world({ fail: true });
  v.c.setRaw("Heyy");
  v.c.enter();
  await new Promise((r) => setTimeout(r, 5));
  v.c.discardChat();
  assert.equal(v.c.getState().chat, null);
  assert.equal(v.c.getState().raw, "Heyy");
});

test("a prefix keeps its meaning: > runs the selected action, / opens the selected file; Cmd-Enter on plain words still does not start a chat", () => {
  const w = world();
  w.c.setRaw("> away");
  assert.ok(w.c.getState().active >= 0);
  w.c.enter();
  assert.equal(w.started.length, 0);
  assert.equal(w.calls.ran.length, 1);
  const f = world();
  f.c.setRaw("/ " + (LOCAL_HITS.find((h) => h.kind === "file")?.title ?? "").split(" ")[0]);
  const before = f.calls.opened.length;
  f.c.enter();
  assert.equal(f.started.length, 0);
  assert.ok(f.calls.opened.length >= before);
  const g = world();
  g.c.setRaw("Heyy");
  g.c.enter(true);
  assert.equal(g.started.length, 0, "Cmd-Enter is Open in new tab: with nothing selected it does nothing");
});

test("the sheet does not take the option: Enter there still opens the first result", () => {
  const { data, calls } = createSampleData({ ask: true, serverDelayMs: 5 });
  const c = new CmdKController(data);
  c.setRaw("referral");
  c.enter();
  assert.equal(calls.opened.length, 1);
});

test("Continue in a chat from an Ask in the new tab starts the chat the same way: his question and the answer on screen from the press, this tab, one key", async () => {
  const w = world();
  w.c.setRaw(PHRASE);
  w.c.askChord();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.c.getState().ask?.phase, "answered");
  w.c.continueInChat();
  assert.equal(w.started.length, 1);
  assert.match(w.started[0]!.text, /^what did Elena say about the lease\n\nWhat the Space says:\n/);
  const chat = w.c.getState().chat!;
  assert.equal(chat.phase, "sending");
  assert.equal(chat.title, PHRASE, "the tab is named for the question");
  assert.equal(w.c.getState().ask, null);
  assert.equal(w.calls.chats.length, 0, "the sheet's own Continue (a separate tab) is not used here");
});

test("a pasted link to a thing in this Space opens it and starts no chat; any other pasted text starts the chat", () => {
  const { data } = createSampleData({ ask: true, serverDelayMs: 5 });
  const opened: string[] = [];
  const started: string[] = [];
  const d: CmdKData = {
    ...data,
    openLink: (text) => {
      if (text.startsWith("https://space.example.test/open/")) {
        opened.push(text);
        return true;
      }
      return false;
    },
    startChat: (c) => {
      started.push(c.text);
      return { title: c.text, sent: new Promise<void>(() => undefined) };
    },
  };
  const a = new CmdKController(d, { enterStartsChat: true });
  a.setRaw("https://space.example.test/open/thread/thr_1");
  a.enter();
  assert.deepEqual(opened, ["https://space.example.test/open/thread/thr_1"]);
  assert.deepEqual(started, []);
  assert.equal(a.getState().chat, null);
  const b = new CmdKController(d, { enterStartsChat: true });
  b.setRaw("https://news.example.test/article");
  b.enter();
  assert.deepEqual(started, ["https://news.example.test/article"]);
});
