// A message's menu (G14, prototype "ctxmenu"): eight short sentence-case rows, then Details; the rest (Copy link, Edit, Retry, Mark unread, Remember, Delete) is behind "More". Only your own message has Edit and Delete.
import test from "node:test";
import assert from "node:assert/strict";
import { menuFor } from "./MessageView.tsx";
import type { MessageActions } from "./MessageView.tsx";
import type { Message } from "./model.ts";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

const msg = (o: Record<string, unknown> = {}): Message =>
  ({
    messageId: "m1",
    threadId: "t1",
    threadSeq: 1,
    author: { kind: "person", id: "usr_maya" },
    kind: "text",
    body: "Did it come back?",
    blocks: [],
    depth: 0,
    attachments: [],
    reactions: [],
    pinned: false,
    createdAt: 1,
    ...o,
  }) as unknown as Message;
const calls: string[] = [];
let second: MenuEntry[] = [];
const acts = {
  copy: () => calls.push("copy"),
  edit() {},
  setPinned: (_id: string, on: boolean) => calls.push(`pin:${on}`),
  react() {},
  openThread: () => calls.push("thread"),
  remove: () => calls.push("remove"),
  showMenu: (items: readonly MenuEntry[]) => {
    second = [...items];
  },
  makeTask: () => calls.push("task"),
  share: () => calls.push("share"),
  fork: () => calls.push("fork"),
} as unknown as MessageActions;
const word = (e: MenuEntry): string => ("separator" in e ? "|" : "head" in e ? "#" : e.label);
const shape = (m: Message, mine: boolean, a: MessageActions = acts): string =>
  menuFor(m, mine, a, () => calls.push("edit"))
    .map(word)
    .join(",");
/** What sits behind More: press it and read what the menu was handed. */
const behindMore = (m: Message, mine: boolean, a: MessageActions = acts): string[] => {
  second = [];
  const more = menuFor(m, mine, a, () => calls.push("edit")).find((e) => "label" in e && e.label === "More") as
    | { onSelect(): void }
    | undefined;
  more?.onSelect();
  return second.map(word);
};
const agentMsg = (): Message => msg({ author: { kind: "agent", id: "agt_mira" }, kind: "agent" });

test("someone else's message: the short list in sentence case, and More only where there is something behind it; nothing in Title Case", () => {
  assert.equal(shape(msg(), false), "Copy,Reply in thread,Make a task,Share to\u2026,Fork from here,Pin,Add reaction");
  const withLink = { ...(acts as object), copyLink: () => undefined } as unknown as MessageActions;
  assert.equal(
    shape(msg(), false, withLink),
    "Copy,Reply in thread,Make a task,Share to\u2026,Fork from here,Pin,Add reaction,|,More",
  );
  for (const l of shape(msg(), false).split(",")) assert.ok(l === "|" || !/\b[A-Z][a-z]+ [A-Z][a-z]+/.test(l), l);
});

test("an agent's reply ends in Details, after the eight; Rewind to here is drawn only where the chat can rewind", () => {
  assert.equal(
    shape(agentMsg(), false, { ...(acts as object), details: { open: () => calls.push("details") } } as never),
    "Copy,Reply in thread,Make a task,Share to\u2026,Fork from here,Pin,Add reaction,|,Details",
  );
  const rw = { ...(acts as object), rewind: (id: string) => calls.push(`rewind:${id}`) } as unknown as MessageActions;
  assert.ok(shape(msg(), false, rw).includes("Fork from here,Rewind to here,Pin"));
  calls.length = 0;
  (
    menuFor(msg(), false, rw, () => undefined).find((e) => "label" in e && e.label === "Rewind to here") as {
      onSelect(): void;
    }
  ).onSelect();
  assert.deepEqual(calls, ["rewind:m1"]);
  assert.ok(!shape(msg(), false).includes("Rewind"));
});

test("your own message: Edit and Delete are behind More, Delete last, alone, in the danger colour", () => {
  const m = msg({ author: { kind: "person", id: "me" } });
  assert.equal(
    shape(m, true),
    "Copy,Reply in thread,Make a task,Share to\u2026,Fork from here,Pin,Add reaction,|,More",
  );
  assert.deepEqual(behindMore(m, true), ["Edit", "|", "Delete"]);
  assert.deepEqual([second.at(-1) && (second.at(-1) as { danger?: boolean }).danger], [true]);
  assert.deepEqual(behindMore(msg(), false), [], "a person's message has nothing behind More here: no More at all");
});

test("the words follow the state and every item calls what it says", () => {
  assert.ok(shape(msg({ pinned: true }), false).includes("Unpin"));
  calls.length = 0;
  for (const e of menuFor(msg(), true, acts, () => calls.push("edit")))
    if ("onSelect" in e && e.label !== "More") e.onSelect?.();
  assert.deepEqual(calls, ["copy", "thread", "task", "share", "fork", "pin:true"]);
  calls.length = 0;
  behindMore(msg({ author: { kind: "person", id: "me" } }), true);
  for (const e of second) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(calls, ["edit", "remove"]);
});

test("a system line has no Make a task, Share or Fork", () => {
  assert.equal(shape(msg({ kind: "system" }), false), "Copy,Reply in thread,Pin,Add reaction");
});

test("an agent's reply has Retry (behind More) instead of Edit, and Retry runs its turn again", async () => {
  const withRegen = {
    ...(acts as object),
    regenerate: (id: string) => calls.push(`regen:${id}`),
  } as unknown as MessageActions;
  const behindAgent = behindMore(agentMsg(), false, withRegen);
  assert.ok(
    behindAgent.includes("Retry") && !behindAgent.includes("Edit") && !behindAgent.includes("Delete"),
    behindAgent.join("|"),
  );
  assert.deepEqual(behindMore(msg(), false, withRegen), [], "a person's message has none of the three");
  assert.ok(!behindMore(msg({ author: { kind: "person", id: "me" } }), true, withRegen).includes("Retry"));
  calls.length = 0;
  behindMore(agentMsg(), false, withRegen);
  (second.find((e) => "label" in e && e.label === "Retry") as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["regen:m1"]);
  assert.ok(!behindMore(agentMsg(), false, acts).includes("Retry"), "left out where the chat cannot");
  const { regenerate } = await import("./actions.ts");
  const sent: { cap: string; input: unknown }[] = [];
  await regenerate(
    {
      threadId: "thr_1",
      call: async (cap: string, input: unknown) => {
        sent.push({ cap, input });
        return cap === "engine.turn.of_message" ? { turn: { turnId: "trn_9" } } : {};
      },
    } as never,
    "m1",
  );
  assert.deepEqual(sent, [
    { cap: "engine.turn.of_message", input: { threadId: "thr_1", messageId: "m1" } },
    { cap: "engine.turn.retry", input: { turnId: "trn_9" } },
  ]);
  await assert.rejects(regenerate({ threadId: "thr_1", call: async () => ({}) } as never, "m1"));
});

test("Copy link copies the plain link to the message, behind More, only where the chat has an address", () => {
  const withLink = {
    ...(acts as object),
    copyLink: (id: string) => calls.push(`link:${id}`),
  } as unknown as MessageActions;
  assert.deepEqual(behindMore(msg(), false, withLink), ["Copy link"]);
  calls.length = 0;
  (second.find((e) => "label" in e && e.label === "Copy link") as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["link:m1"]);
  assert.ok(!behindMore(msg(), false, acts).includes("Copy link"));
});

test("Mark unread from here is behind More where the chat can do it, and runs threads.mark_unread_from with that message's sequence number", async () => {
  const withIt = {
    ...(acts as object),
    markUnreadFrom: (seq: number) => calls.push(`unread:${seq}`),
  } as unknown as MessageActions;
  const m = msg({ threadSeq: 7 });
  assert.deepEqual(behindMore(m, false, withIt), ["Mark unread from here"]);
  calls.length = 0;
  (second[0] as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["unread:7"]);
  assert.ok(!behindMore(m, false, acts).includes("Mark unread from here"), "left out where the chat cannot");
  assert.ok(
    !behindMore(msg({ messageId: "pending:k1" }), false, withIt).includes("Mark unread from here"),
    "not for a message still sending",
  );
  const { markUnreadFrom } = await import("./actions.ts");
  const sent: { cap: string; input: unknown }[] = [];
  await markUnreadFrom(
    {
      threadId: "thr_1",
      call: async (cap: string, input: unknown) => {
        sent.push({ cap, input });
        return { unread: 2 };
      },
    } as never,
    7,
  );
  assert.deepEqual(sent, [{ cap: "threads.mark_unread_from", input: { threadId: "thr_1", seq: 7 } }]);
});

test("message times in a shared place read in the Space zone, hover names both zones, and a private chat keeps the device clock", async () => {
  const { timeLabel, dayLabel, timeTitle, timeline } = await import("./model.ts");
  const zones = { space: "America/Los_Angeles", viewer: "Asia/Karachi" };
  const at = Date.parse("2026-11-05T17:05:00Z"); // 9:05 AM Pacific, 10:05 PM Karachi
  const shared = { now: Date.parse("2026-11-05T20:00:00Z"), offsetMin: 300, zones };
  assert.equal(timeLabel(at, shared), "9:05 AM");
  assert.equal(dayLabel(at, shared), "Today");
  assert.match(
    timeTitle(at, shared) ?? "",
    /^Thu 5 Nov 2026, 9:05 AM Pacific Time\. Your time: Thu 5 Nov, 10:05 PM Pakistan/,
  );
  const priv = { now: shared.now, offsetMin: 300 };
  assert.equal(timeLabel(at, priv), "10:05 PM");
  assert.equal(timeTitle(at, priv), undefined, "no hover where there is no second zone");
  const items = timeline([msg({ createdAt: at, messageId: "m_t" })], {
    meId: "me",
    nameOf: (id: string) => id,
    kindOf: () => "person" as never,
    clock: shared,
    shared: true,
  } as never);
  const other = items.find((i) => i.kind === "other") as { time: string; timeTitle?: string };
  assert.equal(other.time, "9:05 AM");
  assert.match(other.timeTitle ?? "", /Pacific Time/);
});

test("the touch sheet lists what is behind More in the same sheet (a phone has no second popup to open), for a reply and for your own message", () => {
  const all = {
    ...(acts as object),
    copyLink: () => undefined,
    regenerate: () => undefined,
    markUnreadFrom: () => undefined,
  } as unknown as MessageActions;
  const sheet = (m: Message, mine: boolean) =>
    menuFor(m, mine, all, () => undefined, { x: 0, y: 0 }, true).flatMap((e) => ("label" in e ? [e.label] : []));
  const theirs = sheet(agentMsg(), false);
  assert.ok(!theirs.includes("More"), "no More row to open: it is already open");
  for (const l of [
    "Copy",
    "Reply in thread",
    "Make a task",
    "Pin",
    "Add reaction",
    "Copy link",
    "Retry",
    "Mark unread from here",
  ])
    assert.ok(theirs.includes(l), l);
  const own = sheet(msg({ author: { kind: "person", id: "me" } }), true);
  for (const l of ["Copy", "Edit", "Delete", "Copy link"]) assert.ok(own.includes(l), l);
  assert.equal(own.at(-1), "Delete", "Delete stays last");
});
