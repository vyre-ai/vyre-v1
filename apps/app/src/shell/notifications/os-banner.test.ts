// The desktop app's operating system banner (os-banner.ts) and its shell door (os-shell.ts): one banner for what is new and not where the person is looking, the notice's own words, a link that
// opens the place through the desktop link the app already routes, and the badge from the Needs you count.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BANNERS, bannerLink, osBanners, windowFocused } from "./os-banner.ts";
import type { BannerView } from "./os-banner.ts";
import { bannersRefused, osShell } from "./os-shell.ts";
import { routeDesktopLink } from "../session/desktop.ts";
import type { Notification } from "./model.ts";

const ADDRESS = "https://northwind.example";
const n = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, kind: "mention", level: "interrupt", place: "chats", title: "Dana mentioned you in #intake", body: "the private words of the message", count: 1, at: 1, actions: [], spaceId: "spc_1",
  subject: { type: "thread", id: `thr_${id}` }, ...over,
}) as Notification;
const away: BannerView = { focused: false, here: () => false, address: ADDRESS };

test("nothing is bannered for what was already there when the app opened; a new notice gets one banner", () => {
  const first = osBanners([n("a")], null, away);
  assert.deepEqual(first.banners, [], "the first read only remembers");
  const second = osBanners([n("a"), n("b")], first.seen, away);
  assert.deepEqual(second.banners.map((b) => b.title), ["Dana mentioned you in #intake"]);
  assert.deepEqual(osBanners([n("a"), n("b")], second.seen, away).banners, [], "the same notice again is not bannered again");
});

test("a notice whose count rose (a burst that collapsed into it) is bannered again, with the count; one whose count did not is not", () => {
  const before = osBanners([n("a", { kind: "reply.thread", title: "Maya replied in #intake" })], null, away).seen;
  const r = osBanners([n("a", { kind: "reply.thread", title: "Maya replied in #intake", count: 3 })], before, away);
  assert.deepEqual(r.banners.map((b) => b.title), ["Maya replied in #intake · 3 new"]);
});

test("the window focused on the place the notice is about: no banner; focused on another place: one; not focused: one", () => {
  const seen = osBanners([], null, away).seen;
  const placeRow = n("p", { subject: undefined, place: "inbox", kind: "member.joined", title: "Eve joined" });
  const onInbox: BannerView = { focused: true, here: (x) => !x.subject && x.place === "inbox", address: ADDRESS };
  const onChats: BannerView = { focused: true, here: (x) => !x.subject && x.place === "chats", address: ADDRESS };
  assert.deepEqual(osBanners([placeRow], seen, onInbox).banners, [], "looking at it");
  assert.equal(osBanners([placeRow], seen, onChats).banners.length, 1, "looking at another place");
  assert.equal(osBanners([placeRow], seen, { ...onInbox, focused: false }).banners.length, 1, "the window is in the background");
});

test("a kind the person keeps off the desktop (phone only) gets no banner", () => {
  const seen = osBanners([], null, away).seen;
  assert.deepEqual(osBanners([n("a")], seen, { ...away, allows: (k) => k !== "mention" }).banners, []);
});

test("the banner says what the notice line says and never the body (a private message, a Vault value)", () => {
  const [b] = osBanners([n("a")], new Map(), away).banners;
  assert.equal(b!.title, "Dana mentioned you in #intake");
  assert.equal(b!.body, "");
  assert.ok(!JSON.stringify(b).includes("private words"));
});

test("many notices at once: three banners, then one that says how many more and opens the Inbox", () => {
  const many = ["a", "b", "c", "d", "e"].map((id) => n(id));
  const r = osBanners(many, new Map(), away);
  assert.equal(r.banners.length, MAX_BANNERS + 1);
  assert.equal(r.banners.at(-1)!.title, "2 more notices in Vyre");
  assert.match(r.banners.at(-1)!.link, /kind=place&id=inbox$/);
});

test("pressing it opens the thing through the desktop link the app already routes (then reach); a notice about a place opens that place", () => {
  const thread = routeDesktopLink({ action: "open", params: Object.fromEntries(new URL(bannerLink(n("a"), ADDRESS)).searchParams) });
  assert.deepEqual(thread, { kind: "signin", address: ADDRESS, item: { kind: "thread", id: "thr_a" } });
  const place = routeDesktopLink({ action: "open", params: Object.fromEntries(new URL(bannerLink({ place: "inbox" }, ADDRESS)).searchParams) });
  assert.deepEqual(place, { kind: "signin", address: ADDRESS, item: { kind: "place", id: "inbox" } });
  // a subject no link opens (the Space itself) falls back to the row's place
  assert.match(bannerLink({ subject: { type: "space", id: "spc_1" }, place: "console" }, ADDRESS), /kind=place&id=console$/);
});

test("the window counts as focused only when it is visible and has focus", () => {
  assert.equal(windowFocused({ hasFocus: () => true, visibilityState: "visible" }), true);
  assert.equal(windowFocused({ hasFocus: () => false, visibilityState: "visible" }), false);
  assert.equal(windowFocused({ hasFocus: () => true, visibilityState: "hidden" }), false);
  assert.equal(windowFocused(undefined), false);
});

test("the shell door: a banner goes to the shell's notify; the badge goes to set_badge once per change and clears at 0; a refused banner is remembered for Settings; none in a browser", async () => {
  assert.equal(osShell({}), null, "a browser has no shell");
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  let refuse = false;
  const shell = osShell({ __TAURI__: { core: { invoke: async (cmd: string, args?: Record<string, unknown>) => { calls.push([cmd, args]); if (cmd === "notify" && refuse) throw new Error("not allowed"); return null; } } } })!;
  shell.badge(3); shell.badge(3); shell.badge(0);
  shell.notify({ title: "Dana mentioned you", body: "", link: "vyre://open?address=x" });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.map(([c, a]) => `${c}:${JSON.stringify(a)}`), ['set_badge:{"count":3}', 'set_badge:{"count":0}', 'notify:{"title":"Dana mentioned you","body":"","link":"vyre://open?address=x"}']);
  assert.equal(bannersRefused.get(), false);
  refuse = true;
  shell.notify({ title: "t", body: "", link: "vyre://open?address=x" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bannersRefused.get(), true, "Settings, Notifications says banners are off");
  bannersRefused.set(false);
});
