// ui/Softphone: the call state machine against a fake Twilio Voice device, and every screen of the dock (spec 2.18, ARCH 7.3).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CallBar,
  CallPane,
  DIAL_CAPABILITY,
  DIAL_KEYS,
  IDLE_STATE,
  Softphone,
  createPhoneController,
  formatClock,
  isDialable,
  isSoftphoneShortcut,
  liveStatus,
  phoneMode,
  phoneReduce,
  recordInput,
  recordingState,
  stateToProps,
  toE164,
  transferInput,
  transferMenu,
} from "./index.tsx";
import type { PhoneCallEvent, PhoneCallLike, PhoneDeviceLike, PhoneEvent, PhoneState, SoftphoneProps } from "./index.tsx";

/* ---------- a fake Twilio Voice device ---------- */

class FakeCall implements PhoneCallLike {
  parameters: { From?: string; To?: string; CallSid?: string };
  calls: string[] = [];
  digits: string[] = [];
  private handlers = new Map<PhoneCallEvent, ((arg?: unknown) => void)[]>();
  constructor(params: { From?: string; To?: string; CallSid?: string }) { this.parameters = params; }
  accept(): void { this.calls.push("accept"); }
  reject(): void { this.calls.push("reject"); }
  disconnect(): void { this.calls.push("disconnect"); }
  mute(shouldMute: boolean): void { this.calls.push(`mute:${shouldMute}`); }
  sendDigits(d: string): void { this.digits.push(d); }
  on(event: PhoneCallEvent, handler: (arg?: unknown) => void): void { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); }
  emit(event: PhoneCallEvent, arg?: unknown): void { for (const h of this.handlers.get(event) ?? []) h(arg); }
}

class FakeDevice implements PhoneDeviceLike {
  connected: { params: Record<string, string> }[] = [];
  destroyed = false;
  last: FakeCall | null = null;
  failWith: Error | null = null;
  private incoming: ((call: PhoneCallLike) => void)[] = [];
  connect(options: { params: Record<string, string> }): Promise<PhoneCallLike> {
    this.connected.push(options);
    if (this.failWith !== null) return Promise.reject(this.failWith);
    this.last = new FakeCall({ To: options.params["To"] ?? "" });
    return Promise.resolve(this.last);
  }
  on(_event: "incoming", handler: (call: PhoneCallLike) => void): void { this.incoming.push(handler); }
  destroy(): void { this.destroyed = true; }
  ring(from: string): FakeCall {
    const call = new FakeCall({ From: from, CallSid: "CA1" });
    this.last = call;
    for (const h of this.incoming) h(call);
    return call;
  }
}

const apply = (events: PhoneEvent[], from: PhoneState = IDLE_STATE): PhoneState => events.reduce(phoneReduce, from);

/* ---------- state machine ---------- */

test("the dialer opens and closes, and Cmd-Shift-K toggles it", () => {
  assert.equal(phoneMode(IDLE_STATE), "idle");
  const open = phoneReduce(IDLE_STATE, { type: "toggle_dialer" });
  assert.equal(open.dialerOpen, true);
  assert.equal(phoneMode(open), "dialer");
  assert.equal(phoneMode(phoneReduce(open, { type: "toggle_dialer" })), "idle");
  assert.equal(isSoftphoneShortcut({ key: "k", metaKey: true, shiftKey: true }), true);
  assert.equal(isSoftphoneShortcut({ key: "K", ctrlKey: true, shiftKey: true }), true);
  assert.equal(isSoftphoneShortcut({ key: "k", metaKey: true }), false, "Cmd-K alone is the shell search");
  assert.equal(isSoftphoneShortcut({ key: "j", metaKey: true, shiftKey: true }), false);
});

test("an outgoing call goes calling, live, then ended with the seconds on the clock", () => {
  const calling = apply([{ type: "dial", to: "+14155550161" }]);
  assert.equal(calling.phase, "calling");
  assert.equal(phoneMode(calling), "live");
  assert.equal(apply([{ type: "tick" }], calling).secs, 0, "the clock waits for the call to connect");
  const live = apply([{ type: "connected" }, { type: "tick" }, { type: "tick" }, { type: "tick" }], calling);
  assert.equal(live.phase, "live");
  assert.equal(live.secs, 3);
  const ended = phoneReduce(live, { type: "hangup" });
  assert.equal(ended.phase, "ended");
  assert.deepEqual(ended.ended, { secs: 3, reason: "hangup" });
  assert.equal(phoneMode(ended), "ended");
  assert.equal(phoneReduce(ended, { type: "dismiss" }).phase, "idle");
});

test("an incoming call is answered or declined; a second call while busy changes nothing", () => {
  const ringing = apply([{ type: "incoming", from: "+14155550182" }]);
  assert.equal(phoneMode(ringing), "incoming");
  assert.equal(phoneReduce(ringing, { type: "incoming", from: "+1999" }), ringing);
  assert.equal(phoneReduce(ringing, { type: "dial", to: "+1999" }), ringing);
  assert.equal(phoneReduce(ringing, { type: "answer" }).phase, "live");
  assert.equal(phoneReduce(ringing, { type: "decline" }).phase, "idle");
  const missed = phoneReduce(ringing, { type: "cancelled" });
  assert.deepEqual(missed.ended, { secs: 0, reason: "missed" });
});

test("mute and hold toggle only inside a call; hold shows as the held mode and the clock keeps running", () => {
  assert.equal(phoneReduce(IDLE_STATE, { type: "mute" }), IDLE_STATE);
  assert.equal(phoneReduce(IDLE_STATE, { type: "hold" }), IDLE_STATE);
  const live = apply([{ type: "dial", to: "+1415" }, { type: "connected" }]);
  const muted = phoneReduce(live, { type: "mute" });
  assert.equal(muted.muted, true);
  assert.equal(phoneReduce(muted, { type: "mute" }).muted, false);
  const held = apply([{ type: "hold" }, { type: "tick" }], live);
  assert.equal(held.phase, "held");
  assert.equal(phoneMode(held), "held");
  assert.equal(held.secs, 1);
  assert.equal(phoneReduce(held, { type: "hold" }).phase, "live");
});

test("recording waits on consent: a record request without logged consent records nothing", () => {
  const live = apply([{ type: "dial", to: "+1415" }, { type: "connected" }]);
  const asked = phoneReduce(live, { type: "record", on: true, consent: false });
  assert.equal(asked.recording, true);
  assert.equal(asked.consent, false);
  assert.equal(recordingState(asked), "waiting");
  const logged = phoneReduce(asked, { type: "record", on: true, consent: true });
  assert.equal(recordingState(logged), "on");
  assert.equal(recordingState(phoneReduce(logged, { type: "record", on: false })), "off");
  assert.equal(liveStatus({ mode: "live", recording: true, consent: false }, 5), "00:05 · Waiting for consent");
  assert.equal(liveStatus({ mode: "live", recording: true, consent: true }, 65), "01:05 · Recording");
  assert.equal(liveStatus({ mode: "held", held: true }, 9), "00:09 · On hold");
  assert.equal(liveStatus({ mode: "live" }, 0, true), "Calling");
});

test("a remote hang up, a failure and a transfer each end the call with their reason", () => {
  const live = apply([{ type: "dial", to: "+1415" }, { type: "connected" }, { type: "tick" }]);
  assert.equal(phoneReduce(live, { type: "disconnected" }).ended?.reason, "remote");
  const failed = phoneReduce(live, { type: "error", message: "Network lost" });
  assert.equal(failed.ended?.reason, "error");
  assert.equal(failed.error, "Network lost");
  const moved = phoneReduce(live, { type: "transferred", to: "Maya Chen" });
  assert.equal(moved.ended?.reason, "transferred");
  assert.equal(moved.transferredTo, "Maya Chen");
  assert.equal(phoneReduce(IDLE_STATE, { type: "error", message: "No microphone" }).error, "No microphone", "an error while idle is kept and the phone stays idle");
});

/* ---------- the controller against the fake device ---------- */

test("dial connects through the Voice SDK with the parameters telephony.dial returned, and the accept event makes it live", async () => {
  const device = new FakeDevice();
  const seen: string[] = [];
  const phone = createPhoneController(device, { dial: (to) => { seen.push(to); return Promise.resolve({ To: to, CallId: "cal_1" }); } });
  await phone.dial("+14155550161");
  assert.deepEqual(seen, ["+14155550161"]);
  assert.deepEqual(device.connected, [{ params: { To: "+14155550161", CallId: "cal_1" } }]);
  assert.equal(DIAL_CAPABILITY, "telephony.dial");
  assert.equal(phone.state().phase, "calling");
  device.last?.emit("accept");
  assert.equal(phone.state().phase, "live");
  phone.tick();
  phone.tick();
  assert.equal(phone.state().secs, 2);
});

test("an incoming call rings with the caller number; answer accepts it, decline rejects it", () => {
  const device = new FakeDevice();
  const phone = createPhoneController(device);
  const call = device.ring("+14155550182");
  assert.equal(phone.state().phase, "incoming");
  assert.equal(phone.state().peer, "+14155550182");
  phone.answer();
  assert.deepEqual(call.calls, ["accept"]);
  assert.equal(phone.state().phase, "live");

  const second = createPhoneController(new FakeDevice());
  const device2 = new FakeDevice();
  const phone2 = createPhoneController(device2);
  const call2 = device2.ring("+1888");
  phone2.decline();
  assert.deepEqual(call2.calls, ["reject"]);
  assert.equal(phone2.state().phase, "idle");
  assert.equal(second.state().phase, "idle");
});

test("a call that arrives while another is live is rejected and the live call is untouched", () => {
  const device = new FakeDevice();
  const phone = createPhoneController(device);
  const first = device.ring("+1111");
  phone.answer();
  const second = device.ring("+2222");
  assert.deepEqual(second.calls, ["reject"]);
  assert.equal(phone.state().peer, "+1111");
  assert.deepEqual(first.calls, ["accept"]);
});

test("mute goes to the SDK call, hold and transfer go to the server hooks, digits go to the SDK", async () => {
  const device = new FakeDevice();
  const holds: boolean[] = [];
  const moves: string[] = [];
  const phone = createPhoneController(device, { hold: (h) => { holds.push(h); }, transfer: (n) => { moves.push(n); } });
  const call = device.ring("+1415");
  phone.answer();
  phone.mute();
  assert.equal(phone.state().muted, true);
  phone.mute();
  assert.deepEqual(call.calls, ["accept", "mute:true", "mute:false"]);
  await phone.hold();
  assert.equal(phone.state().held, true);
  await phone.hold();
  assert.deepEqual(holds, [true, false]);
  phone.sendDigit("5");
  phone.sendDigit("x");
  phone.sendDigit("#");
  assert.deepEqual(call.digits, ["5", "#"]);
  assert.equal(phone.state().digits, "5#");
  await phone.transfer("Maya Chen");
  assert.deepEqual(moves, ["Maya Chen"]);
  assert.equal(phone.state().phase, "ended");
  assert.equal(phone.state().ended?.reason, "transferred");
  assert.deepEqual(call.calls.slice(-1), ["disconnect"]);
});

test("record asks the server for consent and shows Waiting for consent until it is logged", async () => {
  const device = new FakeDevice();
  let logged = false;
  const phone = createPhoneController(device, { record: (start) => (start ? { consentLogged: logged } : { consentLogged: false }) });
  device.ring("+1415");
  phone.answer();
  await phone.record();
  assert.equal(recordingState(phone.state()), "waiting");
  await phone.record();
  assert.equal(recordingState(phone.state()), "off");
  logged = true;
  await phone.record();
  assert.equal(recordingState(phone.state()), "on");
});

test("hang up disconnects the SDK call; a remote disconnect ends the call once; the controller notifies subscribers", () => {
  const device = new FakeDevice();
  const phone = createPhoneController(device);
  const phases: string[] = [];
  const stop = phone.subscribe((s) => phases.push(s.phase));
  const call = device.ring("+1415");
  phone.answer();
  call.emit("disconnect");
  assert.equal(phone.state().ended?.reason, "remote");
  phone.dispatch({ type: "dismiss" });
  stop();
  phone.dispatch({ type: "dial", to: "+1" });
  assert.deepEqual(phases, ["incoming", "live", "ended", "idle"]);

  const device2 = new FakeDevice();
  const phone2 = createPhoneController(device2);
  const call2 = device2.ring("+1415");
  phone2.answer();
  phone2.hangup();
  assert.deepEqual(call2.calls, ["accept", "disconnect"]);
  assert.equal(phone2.state().ended?.reason, "hangup");
  call2.emit("disconnect");
  assert.equal(phone2.state().ended?.reason, "hangup", "the SDK echo of our own hang up changes nothing");
});

test("a caller who gives up before we answer is a missed call; a failed connect ends the call with the error", async () => {
  const device = new FakeDevice();
  const phone = createPhoneController(device);
  const call = device.ring("+1415");
  call.emit("cancel");
  assert.equal(phone.state().ended?.reason, "missed");

  const bad = new FakeDevice();
  bad.failWith = new Error("Microphone permission denied");
  const phone2 = createPhoneController(bad);
  await phone2.dial("+14155550161");
  assert.equal(phone2.state().phase, "ended");
  assert.equal(phone2.state().error, "Microphone permission denied");
  phone2.destroy();
  assert.equal(bad.destroyed, true);
});

test("hanging up while the call is still connecting drops the SDK call when it arrives", async () => {
  const device = new FakeDevice();
  const phone = createPhoneController(device);
  const dialing = phone.dial("+14155550161");
  phone.hangup();
  await dialing;
  assert.equal(phone.state().phase, "idle");
  assert.deepEqual(device.last?.calls, ["disconnect"]);
});

test("stateToProps gives the view the mode and the caller", () => {
  const live = apply([{ type: "dial", to: "+14155550161" }, { type: "connected" }, { type: "mute" }]);
  assert.deepEqual(stateToProps(live), { open: true, mode: "live", muted: true, held: false, recording: false, consent: false, caller: { number: "+14155550161" } });
  assert.deepEqual(stateToProps(IDLE_STATE), { open: false, mode: "idle", muted: false, held: false, recording: false, consent: false });
});

/* ---------- contract inputs and helpers ---------- */

test("record and transfer map to the telephony inputs", () => {
  assert.deepEqual(recordInput("cal_1", true, true, "usr_me"), { callId: "cal_1", action: "start", consent: { announced: true, confirmedBy: "usr_me" } });
  assert.deepEqual(recordInput("cal_1", false, true), { callId: "cal_1", action: "stop" });
  assert.deepEqual(transferInput("cal_1", { kind: "agent", id: "agt_intake" }), { callId: "cal_1", to: { kind: "agent", id: "agt_intake" }, mode: "warm" });
});

test("dial helpers: what counts as dialable, E.164, and the clock", () => {
  assert.equal(isDialable("+1 415 555 0161"), true);
  assert.equal(isDialable("(415) 555-0161"), true);
  assert.equal(isDialable("41"), false);
  assert.equal(isDialable("Elena"), false);
  assert.equal(toE164("(415) 555-0161"), "+14155550161");
  assert.equal(toE164("1 415 555 0161"), "+14155550161");
  assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(125), "02:05");
  assert.deepEqual([...DIAL_KEYS], ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]);
});

test("the transfer menu lists teammates then agents, none with an icon", () => {
  const picked: string[] = [];
  const menu = transferMenu([{ name: "Maya Chen", kind: "teammate" }, { name: "Intake", kind: "agent" }, { name: "Omar Haddad", kind: "teammate" }], (n) => picked.push(n));
  const heads = menu.filter((e) => "head" in e).map((e) => ("head" in e ? e.head : ""));
  assert.deepEqual(heads, ["Teammates", "Agents"]);
  const items = menu.filter((e) => "label" in e);
  assert.equal(items.length, 3);
  for (const e of items) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(picked, ["Maya Chen", "Omar Haddad", "Intake"]);
  assert.equal(transferMenu([], () => undefined).length, 1);
});

/* ---------- screens ---------- */

const NUMBERS = [{ id: "n1", label: "Office", num: "+1 415 555 0132" }, { id: "n2", label: "Intake line", num: "+1 415 555 0177" }];
const base: SoftphoneProps = { open: false, mode: "idle", numbers: NUMBERS };
const caller = { name: "Elena Rivera", number: "+1 415 555 0161", company: "Rivera Holdings", recordId: "rec_elena" };

test("idle shows the pill with the number; the dialer shows 12 keys, the from number and Call", () => {
  const pill = renderToStaticMarkup(<Softphone {...base} />);
  assert.match(pill, /data-testid="softphone-pill"/);
  assert.match(pill, /\+1 415 555 0132/);
  const dialer = renderToStaticMarkup(<Softphone {...base} open mode="dialer" />);
  assert.match(dialer, /role="dialog"/);
  assert.match(dialer, /aria-label="Call from Office"/);
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "star", "0", "hash"]) assert.match(dialer, new RegExp(`data-testid="softphone-key-${k}"`));
  assert.match(dialer, /data-testid="softphone-call"/);
  assert.match(dialer, /ABC/);
  assert.match(dialer, /aria-disabled="true"/, "Call is off until the number is dialable");
});

test("the dialer lists up to three suggestions", () => {
  const html = renderToStaticMarkup(<Softphone {...base} open mode="dialer" suggestions={[{ name: "Elena Rivera", number: "+14155550161" }, { name: "Omar Haddad", number: "+14155550162" }, { name: "Lena Ortiz", number: "+14155550163" }, { name: "Maya Chen", number: "+14155550164" }]} />);
  assert.match(html, /softphone-suggest-\+14155550161/);
  assert.match(html, /softphone-suggest-\+14155550163/);
  assert.doesNotMatch(html, /softphone-suggest-\+14155550164/);
});

test("an incoming call shows the caller, the number it came in on, Accept and Decline", () => {
  const html = renderToStaticMarkup(<Softphone {...base} open mode="incoming" caller={caller} fromId="n2" />);
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /Elena Rivera/);
  assert.match(html, /Rivera Holdings/);
  assert.match(html, /Incoming to \+1 415 555 0177/, "the number it came in on (P-L9_34), not the line's label");
  assert.doesNotMatch(html, /Incoming to Intake line/);
  assert.match(html, /data-testid="softphone-answer"/);
  assert.match(html, /data-testid="softphone-decline"/);
  const unknown = renderToStaticMarkup(<Softphone {...base} open mode="incoming" caller={{ number: "+1 999 555 0100" }} />);
  assert.match(unknown, /Unknown caller/);
});

test("a live call shows the clock, mute, hold, keypad, transfer, record and hang up; the pressed ones say so", () => {
  const html = renderToStaticMarkup(<Softphone {...base} open mode="live" caller={caller} secs={75} muted recording consent />);
  assert.match(html, /data-testid="softphone-bar"/);
  assert.match(html, /01:15 · Recording/);
  assert.match(html, /aria-label="Unmute"/);
  assert.match(html, /aria-label="Hold"/);
  assert.match(html, /aria-label="Keypad"/);
  assert.match(html, /aria-label="Transfer"/);
  assert.match(html, /aria-label="Stop recording"/);
  assert.match(html, /aria-label="Hang up"/);
  assert.doesNotMatch(html, /aria-label="Mute"/, "muted: the button now offers Unmute");
  assert.doesNotMatch(html, /aria-label="Record"/, "recording: the button now offers Stop recording");
});

test("a held call says On hold and offers Resume; a ringing call says Calling and offers Cancel only", () => {
  const held = renderToStaticMarkup(<Softphone {...base} open mode="held" held caller={caller} secs={9} />);
  assert.match(held, /00:09 · On hold/);
  assert.match(held, /aria-label="Resume"/);
  const ringing = renderToStaticMarkup(<CallBar {...base} open mode="live" caller={caller} connecting />);
  assert.match(ringing, /Calling \+1 415 555 0161/);
  assert.match(ringing, /aria-label="Cancel call"/);
  assert.doesNotMatch(ringing, /softphone-mute/);
});

test("recording without consent says Waiting for consent in the bar and in the pane", () => {
  const bar = renderToStaticMarkup(<CallBar {...base} open mode="live" caller={caller} secs={3} recording />);
  assert.match(bar, /Waiting for consent/);
  const pane = renderToStaticMarkup(<CallPane caller={caller} recording />);
  assert.match(pane, /Recording waits for consent/);
});

test("the Call pane has notes, last interactions, open tasks and a link to the record; no record says so", () => {
  const html = renderToStaticMarkup(<CallPane caller={caller} notes="Asked about the engagement letter" card={{ last: [{ kind: "mail", text: "Engagement letter sent", when: "Mon" }], tasks: [{ title: "Send intake form", due: "Today" }] }} />);
  assert.match(html, /Asked about the engagement letter/);
  assert.match(html, /Last interactions/);
  assert.match(html, /Engagement letter sent/);
  assert.match(html, /Open tasks/);
  assert.match(html, /Send intake form/);
  assert.match(html, /Open Elena Rivera&#x27;s record|Open Elena Rivera's record/);
  const none = renderToStaticMarkup(<CallPane caller={{ number: "+1 999" }} />);
  assert.match(none, /No record has this number/);
});

test("after the call: duration, the summary and transcript, Log a task and the record link", () => {
  const html = renderToStaticMarkup(<Softphone {...base} open mode="ended" caller={caller} endedSecs={134} summary="Elena will sign Friday." transcript={[{ who: "Elena", text: "I will sign Friday." }, { who: "You", text: "Great." }]} />);
  assert.match(html, /Call ended · 02:14/);
  assert.match(html, /Saved to Elena Rivera/);
  assert.match(html, /Elena will sign Friday\./);
  assert.match(html, /I will sign Friday\./);
  assert.match(html, /data-testid="softphone-log-task"/);
  assert.match(html, /data-testid="softphone-open-record"/);
  const saving = renderToStaticMarkup(<Softphone {...base} open mode="ended" caller={caller} endedSecs={5} />);
  assert.match(saving, /Saving your notes/);
});

test("every mode in the frozen list renders without throwing", () => {
  for (const mode of ["idle", "dialer", "incoming", "live", "held", "ended"] as const) {
    const html = renderToStaticMarkup(<Softphone {...base} open={mode !== "idle"} mode={mode} caller={caller} placement="inline" />);
    assert.match(html, /data-testid="softphone"/);
  }
  assert.equal(renderToStaticMarkup(<Softphone open={false} mode="idle" numbers={[]} />), "");
});
