// Inbox on the rail only once something flows in (owner 2 Nov): the rail with and without a source in a Team and a Personal Space, the answer from the mailbox, calendar and number
// reads and their change events, the reveal on the first connect, Inbox leaving on the last disconnect, the last known answer kept while the reads load, an Inbox tab or link that
// still opens, and Cmd-K's Inbox and Connect email.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../client/src/index.ts";
import { NORTHWIND, PERSONAL } from "../spaces/model.ts";
import { createShellHub } from "../spaces/hub.ts";
import { memoryStorage } from "../spaces/sample.tsx";
import { createGateSearch, gateActions, shellHitTarget, shellHits } from "../cmdk/gate.ts";
import type { GateNav } from "../cmdk/gate.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { kitById, railFor, railPlaces } from "./kits.ts";
import { Rail } from "./Rail.tsx";
import { INBOX_SOURCE_QUERIES, INBOX_TIP, followInboxSources, inboxAnswer, knownInbox, rememberInbox, seedInbox, takeInboxTip } from "./inbox-sources.ts";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node).replaceAll("<!-- -->", "");
const ready = <T,>(data: T): QueryState<T> => ({ status: "ready", data });
const LOADING: QueryState<unknown> = { status: "loading" };
const FAILED: QueryState<unknown> = { status: "loading", error: { message: "no such module" } };
const none = { mail: ready({ mailboxes: [] }), cal: ready({ calendars: [] }), nums: ready({ numbers: [] }) };

/** Three live queries the test moves by hand, as the live link does when a change event arrives. */
function liveSources(): { screens: ScreenHooks; set(which: "mail" | "cal" | "nums", s: QueryState<unknown>): void; subscribed(): number } {
  const snaps: Record<"mail" | "cal" | "nums", QueryState<unknown>> = { mail: LOADING, cal: LOADING, nums: LOADING };
  // one entry per subscription (the same listener may watch all three)
  const listeners: { l: () => void }[] = [];
  const q = (which: "mail" | "cal" | "nums"): LiveQuery<unknown> => ({ subscribe: (l) => { const e = { l }; listeners.push(e); return () => { listeners.splice(listeners.indexOf(e), 1); }; }, getSnapshot: () => snaps[which] });
  const by: Record<string, "mail" | "cal" | "nums"> = { [INBOX_SOURCE_QUERIES[0].join(".")]: "mail", [INBOX_SOURCE_QUERIES[1].join(".")]: "cal", [INBOX_SOURCE_QUERIES[2].join(".")]: "nums" };
  return {
    screens: { query: (screen, name) => { const w = by[`${screen}.${name}`]; if (!w) throw new Error(`unknown ${screen}.${name}`); return q(w); } },
    set: (which, s) => { snaps[which] = s; for (const e of [...listeners]) e.l(); },
    subscribed: () => listeners.length,
  };
}

test("the rail has Inbox only with something flowing in, in a Team Space and in a Personal Space; unknown leaves the Kit as it is", () => {
  for (const space of [NORTHWIND, PERSONAL]) {
    const rail = (inbox?: boolean) => railPlaces(railFor({ kit: kitById(space.kit), console: space.console, ...(inbox === undefined ? {} : { inbox }), counts: {}, dots: {}, active: "chats" }));
    assert.ok(!rail(false).includes("inbox"), `${space.name}: nothing connected, no Inbox`);
    assert.ok(rail(true).includes("inbox"), `${space.name}: something flows in, Inbox`);
    assert.ok(rail(undefined).includes("inbox"), `${space.name}: not known yet, the Kit's rail`);
    assert.equal(rail(true).indexOf("inbox"), rail(undefined).indexOf("inbox"), "Inbox comes back in the Kit's own place");
    assert.deepEqual(rail(false), rail(true).filter((p) => p !== "inbox"), "nothing else moves");
  }
  assert.deepEqual(railPlaces(railFor({ kit: kitById("northwind"), console: true, inbox: true, counts: {}, dots: {}, active: "chats" })).slice(0, 3), ["chats", "inbox", "records"]);
});

test("the answer: a live mailbox, any calendar or a number assigned to you; none of them is false only once all three have answered", () => {
  const me = "usr_irfad";
  assert.equal(inboxAnswer([LOADING, LOADING, LOADING], me), null, "nothing read yet");
  assert.equal(inboxAnswer([none.mail, LOADING, LOADING], me), null, "one empty answer is not all of them");
  assert.equal(inboxAnswer([none.mail, none.cal, none.nums], me), false);
  assert.equal(inboxAnswer([ready({ mailboxes: [{ state: "pending" }] }), LOADING, LOADING], me), true, "a pending mailbox (a company connection reaching a member) counts at once");
  assert.equal(inboxAnswer([ready({ mailboxes: [{ state: "disconnected" }] }), none.cal, none.nums], me), false, "a disconnected mailbox is not flowing");
  assert.equal(inboxAnswer([LOADING, ready({ calendars: [{ id: "cld_1" }] }), LOADING], me), true);
  assert.equal(inboxAnswer([none.mail, none.cal, ready({ numbers: [{ assigneeKind: "person", assigneeId: me, state: "active" }] })], me), true);
  assert.equal(inboxAnswer([none.mail, none.cal, ready({ numbers: [{ assigneeKind: "person", assigneeId: "usr_maya", state: "active" }, { assigneeKind: "agent", assigneeId: me, state: "active" }] })], me), false, "someone else's number, or an agent's, is not yours");
  assert.equal(inboxAnswer([none.mail, none.cal, ready({ numbers: [{ assigneeKind: "person", assigneeId: me, state: "released" }] })], me), false);
  assert.equal(inboxAnswer([none.mail, none.cal, FAILED], me), false, "a Space without telephony still answers");
});

test("the signal is read on open and on change events only: it says the answer once, then only when it changes", () => {
  const src = liveSources();
  const heard: boolean[] = [];
  const stop = followInboxSources(src.screens, "usr_irfad", (has) => heard.push(has));
  assert.equal(src.subscribed(), 3, "one subscription per read");
  assert.deepEqual(heard, [], "while the reads load nothing is said, so the shell keeps what it had");
  src.set("mail", none.mail);
  src.set("cal", none.cal);
  assert.deepEqual(heard, []);
  src.set("nums", none.nums);
  assert.deepEqual(heard, [false], "all three answered: nothing flows in");
  src.set("cal", none.cal);
  assert.deepEqual(heard, [false], "the same answer again says nothing");
  src.set("mail", ready({ mailboxes: [{ state: "pending" }] }));
  assert.deepEqual(heard, [false, true], "the first mailbox arrives with its change event");
  src.set("mail", ready({ mailboxes: [{ state: "syncing" }] }));
  assert.deepEqual(heard, [false, true]);
  src.set("mail", ready({ mailboxes: [] }));
  assert.deepEqual(heard, [false, true, false], "the last one goes");
  stop();
  assert.equal(src.subscribed(), 0, "stopping lets go of the reads");
});

test("the last known answer is kept per person and Space while the reads load, and the tip is shown once", () => {
  const store = memoryStorage();
  assert.equal(knownInbox(store, "usr_irfad", "nw"), null, "never seen on this device");
  assert.deepEqual(seedInbox(NORTHWIND, store, "usr_irfad"), NORTHWIND, "no answer anywhere: the card as it is");
  rememberInbox(store, "usr_irfad", "nw", false);
  assert.equal(knownInbox(store, "usr_irfad", "nw"), false);
  assert.equal(knownInbox(store, "usr_maya", "nw"), null, "another person on the same device has their own");
  assert.equal(seedInbox(NORTHWIND, store, "usr_irfad").inbox, false, "the next launch opens with Inbox off the rail");
  rememberInbox(store, "usr_irfad", "nw", true);
  assert.equal(seedInbox(NORTHWIND, store, "usr_irfad").inbox, true);
  assert.equal(takeInboxTip(store, "usr_irfad", "nw"), true);
  assert.equal(takeInboxTip(store, "usr_irfad", "nw"), false, "once");
  assert.equal(takeInboxTip(store, "usr_irfad", "me"), true, "per Space");
});

test("the hub: Inbox joins the rail with a reveal and its tip on the first connect, settles, and leaves on the last disconnect; a link to Inbox still opens it", () => {
  const hub = createShellHub({ spaces: [{ ...NORTHWIND, inbox: false }, { ...PERSONAL, inbox: false }], openId: "nw", personId: "usr_irfad", deviceId: "mac", storage: null });
  const places = (): string[] => railPlaces(hub.rail());
  assert.ok(!places().includes("inbox"), "the last known answer: nothing connected");
  let emits = 0;
  hub.subscribe(() => { emits += 1; });
  hub.setInbox(false);
  assert.equal(emits, 0, "the same answer redraws nothing");
  hub.setInbox(true, { tip: INBOX_TIP });
  assert.ok(places().includes("inbox"));
  assert.deepEqual(hub.state().fresh, { place: "inbox", tip: INBOX_TIP });
  hub.settle();
  assert.equal(hub.state().fresh, null);
  hub.setInbox(false);
  assert.ok(!places().includes("inbox"), "the last source went");
  hub.go("inbox", "subject=conversation:cnv_1");
  assert.equal(hub.state().place, "inbox", "a saved tab, a link or an agent still opens Inbox");
  assert.ok(!places().includes("inbox"), "it opens outside the rail");
  hub.setInbox(true);
  assert.equal(hub.state().fresh, null, "without reveal (a launch that already had it) there is nothing to animate");
});

test("a hub that never knew (no answer on this device) keeps the Kit's Inbox and never animates it in", () => {
  const hub = createShellHub({ spaces: [NORTHWIND], openId: "nw", personId: "usr_irfad", deviceId: "mac", storage: null });
  assert.ok(railPlaces(hub.rail()).includes("inbox"));
  hub.setInbox(true, { tip: INBOX_TIP });
  assert.equal(hub.state().fresh, null, "it was already there");
  hub.setInbox(false);
  assert.ok(!railPlaces(hub.rail()).includes("inbox"));
});

test("a fresh place comes in folded and fades open, with its quiet tip beside it; the plain rail has neither", () => {
  const groups = railFor({ kit: kitById("northwind"), console: true, inbox: true, counts: {}, dots: {}, active: "chats" });
  const out = html(<Rail groups={groups} active="chats" onSelect={() => undefined} fresh={{ place: "inbox", tip: INBOX_TIP }} />);
  assert.ok(out.includes('data-testid="rail-fresh-inbox"') && out.includes('data-testid="rail-inbox"'), "the button inside its reveal");
  assert.ok(out.includes('data-testid="rail-tip-inbox"') && out.includes(INBOX_TIP));
  assert.match(out.slice(out.indexOf('data-testid="rail-fresh-inbox"'), out.indexOf('data-testid="rail-inbox"')), /max-height:0px/, "the first frame is folded, so it opens rather than blinks");
  assert.ok(!/rail-count-inbox|rail-dot-inbox/.test(out), "no badge with it");
  const plain = html(<Rail groups={groups} active="chats" onSelect={() => undefined} />);
  assert.ok(plain.includes('data-testid="rail-inbox"') && !plain.includes("rail-fresh-") && !plain.includes(INBOX_TIP));
  const noTip = html(<Rail groups={groups} active="chats" onSelect={() => undefined} fresh={{ place: "inbox", tip: null }} />);
  assert.ok(noTip.includes('data-testid="rail-fresh-inbox"') && !noTip.includes("rail-tip-inbox"), "a second reveal comes without the tip");
});

test("Cmd-K: Inbox and Connect email open the Email and calendar screen while nothing flows in; Inbox opens Inbox once something does", () => {
  const went: { place: string; hash?: string }[] = [];
  const nav: GateNav = { go: (place, hash) => void went.push(hash === undefined ? { place } : { place, hash }), newTab: () => null, flash: () => undefined, setAway: () => undefined, setOnline: () => undefined };
  const idle: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };
  const calls: string[] = [];
  const rt = { principals: idle, screens: { query: () => idle }, connection: { get: () => "online", subscribe: () => () => undefined }, space: { id: "nw", kind: "team", name: "Northwind" }, call: async (cap: string) => { calls.push(cap); return {}; } } as unknown as ShellRuntime;
  const state: { away: boolean; offline: boolean; inbox?: boolean } = { away: false, offline: false, inbox: false };
  const data = createGateSearch({ runtime: rt, nav, state, recent: () => [] });
  assert.deepEqual(data.local("", null).map((h) => h.title), [], "an empty search stays the replica's");
  const inbox = data.local("inbox", null).find((h) => h.title === "Inbox")!;
  const email = data.local("connect email", null).find((h) => h.title === "Connect email")!;
  assert.ok(inbox && email, "both answer what was typed");
  assert.equal(data.local("email", null).find((h) => h.title === "Inbox")?.snippet, "Connect email and calendar");
  data.open(inbox, { newTab: false });
  data.open(email, { newTab: false });
  state.inbox = true;
  data.open(inbox, { newTab: false });
  assert.deepEqual(went, [{ place: "settings", hash: "page=mail" }, { place: "settings", hash: "page=mail" }, { place: "inbox" }]);
  data.recordOpened(inbox);
  assert.deepEqual(calls, [], "a shell result is not a search item: nothing is recorded on the server");
  const act = gateActions({ away: false, offline: false }).find((a) => a.key === "mail.connect")!;
  assert.equal(act.title, "Connect email");
  data.runAction(act);
  assert.deepEqual(went.at(-1), { place: "settings", hash: "page=mail" });
  assert.equal(shellHitTarget({ ...shellHits({})[0]!, id: "rec_1", kind: "record" }, {}), null, "any other result opens as it always did");
});
