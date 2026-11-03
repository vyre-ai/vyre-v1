// The banners of the open Space (audit Threads 1): a launch learns what is already unseen and raises nothing; a new reply, mention or direct message raises a banner; a burst in one thread
// comes back as the same row with a higher count and raises it again; pressing it opens the thread it is about.
import test from "node:test";
import assert from "node:assert/strict";
import { BannerStack, arrivals, bannerTarget } from "./model.ts";
import type { Notification } from "./model.ts";

const n = (id: string, count = 1, over: Partial<Notification> = {}): Notification => ({ id, kind: "reply.thread", level: "interrupt", place: "chats", title: "Maya replied in #intake", count, at: 1, actions: [{ label: "Reply", cap: "chat.post" }], spaceId: "spc_1", subject: { type: "thread", id: "thr_1" }, ...over }) as Notification;

test("the first read raises nothing; what arrives after it does, once; a burst raises its row again with the count", () => {
  const a = arrivals(null, [n("ntf_old")]);
  assert.deepEqual(a.raise, [], "a launch does not replay what was already there");
  const b = arrivals(a.known, [n("ntf_old"), n("ntf_new")]);
  assert.deepEqual(b.raise.map((x) => x.id), ["ntf_new"]);
  const c = arrivals(b.known, [n("ntf_old"), n("ntf_new")]);
  assert.deepEqual(c.raise, [], "nothing new, nothing raised");
  const d = arrivals(c.known, [n("ntf_old"), n("ntf_new", 3, { title: "3 new replies in #intake" })]);
  assert.deepEqual(d.raise.map((x) => [x.id, x.count]), [["ntf_new", 3]]);
  const stack = new BannerStack(() => 0);
  for (const x of [...b.raise, ...d.raise]) stack.push(x);
  assert.equal(stack.getSnapshot().visible.length, 1, "one banner per thread");
  assert.equal(stack.getSnapshot().visible[0]!.item.title, "3 new replies in #intake");
  assert.equal(stack.getSnapshot().visible[0]!.count, 3, "the row's own count, not added to itself");
  assert.deepEqual(arrivals(c.known, [n("ntf_badge", 1, { level: "badge" })]).raise, [], "a badge is a dot, not a banner");
});

test("a banner opens what it is about, else its place", () => {
  assert.deepEqual(bannerTarget(n("x")), { subject: { type: "thread", id: "thr_1" } });
  assert.deepEqual(bannerTarget({ place: "home" }), { place: "home" });
});
