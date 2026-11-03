// The Ask pane (owner rule, rc.17): every Ask door opens one pane in the place it was pressed, about the thing, and never navigates to Chats. One thread per thing per person: asking again
// continues it, New starts a fresh one. Open in Chats lists it and opens it there. The pure parts: the store, the thread, the doors that are plain data adapters, and Cmd-K.
import test from "node:test";
import assert from "node:assert/strict";
import { ASK_SIDE, askChip, askPaneKey, askPaneOf, askScope, askScreen, closeAskPane, dropAskThing, newAsk, openAskPane, resetAskPanes, switchAskAgent, threadKey } from "./pane.ts";
import { currentScreen, screenForThread, pinThreadScreen, setScreenContext, screenFromHash } from "./screen.ts";
import { openAskInChats, resolveAskThread } from "./thread.ts";
import { openAsk } from "../providers/ask.ts";
import { inboxData } from "../providers/inbox-data.ts";
import { askActions, askHere, ASK_HERE } from "../cmdk/gate.ts";
import { reviewData } from "../providers/files-review.ts";
import { recordsData } from "../providers/records-data.ts";
import { makeAskVyre, openRecordsAsk } from "../../places/records/askpane/index.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** A Space's chat capabilities, as far as an Ask needs them: each start is a new thread unless its idempotency key was seen; asks_of lists the person's own, newest first. */
function space(): { call: Call; calls: { cap: string; input: Record<string, unknown> }[]; threads: { threadId: string; scopeType: string; scopeId: string; agentId: string; listed: boolean }[] } {
  const threads: { threadId: string; scopeType: string; scopeId: string; agentId: string; listed: boolean }[] = [];
  const keys = new Map<string, string>();
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call: Call = async (cap, raw) => {
    const input = raw as Record<string, unknown>;
    calls.push({ cap, input });
    if (cap === "chat.start") {
      const key = String(input["idempotencyKey"]);
      const had = keys.get(key);
      if (had) return { thread: { threadId: had } };
      const t = { threadId: `thr_${threads.length + 1}`, scopeType: String(input["scopeType"]), scopeId: String(input["scopeId"]), agentId: (input["agentIds"] as string[])[0]!, listed: false };
      threads.push(t);
      keys.set(key, t.threadId);
      return { thread: { threadId: t.threadId } };
    }
    if (cap === "chat.asks_of") {
      const mine = threads.filter((t) => t.scopeType === input["resourceType"] && t.scopeId === input["resourceId"]).reverse();
      return { threads: mine.map((t) => ({ threadId: t.threadId, agents: [{ agentId: t.agentId, mode: "lead" }] })), total: mine.length };
    }
    if (cap === "chat.open_as_chat") { const t = threads.find((x) => x.threadId === input["threadId"]); if (t) t.listed = true; return { thread: { threadId: input["threadId"] } }; }
    throw new Error(`unexpected ${cap}`);
  };
  return { call, calls, threads };
}

const rt = (opened: unknown[]) => ({ open: (t: unknown) => void opened.push(t), assistant: { id: "agt_assistant", name: "Assistant" } }) as never;

test("the pane opens on the right, its width is remembered per place, and the side is one constant", () => {
  assert.equal(ASK_SIDE, "right", "the owner confirmed the right");
  assert.equal(askPaneKey("records"), "ask-records");
  assert.notEqual(askPaneKey("records"), askPaneKey("files"), "each place keeps its own width");
});

test("openAsk opens the pane in the place the person is in, about the thing, and never opens Chats", () => {
  resetAskPanes();
  const opened: unknown[] = [];
  for (const [place, about] of [["files", { kind: "file", id: "fil_1", title: "id-scan.png" }], ["vault", { kind: "vault_item", id: "vit_1", title: "Resend" }], ["records", { kind: "record", id: "rec_1", title: "Maya Chen" }]] as const) {
    setScreenContext(screenFromHash(place, ""));
    openAsk(rt(opened), "assistant", about);
    const s = askPaneOf(place);
    assert.ok(s, `${place}: the pane is open`);
    assert.deepEqual(s!.thing, about);
    assert.equal(s!.agentId, "assistant");
  }
  assert.deepEqual(opened, [], "nothing navigated: no Chats link was opened");
  // a Vault item's Add to Automations brings its opening message into the pane, not a new chat in Chats
  setScreenContext(screenFromHash("vault", ""));
  openAsk(rt(opened), "assistant", { kind: "vault_item", id: "vit_1", title: "Resend" }, undefined, "Add Resend to Automations. ...");
  assert.equal(askPaneOf("vault")!.first, "Add Resend to Automations. ...");
  assert.deepEqual(opened, []);
  // only in Chats itself, with no other place to stay in, does it open the Ask there
  setScreenContext(null);
  openAsk(rt(opened), "assistant", { kind: "record", id: "rec_1" });
  assert.equal(opened.length, 1);
});

test("Records: Ask Vyre (the sidebar row, the Record types page, the type sheet) and Bring in your CRM open the Records pane, as before, with the Records context", () => {
  resetAskPanes();
  const opened: unknown[] = [];
  // the doors of the Records sidebar and pages call askVyre; the shell's askVyre opens the shared pane
  const ask = makeAskVyre((a) => { if (a.type === "ask") openRecordsAsk(a.about, a.about.type === "client" ? "Clients" : undefined); }, { type: "client", screen: undefined });
  ask({});
  let s = askPaneOf("records")!;
  assert.deepEqual(s.thing, { kind: "records", id: "type:client", title: "Clients" }, "one thread per record type, the scope it always had");
  assert.equal(s.context?.focus, "focus-records");
  assert.deepEqual(s.context?.open, [{ type: "record_type", id: "client", title: "Clients" }]);
  makeAskVyre((a) => { if (a.type === "ask") openRecordsAsk(a.about); }, { screen: "records.types" })({ making: "Deal" });
  s = askPaneOf("records")!;
  assert.deepEqual(s.thing, { kind: "records", id: "types", title: "New type Deal" });
  assert.match(s.hint ?? "", /Deal/);
  makeAskVyre((a) => { if (a.type === "ask") openRecordsAsk(a.about); }, { screen: undefined })({});
  assert.equal(askPaneOf("records")!.thing, null, "Ask in Records with nothing open is about the place");
  const data = recordsData({ open: (t: unknown) => void opened.push(t), assistant: { id: "agt_assistant", name: "Assistant" }, screens: {}, call: async () => ({}), connection: {}, recordTitle: () => undefined } as never);
  data.nav.bringInCrm?.();
  assert.match(askPaneOf("records")!.first ?? "", /^Bring my CRM into Records\./);
  assert.deepEqual(opened, []);
});

test("Files: the viewer's and the agent file page's Ask open the pane in Files about the file", () => {
  resetAskPanes();
  const opened: unknown[] = [];
  setScreenContext(screenFromHash("files", "subject=file:fil_lease"));
  reviewData({ open: (t: unknown) => void opened.push(t), assistant: { id: "agt_assistant", name: "Assistant" }, screens: {}, call: async () => ({}), connection: {}, recordTitle: () => undefined, clock: () => ({ now: 0 }), me: { id: "usr_1", name: "Me" } } as never).nav.ask?.("agt_assistant", "chat", { kind: "file", id: "fil_lease", title: "Lease.pdf" });
  assert.deepEqual(askPaneOf("files")!.thing, { kind: "file", id: "fil_lease", title: "Lease.pdf" });
  assert.equal(askPaneOf("files")!.agentId, "assistant", "the Space assistant is named as such");
  assert.deepEqual(opened, []);
});

test("the Inbox's New message opens the pane in the Inbox with the draft, not a chat in Chats", () => {
  resetAskPanes();
  const opened: unknown[] = [];
  const data = inboxData({ open: (t: unknown) => void opened.push(t), assistant: { id: "agt_assistant", name: "Assistant" }, screens: {}, call: async () => ({}), connection: {}, clock: () => ({ now: 0 }), me: { id: "usr_1" } } as never, () => undefined);
  data.nav.compose();
  assert.deepEqual(opened, []);
  assert.equal(askPaneOf("inbox")!.draft, "Draft an email to ");
});

test("Cmd-K offers Ask Vyre about what is on screen, opens the pane in place, and offers nothing in Chats", () => {
  resetAskPanes();
  setScreenContext({ place: "files", open: [{ type: "file", id: "fil_9", title: "Lease.pdf" }], focus: "focus-files" });
  const acts = askActions(currentScreen());
  assert.equal(acts.length, 1);
  assert.equal(acts[0]!.key, ASK_HERE);
  assert.equal(acts[0]!.title, "Ask Vyre about Lease.pdf");
  assert.ok(askHere());
  assert.deepEqual(askPaneOf("files")!.thing, { kind: "file", id: "fil_9", title: "Lease.pdf" });
  setScreenContext({ place: "settings", title: "settings.page" });
  assert.equal(askActions(currentScreen())[0]!.title, "Ask Vyre about Settings");
  assert.deepEqual(askActions({ place: "chats" }), [], "Chats is where chats are: nothing to open beside");
  assert.equal(askActions(null).length, 0);
});

test("a conversation per thing per person: asking again continues it, New starts fresh, and the newest is what a later Ask continues", async () => {
  resetAskPanes();
  const sp = space();
  const s = openAskPane({ thing: { kind: "record", id: "rec_1", title: "Maya Chen" } }, "records")!;
  const first = await resolveAskThread(sp.call, s, "agt_assistant");
  assert.equal(first, "thr_1");
  // closed and asked again about the same record: the same thread
  closeAskPane("records");
  const again = openAskPane({ thing: { kind: "record", id: "rec_1", title: "Maya Chen" } }, "records")!;
  assert.equal(threadKey(again), threadKey(s), "the same key: nothing to re-resolve");
  assert.equal(await resolveAskThread(sp.call, again, "agt_assistant"), "thr_1");
  // another record is another thread
  const other = openAskPane({ thing: { kind: "record", id: "rec_2" } }, "records")!;
  assert.equal(await resolveAskThread(sp.call, other, "agt_assistant"), "thr_2");
  // New on rec_1: a fresh thread, which reopening then continues
  openAskPane({ thing: { kind: "record", id: "rec_1", title: "Maya Chen" } }, "records");
  newAsk("records");
  const fresh = askPaneOf("records")!;
  assert.equal(fresh.fresh, 1);
  assert.notEqual(threadKey(fresh), threadKey(s));
  assert.equal(await resolveAskThread(sp.call, fresh, "agt_assistant"), "thr_3");
  closeAskPane("records");
  const later = openAskPane({ thing: { kind: "record", id: "rec_1" } }, "records")!;
  assert.equal(later.fresh, 0);
  assert.equal(await resolveAskThread(sp.call, later, "agt_assistant"), "thr_3", "the newest Ask on the record is the one continued");
  // another agent has its own thread on the same thing
  switchAskAgent("records", "agt_billing");
  const billing = askPaneOf("records")!;
  assert.equal(billing.agentId, "agt_billing");
  assert.equal(await resolveAskThread(sp.call, billing, "agt_billing"), "thr_4");
  // every start was an Ask scoped to the thing, titled for the Ask history in Chats
  const starts = sp.calls.filter((c) => c.cap === "chat.start");
  assert.ok(starts.every((c) => c.input["kind"] === "ask"));
  assert.equal(starts[0]!.input["title"], "Ask about Maya Chen");
});

test("the chip's x makes the pane about the place: the place's own thread, and the thing's context goes", async () => {
  resetAskPanes();
  const sp = space();
  openAskPane({ thing: { kind: "automation", id: "aut_1", title: "Lead follow-up" }, context: { selection: [{ type: "step", id: "n1" }] } }, "automations");
  assert.equal(askChip(askPaneOf("automations")!.thing), "Lead follow-up");
  dropAskThing("automations");
  const s = askPaneOf("automations")!;
  assert.equal(s.thing, null);
  assert.equal(askChip(s.thing), null);
  assert.deepEqual(askScope("automations", null), { scopeType: "automations", scopeId: "place" }, "the scope the Automations pane always used, so its thread carries on");
  await resolveAskThread(sp.call, s, "agt_assistant");
  assert.equal(sp.threads[0]!.scopeType, "automations");
  const screen = askScreen(s);
  assert.equal(screen.open, undefined);
  assert.equal(screen.selection, undefined);
  assert.equal(screen.focus, "focus-automations");
});

test("every message in the pane carries the thing as the open object, with the place's focus skill, wherever the person moves in the place", () => {
  resetAskPanes();
  const s = openAskPane({ thing: { kind: "vault_item", id: "vit_1", title: "Resend" }, context: { actions: ["explain"] } }, "vault")!;
  pinThreadScreen("thr_p", () => askScreen(s));
  setScreenContext(screenFromHash("vault", "screen=vault.layout"));
  const sent = screenForThread("thr_p")!;
  assert.equal(sent.place, "vault");
  assert.deepEqual(sent.open, [{ type: "vault_item", id: "vit_1", title: "Resend" }]);
  assert.equal(sent.focus, "focus-vault");
  assert.deepEqual(sent.actions, ["explain"]);
  pinThreadScreen("thr_p", null);
  assert.equal(screenForThread("thr_p"), null, "a plain chat carries no screen");
});

test("an opening message is its own session on the thing, the same one each time", async () => {
  const sp = space();
  const s = { place: "vault", thing: { kind: "vault_item", id: "vit_1" }, first: "Add Resend to Automations. Use #Resend.", fresh: 0 };
  const a = await resolveAskThread(sp.call, s, "agt_assistant");
  const b = await resolveAskThread(sp.call, s, "agt_assistant");
  assert.equal(a, b);
  const start = sp.calls.find((c) => c.cap === "chat.start")!;
  assert.equal(start.input["first"], s.first);
  assert.equal(start.input["title"], "Add Resend to Automations");
});

test("Open in Chats lists the Ask and opens it as a full chat", async () => {
  const sp = space();
  const id = (await resolveAskThread(sp.call, { place: "files", thing: { kind: "file", id: "fil_1" }, fresh: 0 }, "agt_assistant"))!;
  const opened: unknown[] = [];
  await openAskInChats(sp.call, (t) => opened.push(t), id);
  assert.equal(sp.threads[0]!.listed, true, "it shows in Chats now");
  assert.deepEqual(opened, [{ subject: { type: "thread", id } }]);
});
