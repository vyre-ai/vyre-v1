import test from "node:test";
import assert from "node:assert/strict";
import {
  chatAboutOf,
  desktopLine,
  desktopOnly,
  TAB_VIEW,
  entryFor,
  headerBack,
  isAskEntry,
  phoneStart,
  placeOf,
  subjectEntry,
  tabOf,
} from "./mobile-map.ts";
import { formatHash, parseHash, placeForSubject, subjectTypes } from "../hash/hash.ts";
import { openAsk } from "../providers/ask.ts";

test("phone: a tab's place is its first screen, an opened item is <type>:<id> under that tab", () => {
  assert.deepEqual(entryFor("chats", ""), { tab: "chats", screen: "chats" });
  assert.deepEqual(entryFor("chats", "subject=thread%3Athr_1"), { tab: "chats", screen: "thread:thr_1" });
  assert.deepEqual(entryFor("records", "subject=record%3Arec_1"), { tab: "records", screen: "record:rec_1" });
  assert.equal(entryFor("settings", "")?.tab, "you");
});

// Changed for AUTOMATIONS-BUILD-RC29 round four (lead, 15 Nov): Automations are on the phone (first page, list, All runs, a run and its fix); building says it opens on a computer. The Console and a Journey still open the Chat-about-it screen.
test("phone: Automations are a place under You, an automation and a run open in it; the Console and a Journey are the Chat-about-it screen", () => {
  assert.deepEqual(entryFor("automations", ""), { tab: "you", screen: "you:automations", title: "Automations" });
  assert.deepEqual(placeOf(entryFor("automations", "")), { place: "automations", hash: "" });
  assert.equal(desktopOnly(entryFor("automations", "")), null);
  assert.equal(placeOf(subjectEntry("records", { type: "automation", id: "aut_1" }))?.place, "automations");
  assert.equal(placeOf(entryFor("home", "subject=run%3Arun_1"))?.place, "automations");
  for (const [place, hash] of [
    ["console", ""],
    ["console", "members"],
  ] as const) {
    const e = entryFor(place, hash);
    assert.equal(placeOf(e), null, `${place}#${hash} draws no place`);
    assert.deepEqual(desktopOnly(e), { place, hash }, `${place}#${hash} keeps what it named`);
    assert.equal(e.tab, "chats");
  }
  assert.deepEqual(desktopOnly(subjectEntry("records", { type: "journey", id: "jrn_1" })), {
    place: "automations",
    hash: "subject=journey%3Ajrn_1",
  });
  assert.deepEqual(subjectEntry("records", { type: "record", id: "rec_1" }), {
    tab: "records",
    screen: "record:rec_1",
  });
  // the item goes with the chat: the subject when the link named one, else the place and its screen
  assert.deepEqual(chatAboutOf("automations", "subject=automation%3Aaut_1"), { kind: "automation", id: "aut_1" });
  assert.deepEqual(chatAboutOf("automations", ""), { kind: "automations", id: "automations" });
  assert.deepEqual(chatAboutOf("console", "screen=console.members"), { kind: "console", id: "console.members" });
  assert.match(desktopLine("console"), /^The Console opens on a computer\./);
  assert.match(desktopLine("automations"), /^Automations open on a computer\./);
  assert.deepEqual(phoneStart("console", ""), { initialTab: "chats", initialEntry: entryFor("console", "") });
});

test("phone: an Ask link keeps its whole route, and its thread takes its place", () => {
  const hash = formatHash({ screen: "chats.conversation", args: { with: "agt_assistant", about: "automation:aut_1" } });
  const e = entryFor("chats", hash);
  assert.equal(isAskEntry(e), true);
  assert.deepEqual(placeOf(e), { place: "chats", hash });
  assert.equal(headerBack(e), true, "the conversation draws its own Back");
  assert.deepEqual(entryFor("chats", ""), { tab: "chats", screen: "chats" }, "the Chats tab itself is unchanged");
});

test("phone: a screen maps back to the place and hash that draw it", () => {
  assert.deepEqual(placeOf({ tab: "chats", screen: "chats" }), { place: "chats", hash: "" });
  assert.deepEqual(placeOf({ tab: "chats", screen: "thread:thr_1" }), {
    place: "chats",
    hash: "subject=thread%3Athr_1",
  });
  assert.deepEqual(placeOf({ tab: "files", screen: "file:fil_1" }), { place: "files", hash: "subject=file%3Afil_1" });
  assert.deepEqual(placeOf({ tab: "you", screen: "you:settings" }), { place: "settings", hash: "" });
  assert.equal(placeOf({ tab: "you", screen: "you" }), null);
  assert.equal(placeOf({ tab: "chats", screen: "spaceship:1" }), null);
  assert.equal(tabOf("vault"), "you");
});

test("phone Apps preserve detail/create hashes and return to the same editor", () => {
  const hash = "screen=apps.form-settings&selected=frm_fixture";
  const entry = entryFor("apps", hash);
  assert.deepEqual(placeOf(entry), { place: "apps", hash });
  assert.deepEqual(placeOf(entryFor("apps", "screen=apps.forms&create=true")), {
    place: "apps",
    hash: "screen=apps.forms&create=true",
  });
  assert.equal(placeOf({ tab: "you", screen: "apps:%ZZ" }), null);
  assert.deepEqual(placeOf(entryFor("vault", "")), { place: "vault", hash: "" }, "the Vault hangs off You on a phone");
  assert.equal(entryFor("vault", "").tab, "you");
});

test("phone task links preserve the canonical task when opened from an old Home URL", () => {
  const entry = entryFor("home", "screen=tasks.page&taskId=tsk_fixture");
  assert.deepEqual(entry, { tab: "chats", screen: "task:tsk_fixture" });
  assert.deepEqual(placeOf(entry), { place: "chats", hash: "subject=task%3Atsk_fixture" });
});

test("Tasks lives on the Chats tab: its list has a screen, and that screen draws the Tasks page in Chats", () => {
  const list = entryFor("chats", "screen=tasks.my-work");
  assert.deepEqual(list, { tab: "chats", screen: "tasks:list", title: "Tasks" });
  assert.deepEqual(placeOf(list), { place: "chats", hash: "screen=tasks.my-work" });
  const task = entryFor("chats", "subject=task:tsk_1");
  assert.equal(task.tab, "chats");
  assert.deepEqual(placeOf(task), { place: "chats", hash: "subject=task%3Atsk_1" });
});

test("the phone starts where a link points: a place on its own tab, an item on top of Chats, Chats when there is nowhere else", () => {
  assert.deepEqual(phoneStart("records", ""), { initialTab: "records" });
  assert.deepEqual(phoneStart("chats", ""), { initialTab: "chats" });
  assert.deepEqual(phoneStart("chats", "subject=task:tsk_1"), {
    initialTab: "chats",
    initialEntry: { tab: "chats", screen: "task:tsk_1" },
  });
  assert.deepEqual(phoneStart("records", "subject=record:rec_1"), {
    initialTab: "chats",
    initialEntry: { tab: "records", screen: "record:rec_1" },
  });
});

test("Chat about it opens an Ask with the assistant carrying the item, and the phone shows that Ask", () => {
  const opened: Array<{ screen?: string; args?: Record<string, unknown> }> = [];
  const rt = {
    assistant: { id: "agt_assistant" },
    open: (t: { screen?: string; args?: Record<string, unknown> }) => {
      opened.push(t);
    },
  } as unknown as Parameters<typeof openAsk>[0];
  const away = desktopOnly(subjectEntry("records", { type: "journey", id: "jrn_1" }))!;
  openAsk(rt, "assistant", chatAboutOf(away.place, away.hash));
  assert.deepEqual(opened, [{ screen: "chats.conversation", args: { with: "agt_assistant", about: "journey:jrn_1" } }]);
  const shown = entryFor("chats", formatHash(opened[0]!));
  assert.equal(isAskEntry(shown), true);
  assert.equal(parseHash(placeOf(shown)!.hash).args["about"], "journey:jrn_1");
});

test("Settings and an open Apps page draw their own top bar, so the phone shows one bar, not the shell's '< You' above Settings' own back (polish audit X2)", async () => {
  const { ownsHeaderScreen } = await import("./mobile-map.ts");
  assert.equal(ownsHeaderScreen("you:settings", ""), true);
  assert.equal(ownsHeaderScreen("apps:site:sit_1", "x"), true);
  assert.equal(ownsHeaderScreen("apps:list", ""), false);
  assert.equal(ownsHeaderScreen("you", undefined), false);
  assert.equal(ownsHeaderScreen("chats", undefined), false);
});

test("New project on the phone keeps its request: Records opens on Projects with a new row, not on the last type (owner walk review O3)", () => {
  const hash = "screen=records.projects&create=true";
  const e = entryFor("records", hash);
  assert.equal(e.tab, "records");
  assert.deepEqual(placeOf(e), { place: "records", hash });
});

test("an agent's page is a screen of its own on the Chats tab, so the phone draws the Back bar over it, and the screen maps back to the page", () => {
  const e = entryFor("chats", "screen=chats.agent-page&agentId=agt_1");
  assert.deepEqual([e.tab, e.screen], ["chats", "agent:agt_1"]);
  assert.notEqual(e.screen, e.tab, "not the tab's own screen, so it opens on top and has a way back");
  assert.equal(headerBack(e), false, "the shell's Back bar, not a conversation header");
  assert.deepEqual(placeOf(e), { place: "chats", hash: "screen=chats.agent-page&agentId=agt_1" });
});

test("Settings on a phone draws its own back chevron (list, then out), as the conversations do", () => {
  assert.equal(headerBack({ tab: "you", screen: "you:settings" }), true);
  assert.equal(headerBack({ tab: "you", screen: "you" }), false);
});

test("phone: a link to a view of a tab's place keeps its hash (the Inbox's Unmatched list, Meetings), so the place opens on that view", () => {
  for (const [place, hash] of [
    ["inbox", "screen=inbox.unmatched"],
    ["inbox", "main=meetings"],
    ["records", "screen=records.search&q=x"],
  ] as const) {
    const e = entryFor(place, hash);
    assert.equal(e.tab, place);
    assert.notEqual(e.screen, place, "an entry of its own, not the place's first screen");
    assert.deepEqual(placeOf(e), { place, hash }, "the hash comes back whole");
  }
  // nothing to keep: the tab's own first screen, as before
  assert.deepEqual(entryFor("inbox", ""), { tab: "inbox", screen: "inbox" });
  assert.deepEqual(placeOf(entryFor("inbox", "")), { place: "inbox", hash: "" });
  // a subject still opens its item, and the Replies link its own screen
  assert.equal(entryFor("inbox", "subject=conversation%3Acnv_1").screen, "conversation:cnv_1");
  assert.equal(entryFor("inbox", "screen=inbox.replies").screen, "replies:list");
});

test("phone: the tab-view screen kind collides with no subject type, so no opened item can be mistaken for a link to a view, and every item still round-trips", () => {
  const types = subjectTypes();
  assert.ok(types.length > 20, "the list of subject types is read");
  assert.ok(!types.includes(TAB_VIEW), "no subject type is called the tab-view prefix");
  for (const type of types) {
    assert.ok(!`${type}:x`.startsWith(`${TAB_VIEW}:`), `${type}:id is not a tab-view screen`);
    const place = placeForSubject(type);
    if (place === null || !["chats", "inbox", "records", "files"].includes(place)) continue;
    const e = entryFor(place as never, `subject=${type}%3A${type}_1`);
    assert.ok(e.screen.startsWith(`${type}:`), `${type}: the screen is the item's (${e.screen})`);
    const back = placeOf(e);
    assert.ok(back !== null, `${type}: the phone has a place to draw it (${e.screen})`);
    assert.equal(back!.place, place, `${type} comes back to its own place`);
  }
  // the three the reviewer named
  assert.deepEqual(placeOf({ tab: "records", screen: "view:vw_123" }), {
    place: "records",
    hash: "subject=view%3Avw_123",
  });
  for (const [place, hash] of [
    ["records", "screen=records.table&type=company"],
    ["chats", "screen=chats.goals"],
    ["files", "screen=files.list&folder=fld_1"],
  ] as const) {
    const e = entryFor(place, hash);
    assert.ok(e.screen.startsWith(`${TAB_VIEW}:${place}:`), `${hash} is a tab view`);
    assert.deepEqual(placeOf(e), { place, hash }, `${hash} comes back whole`);
  }
});
