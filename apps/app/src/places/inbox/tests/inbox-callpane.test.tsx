// P-L9c_05: a live call opens the caller's conversation with the call bar in its header and the Call tab of the side pane (notes, last interactions, open tasks, open record); the floating dock
// keeps out of the way while that conversation is open and is the only call surface from anywhere else. The call itself is the real controller over a fake Voice device and the sample telephony.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { InboxDataProvider, InboxStateProvider } from "../sidebar/index.ts";
import { InboxPhoneContext, dockFloats } from "../softphone/index.ts";
import type { InboxPhone } from "../softphone/index.ts";
import { CallConversation, callIsWith, cardOf, lastInteractions, showsCall } from "../callpane/index.ts";
import { createUnmatchedSample } from "../unmatched/sample.ts";
import type { ThreadItem } from "../contacttab/index.ts";
import { SAMPLE_NOW } from "../contactlist/sample.ts";

const MIN = 60_000;
const item = (kind: ThreadItem["kind"], id: string, ago: number, extra: Partial<ThreadItem> = {}): ThreadItem => ({ kind, id, at: SAMPLE_NOW - ago * MIN, ...extra }) as ThreadItem;

test("a call belongs to a conversation by the record, else by the number", () => {
  const conv = { id: "elena", contactId: "ct_elena", address: "+1 415 555 0161" };
  assert.ok(callIsWith(conv, "+1 415 555 0161", "ct_elena"));
  assert.ok(!callIsWith(conv, "+1 415 555 0161", "ct_other"), "the record wins when both know it");
  assert.ok(callIsWith({ id: "marcus", address: "marcus@pruittco.example" }, "+1 415 555 0188", undefined, ["+1 415 555 0188"]), "a person keyed by email, matched by the phone on their thread");
  assert.ok(callIsWith({ id: "u", address: "+1 628 555 0194" }, "(628) 555-0194", undefined), "an unmatched number by its digits");
  assert.ok(!callIsWith(conv, "", undefined));
  assert.deepEqual(["idle", "calling", "incoming", "live", "held", "ended"].map(showsCall), [false, false, false, true, true, true]);
});

test("the Call tab's last interactions are the newest four emails, texts and calls, newest first, with when", () => {
  const items = [
    item("email", "e1", 4300, { title: "Client intake form", preview: "Hi" }),
    item("call", "c1", 2900, { title: "Incoming call", preview: "Elena sends the lease Thursday" }),
    item("sms", "s1", 1500, { preview: "Running ten minutes late tomorrow." }),
    item("campaign_step", "x", 4200, { title: "Welcome series" }),
    item("email", "e2", 25, { title: "Lease documents for Thursday", preview: "Attached is draft 3" }),
    item("sms", "s2", 1450, { preview: "No problem. See you then." }),
  ];
  const last = lastInteractions(items, SAMPLE_NOW, 0);
  assert.deepEqual(last.map((l) => [l.kind, l.text]), [["mail", "Lease documents for Thursday"], ["sms", "No problem. See you then."], ["sms", "Running ten minutes late tomorrow."], ["call", "Incoming call"]]);
  assert.equal(last[0]!.when, "10:15 AM");
  assert.deepEqual(cardOf(items, [{ title: "Send the lease", due: "Today" }], SAMPLE_NOW, 0).tasks, [{ title: "Send the lease", due: "Today" }]);
});

const stateOf = (phase: string, peer: string): ReturnType<InboxPhone["state"]> => ({ phase, dialerOpen: false, direction: "out", peer, muted: false, held: phase === "held", recording: false, consent: false, digits: "", secs: 134, transferredTo: null, ended: phase === "ended" ? { secs: 134, reason: "hangup" } : null, error: null }) as never;

/** A call stood in at the dock's context: the call bar's props are the real ones the dock builds, the state is chosen. */
function withCall(phase: string, peer: string, child: ReactElement, opts: { notes?: string } = {}): string {
  const s = createUnmatchedSample();
  let claimed = 0;
  const phone: InboxPhone = {
    dial() {}, toggle() {}, state: () => stateOf(phase, peer),
    view: () => ({
      open: true, mode: phase === "held" ? "held" : phase === "ended" ? "ended" : "live", numbers: [{ id: "n1", label: "Irfad", num: "+1 415 555 0132" }], secs: 134, recording: false, held: phase === "held", muted: false,
      caller: peer.endsWith("0126") ? { name: "Dana Whitfield", number: peer, recordId: "ct_dana" } : { name: "Elena Rivera", number: peer, recordId: "ct_elena" }, placement: "inline",
      ...(phase === "ended" ? { endedNote: "Saved to Elena Rivera's conversation", endedSecs: 134, summary: "Elena sends the lease Thursday." } : {}),
    }),
    claim() { claimed++; return () => { claimed--; }; }, isClaimed: () => claimed > 0, notes: () => opts.notes ?? "", setNotes() {},
  };
  return renderToStaticMarkup(<InboxDataProvider value={s.data}><InboxStateProvider initial={{}}><InboxPhoneContext.Provider value={phone}>{child}</InboxPhoneContext.Provider></InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
}

const elena = <CallConversation conversationId="elena" contactId="ct_elena" tasks={[{ title: "Send the lease", due: "Today" }]} />;

test("a live call with this person puts the call bar in the conversation header and the Call tab beside it", () => {
  const out = withCall("live", "+1 415 555 0161", elena, { notes: "Lease Thursday" });
  assert.ok(out.includes('data-testid="call-header"') && out.includes('data-testid="softphone-bar"'), "the bar is in the header");
  for (const id of ["softphone-mute", "softphone-hold", "softphone-keypad", "softphone-transfer", "softphone-record", "softphone-hangup"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(out.includes("02:14"), "the clock");
  assert.ok(out.includes('data-testid="softphone-pane"') && out.includes("Notes") && out.includes("Last interactions") && out.includes("Open tasks"), "the Call tab");
  assert.ok(out.includes("Send the lease") && out.includes("Lease documents for Thursday"), "the person's tasks and last email");
  assert.ok(out.includes('data-testid="softphone-open-record"') && out.includes("Open Elena Rivera&#x27;s record"), "Open record");
  assert.ok(out.includes('data-testid="pane-toggle"') || out.includes("Hide the pane"), "one pane toggle");
  assert.ok(out.includes("Lease documents for Thursday"), "the conversation itself is below the bar");
});

test("a held call shows Resume, and an ended call shows the saved-to line with Log a task in the header", () => {
  assert.ok(withCall("held", "+1 415 555 0161", elena).includes("On hold"));
  const ended = withCall("ended", "+1 415 555 0161", elena);
  assert.ok(ended.includes('data-testid="softphone-ended"') && ended.includes("Saved to Elena Rivera&#x27;s conversation") && ended.includes('data-testid="softphone-log-task"'));
});

test("a call with someone else, or no call, adds nothing to this conversation", () => {
  const other = withCall("live", "+1 917 555 0126", <CallConversation conversationId="elena" contactId="ct_elena" />);
  assert.ok(!other.includes('data-testid="call-header"') && !other.includes('data-testid="softphone-pane"'), "a call with Dana is not Elena's");
  assert.ok(other.includes("Lease documents for Thursday"), "the conversation still draws");
  assert.ok(!withCall("idle", "", elena).includes('data-testid="call-header"'));
});

test("the floating dock is for the dialer, a ring and a call whose conversation is not open", () => {
  assert.equal(dockFloats(true, "live"), false);
  assert.equal(dockFloats(true, "held"), false);
  assert.equal(dockFloats(true, "ended"), false);
  assert.equal(dockFloats(true, "incoming"), true, "a ring is always on top");
  assert.equal(dockFloats(true, "idle"), true);
  assert.equal(dockFloats(false, "live"), true, "from another place the dock is the call");
});
