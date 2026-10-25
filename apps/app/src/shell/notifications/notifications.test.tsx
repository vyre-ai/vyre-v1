// P-L9_16 notifications UI: Interrupt banners with inline actions, collapse by key, three at most, place marks, the offline queue line. (runs with the packet)
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationBanners } from "./Banners.tsx";
import { QueueIndicator } from "./QueueIndicator.tsx";
import { BANNER_TTL_MS, BannerStack, MAX_BANNERS, collapseKey, placeMarks, queueLine, wantsBanner } from "./model.ts";
import type { Notification } from "./model.ts";

const n = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, kind: "approval.requested", level: "interrupt", place: "chats", title: `Approval needed: ${id}`, count: 1, at: 1, actions: [{ label: "Approve", cap: "tasks.act" }, { label: "Send back", cap: "tasks.act" }], spaceId: "spc_1", ...over,
});

test("only an unseen Interrupt notification gets a banner", () => {
  assert.ok(wantsBanner(n("a")));
  assert.ok(!wantsBanner(n("b", { level: "badge" })));
  assert.ok(!wantsBanner(n("c", { level: "digest" })));
  assert.ok(!wantsBanner(n("d", { seenAt: 5 })));
});

test("the same key collapses to one banner with a count, newest on top", () => {
  const s = new BannerStack(() => 0);
  const subject = { type: "thread" as const, id: "thr_1" };
  s.push(n("a", { kind: "mention", subject, title: "Maya mentioned you in Intake" }));
  s.push(n("b", { kind: "approval.requested", title: "Send 12 invoices" }));
  s.push(n("c", { kind: "mention", subject, title: "Maya mentioned you again" }));
  const v = s.getSnapshot().visible;
  assert.equal(v.length, 2);
  assert.equal(v[0]?.item.id, "c");
  assert.equal(v[0]?.count, 2);
  assert.equal(v[1]?.item.id, "b");
  assert.equal(collapseKey(n("x", { title: "t" })), "approval.requested|t");
});

test("three banners at most; the rest wait and come forward as others go", () => {
  const s = new BannerStack(() => 0);
  for (let i = 1; i <= 5; i++) s.push(n(`n${i}`, { title: `T${i}` }));
  assert.equal(s.getSnapshot().visible.length, MAX_BANNERS);
  assert.equal(s.getSnapshot().waiting, 2);
  assert.deepEqual(s.getSnapshot().visible.map((b) => b.item.id), ["n5", "n4", "n3"]);
  s.dismiss(s.getSnapshot().visible[0]?.key ?? "");
  assert.deepEqual(s.getSnapshot().visible.map((b) => b.item.id), ["n4", "n3", "n2"]);
  assert.equal(s.getSnapshot().waiting, 1);
});

test("a banner leaves after its time unless held; seen elsewhere clears it", () => {
  let t = 0;
  const s = new BannerStack(() => t);
  s.push(n("a", { title: "A" }));
  s.push(n("b", { title: "B" }));
  t = BANNER_TTL_MS - 1;
  s.expire();
  assert.equal(s.getSnapshot().visible.length, 2);
  t = BANNER_TTL_MS + 1;
  s.expire(s.getSnapshot().visible[0]?.key);
  assert.deepEqual(s.getSnapshot().visible.map((b) => b.item.id), ["b"], "the hovered banner stays");
  s.seen(["b"]);
  assert.equal(s.getSnapshot().visible.length, 0);
});

test("the banner shows the title, a count for repeats, and the notification's actions inline", () => {
  const s = new BannerStack(() => 0);
  s.push(n("a", { title: "Approval needed: Send 12 invoices", body: "$18,420 total" }));
  s.push(n("a2", { title: "Approval needed: Send 12 invoices", body: "$18,420 total" }));
  const html = renderToStaticMarkup(<NotificationBanners stack={s} onAction={() => {}} onOpen={() => {}} />);
  assert.match(html, /Approval needed: Send 12 invoices/);
  assert.match(html, /2 new/);
  assert.match(html, /data-testid="banner-action-Approve"/);
  assert.match(html, /data-testid="banner-action-Send back"/);
  assert.match(html, /aria-label="Dismiss"/);
  assert.equal(renderToStaticMarkup(<NotificationBanners stack={new BannerStack()} onAction={() => {}} onOpen={() => {}} />), "");
});

test("places: a dot for anything unseen, a rail count only for Needs you and direct conversations", () => {
  const marks = placeMarks([
    n("a"), n("b", { kind: "dm", place: "chats" }), n("c", { kind: "task.assigned", level: "badge", place: "home" }),
    n("d", { kind: "run.failed", level: "badge", place: "automations", count: 2 }), n("e", { kind: "digest.away", level: "digest", place: "home" }), n("f", { seenAt: 9, place: "inbox" }),
  ]);
  assert.deepEqual(marks.chats, { dot: true, count: 2, sidebar: 2 });
  assert.deepEqual(marks.home, { dot: true, count: 0, sidebar: 1 });
  assert.deepEqual(marks.automations, { dot: true, count: 0, sidebar: 2 });
  assert.equal(marks.inbox, undefined, "seen items and digest items leave no mark");
});

test("the title bar says what waits offline", () => {
  assert.equal(queueLine(true, 0), null);
  assert.deepEqual(queueLine(false, 3), { text: "Offline, 3 changes waiting", tone: "attention" });
  assert.deepEqual(queueLine(false, 1), { text: "Offline, 1 change waiting", tone: "attention" });
  assert.deepEqual(queueLine(false, 0), { text: "Offline", tone: "attention" });
  assert.deepEqual(queueLine(true, 2), { text: "Sending 2 changes", tone: "quiet" });
  assert.equal(queueLine(true, 2, 1)?.text, "1 conflict to look at");
  assert.match(renderToStaticMarkup(<QueueIndicator online={false} waiting={3} onOpen={() => {}} />), /Offline, 3 changes waiting/);
  assert.equal(renderToStaticMarkup(<QueueIndicator online waiting={0} onOpen={() => {}} />), "");
});
