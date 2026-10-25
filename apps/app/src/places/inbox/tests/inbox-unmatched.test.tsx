// Inbox > Unmatched and the softphone wiring (P-L9c_04, spec 3.3 and 2.18). Unmatched lists senders and callers that match no record, with the Match menu; a match moves the conversation to the
// record and Undo brings it back; the dock runs the telephony capabilities and a call that ends is saved to the conversation of the person it was with (or to a new unmatched line).
// The data is the Inbox sample replica (real generated screens over a fake replica); the call state machine is the real shared one over a fake Voice device.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { createPhoneController } from "../../../../../../ui/src/Softphone/index.tsx";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuItem } from "../../../../../../ui/src/Menu/props.ts";
import { harbor } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxStateProvider } from "../sidebar/index.ts";
import { InboxUnmatched, matchMenuEntries, newestFirst, waitingLine } from "../unmatched/index.ts";
import type { Suggestion, Unmatched } from "../unmatched/index.ts";
import { createUnmatchedSample } from "../unmatched/sample.ts";
import type { UnmatchedSample } from "../unmatched/sample.ts";
import { InboxPhoneDock, callerOf, numbersOf, phoneHooks, prettyNumber, sameNumber, savedLine, suggestionsFor } from "../softphone/index.ts";
import type { CallOut, CallsOut, NumbersOut } from "../softphone/index.ts";
import type { ContactRow } from "../sidebar/model.ts";

const html = (s: UnmatchedSample, child: ReactElement): string =>
  renderToStaticMarkup(<InboxDataProvider value={s.data}><InboxStateProvider initial={{}}>{child}</InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
const snap = <T,>(s: UnmatchedSample, screen: string, name: string, state: Record<string, unknown> = {}): T => {
  const q = s.data.screens.query(screen, name, state).getSnapshot() as { status: string; data?: T };
  assert.equal(q.status, "ready", `${screen}.${name}`);
  return q.data as T;
};
const waiting = (s: UnmatchedSample): Unmatched[] => snap<{ rows: Unmatched[] }>(s, "inbox.unmatched", "rows").rows;
const thread = (s: UnmatchedSample, id: string): { kind: string; id: string; preview?: string }[] =>
  (s.base.replica.rows("thread_items") as unknown as { conversationId: string; kind: string; id: string; preview?: string }[]).filter((x) => x.conversationId === id);
const items = (menu: ReturnType<typeof matchMenuEntries>): MenuItem[] => menu.filter(isItem);

test("Unmatched lists the senders that match no record, newest first, each with the Match button", () => {
  const s = createUnmatchedSample();
  assert.deepEqual(newestFirst(waiting(s)).map((r) => r.id), ["unk", "u_971"], "the newest first");
  const out = html(s, <InboxUnmatched />);
  assert.ok(out.includes("Unmatched") && out.includes("2 waiting for a match"));
  for (const id of ["unk", "u_971"]) assert.ok(out.includes(`data-testid="unmatched-${id}"`) && out.includes(`data-testid="match-${id}"`), id);
  assert.ok(out.includes("+1 628 555 0194") && out.includes("+1 971 555 0182"), "the numbers are the names");
  assert.ok(out.includes("Match to a record") && out.includes('data-testid="face-ghost"'), "ghost face and the button");
  assert.ok(out.includes("background-color:var(--accent-wash)"), "the accent-wash block, not a Row");
  assert.ok(!out.includes('data-testid="row-line:'), "not a ui/Row");
  assert.equal(waitingLine(0), "");
  assert.equal(waitingLine(1), "1 waiting for a match");
});

test("an empty Unmatched says there is nothing waiting, and Harbor Studio has none", () => {
  const out = html(createUnmatchedSample(harbor), <InboxUnmatched />);
  assert.ok(out.includes("Nothing waiting for a match"));
  assert.ok(!out.includes("unmatched-count"), "no count line");
});

test("the Match menu lists suggestions best first with their score in the count column, then the three ways out", () => {
  const sg: Suggestion[] = [
    { recordId: "rec_a", type: "company", name: "Cole Dental", score: 0.61, why: "x" },
    { recordId: "rec_b", type: "contact", name: "Hannah Cole", score: 0.92, why: "y" },
  ];
  const picked: string[] = [];
  const menu = matchMenuEntries(sg, { match: (x) => void picked.push(x.recordId), search: () => void picked.push("search"), create: (t) => void picked.push(`new:${t}`) });
  assert.equal((menu[0] as { head: string }).head, "Suggested");
  const it = items(menu);
  assert.deepEqual(it.map((x) => [x.label, x.count]), [["Hannah Cole", 92], ["Cole Dental, company", 61], ["Search Records…", undefined], ["Create a contact", undefined], ["Create a company", undefined]]);
  assert.ok(it.every((x) => !/\d+%/.test(x.label)), "no number in a label");
  for (const x of it) x.onSelect?.();
  assert.deepEqual(picked, ["rec_b", "rec_a", "search", "new:contact", "new:company"]);
  assert.ok(matchMenuEntries([], { match() {}, search() {}, create() {} }).some((e) => "head" in e && e.head === "No suggestions yet"));
});

test("a match moves the conversation to the record's person; Undo puts it back", async () => {
  const s = createUnmatchedSample();
  const before = thread(s, "unk").length;
  assert.ok(before > 0);
  const hannahBefore = thread(s, "hannah").length;
  const sg = ((await s.data.call("inbox.match_suggestions", { conversationId: "unk" })) as { suggestions: Suggestion[] }).suggestions;
  assert.deepEqual(sg.map((x) => x.name), ["Hannah Cole", "Cole Dental"]);
  const out = (await s.data.call("inbox.match", { conversationId: "unk", recordId: sg[0]!.recordId, idempotencyKey: "k1" })) as { conversation: ContactRow; undoToken: string };
  assert.equal(out.conversation.id, "hannah");
  assert.deepEqual(waiting(s).map((r) => r.id), ["u_971"], "the line left Unmatched");
  assert.equal(thread(s, "unk").length, 0);
  assert.equal(thread(s, "hannah").length, hannahBefore + before, "its messages are in Hannah's conversation now");
  assert.ok(out.conversation.unreadCount >= 1, "unread counts add up");
  await s.data.call("inbox.unmatch", { conversationId: "unk", undoToken: out.undoToken });
  assert.deepEqual(waiting(s).map((r) => r.id).sort(), ["u_971", "unk"], "Undo brings it back");
  assert.equal(thread(s, "hannah").length, hannahBefore);
  assert.equal(thread(s, "unk").length, before);
  await assert.rejects(() => s.data.call("inbox.unmatch", { conversationId: "unk", undoToken: out.undoToken }), /nothing to undo/, "an undo works once");
  assert.deepEqual(s.matches.map((m) => m.cap), ["inbox.match", "inbox.unmatch", "inbox.unmatch"]);
});

test("Create a Record turns the line into a new contact and it leaves Unmatched", async () => {
  const s = createUnmatchedSample();
  const out = (await s.data.call("inbox.match_new", { conversationId: "u_971", type: "contact", idempotencyKey: "k2" })) as { recordId: string; conversation: ContactRow };
  assert.match(out.recordId, /^rec_new_/);
  assert.equal(out.conversation.needsMatch, false);
  assert.deepEqual(waiting(s).map((r) => r.id), ["unk"]);
});

// ---- the softphone

test("numbers, callers and suggestions come from the Space's own numbers and calls", () => {
  const s = createUnmatchedSample();
  const numbers = snap<NumbersOut>(s, "telephony.softphone", "numbers");
  assert.deepEqual(numbersOf(numbers), [{ id: "+1 415 555 0132", label: "Irfad", num: "+1 415 555 0132" }]);
  const calls = snap<CallsOut>(s, "telephony.softphone", "calls");
  const rows = snap<{ rows: ContactRow[] }>(s, "inbox.contact-list", "rows").rows;
  assert.equal(callerOf("+1 917 555 0126", calls, rows).name, "Dana Whitfield", "a caller the Space knows");
  assert.equal(callerOf("+1 202 555 0100", calls, rows).name, undefined, "an unknown caller is just a number");
  assert.deepEqual(suggestionsFor("917", calls, rows).map((x) => x.name), ["Dana Whitfield"]);
  assert.deepEqual(suggestionsFor("9", calls, rows), [], "one digit suggests nothing");
  assert.equal(prettyNumber("+14155550132"), "+1 415 555 0132");
  assert.ok(sameNumber("(415) 555-0132", "+1 415 555 0132"));
  assert.ok(!sameNumber("+1 415 555 0132", "+1 415 555 0133"));
  assert.equal(savedLine("Elena Rivera"), "Saved to Elena Rivera's conversation");
});

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); }

function controllerFor(s: UnmatchedSample, hung: CallOut[] = []) {
  let callId: string | undefined;
  let contactId: string | undefined;
  const hooks = phoneHooks((cap, input) => s.data.call(cap, input), { numberId: () => "+1 415 555 0132", callId: () => callId, setCallId: (id) => { callId = id; }, contactId: () => contactId },
    { targets: [{ name: "Omar Haddad", kind: "teammate", id: "usr_omar", kind2: "person" }], onHungUp: (c) => void hung.push(c) });
  return { controller: createPhoneController(s.device, hooks), setContact: (c: string | undefined) => { contactId = c; }, callId: () => callId };
}

test("a call to a person the Space knows is saved to that person's conversation; hold, record, transfer and Log a task run their capabilities", async () => {
  const s = createUnmatchedSample();
  const hung: CallOut[] = [];
  const { controller, setContact, callId } = controllerFor(s, hung);
  const elenaBefore = thread(s, "elena").length;
  setContact("ct_elena");
  await controller.dial("+1 415 555 0161");
  await settle();
  assert.equal(controller.state().phase, "live");
  assert.deepEqual(s.device.connected[0]!.params["To"], "+1 415 555 0161");
  await controller.hold();
  await controller.record();
  assert.equal(controller.state().recording && controller.state().consent, true, "consent was logged with the start");
  await controller.transfer("Omar Haddad");
  assert.equal(controller.state().phase, "ended");
  assert.equal(controller.state().transferredTo, "Omar Haddad");
  await s.data.call("telephony.call.log_task", { callId: callId()!, title: "Send the lease" });
  const caps = s.telephony.map((t) => t.cap);
  assert.deepEqual(caps, ["telephony.dial", "telephony.hold", "telephony.record", "telephony.transfer", "telephony.call.log_task"]);
  assert.deepEqual(s.telephony[2]!.input, { callId: callId(), action: "start", consent: { announced: true } });
  assert.deepEqual(s.telephony[3]!.input, { callId: callId(), to: { kind: "person", id: "usr_omar" }, mode: "warm" });
  // the call is hung up (saved) once; the person's thread has it
  await s.data.call("telephony.hangup", { callId: callId()! });
  const t = thread(s, "elena");
  assert.equal(t.length, elenaBefore + 1);
  assert.ok(t.some((x) => x.kind === "call" && x.id === `c_${callId()}`), "the call is in Elena's conversation");
  assert.ok(hung.length === 0 || hung[0]!.contactId === "ct_elena");
  const row = snap<{ rows: ContactRow[] }>(s, "inbox.contact-list", "rows").rows.find((r) => r.id === "elena")!;
  assert.equal(row.lastChannel, "call", "the list shows the call as the newest thing");
});

test("hanging up saves the call and says where; a number nobody matches becomes a new Unmatched line", async () => {
  const s = createUnmatchedSample();
  const hung: CallOut[] = [];
  const { controller } = controllerFor(s, hung);
  await controller.dial("+1 503 555 0199");
  await settle();
  assert.equal(controller.state().phase, "live");
  controller.hangup();
  await settle();
  assert.equal(controller.state().phase, "ended");
  assert.equal(hung.length, 1, "the server answered the hangup with the saved call");
  assert.equal(hung[0]!.state, "completed");
  assert.equal(savedLine(undefined), "Saved to the Inbox as a call from an unmatched number");
  const ids = waiting(s).map((r) => r.id);
  assert.ok(ids.includes("u_15035550199"), `the call is a new unmatched line: ${ids.join(", ")}`);
  assert.equal(thread(s, "u_15035550199")[0]!.kind, "call");
  // a second hangup of the same call saves nothing twice
  await s.data.call("telephony.hangup", { callId: hung[0]!.id });
  assert.equal(thread(s, "u_15035550199").length, 1);
});

test("an incoming call rings the dock, can be answered and ends; the idle dock shows the number", async () => {
  const s = createUnmatchedSample();
  const { controller } = controllerFor(s);
  const call = s.device.ring("+1 917 555 0126");
  assert.equal(controller.state().phase, "incoming");
  controller.answer();
  assert.deepEqual(call.log, ["accept"]);
  assert.equal(controller.state().phase, "live");
  call.disconnect();
  assert.equal(controller.state().phase, "ended");
  assert.equal(controller.state().ended?.reason, "remote");
  const out = html(s, <InboxPhoneDock device={s.device} placement="inline" />);
  assert.ok(out.includes('data-testid="softphone-pill"') && out.includes("+1 415 555 0132"), "the idle pill shows the Space's number");
});
