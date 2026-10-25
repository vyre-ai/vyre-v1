// The samples behind the softphone tests and screenshots: a fake Twilio Voice device (the real Device is the shell's) and the telephony capabilities answered over the Inbox sample replica, so
// a dial writes a call row, a hangup saves the call into the conversation of the person it was with (or into a new unmatched line when nobody matches), and hold, record, transfer and Log a task
// are recorded. The resolvers and writes honour their inputs, the way the real replica and server would.
import type { Row } from "../../../../../../client/src/index.ts";
import type { PhoneCallEvent, PhoneCallLike, PhoneDeviceLike } from "../../../../../../ui/src/Softphone/index.tsx";
import { SAMPLE_NOW } from "../contactlist/sample.ts";
import type { ContactTabSample } from "../contacttab/sample.ts";
import type { InboxData } from "../sidebar/data.tsx";
import type { ContactRow } from "../sidebar/model.ts";
import { digitsOf, sameNumber } from "./model.ts";

/** Numbers the sample's people call from. */
export const PHONE_OF: Readonly<Record<string, string>> = { elena: "+1 415 555 0161", marcus: "+1 415 555 0188", dana: "+1 917 555 0126", hannah: "+1 408 555 0102", nina: "+1 646 555 0150" };
export const SAMPLE_NUMBER_ID = "+1 415 555 0132";

export class FakeCall implements PhoneCallLike {
  parameters: { From?: string; To?: string; CallSid?: string };
  private handlers = new Map<PhoneCallEvent, ((arg?: unknown) => void)[]>();
  readonly log: string[] = [];
  constructor(parameters: { From?: string; To?: string; CallSid?: string }) { this.parameters = parameters; }
  accept(): void { this.log.push("accept"); this.fire("accept"); }
  reject(): void { this.log.push("reject"); this.fire("reject"); }
  disconnect(): void { this.log.push("disconnect"); this.fire("disconnect"); }
  mute(on: boolean): void { this.log.push(on ? "mute" : "unmute"); }
  sendDigits(d: string): void { this.log.push(`digits:${d}`); }
  on(event: PhoneCallEvent, handler: (arg?: unknown) => void): void { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); }
  fire(event: PhoneCallEvent, arg?: unknown): void { for (const h of this.handlers.get(event) ?? []) h(arg); }
}

export class FakeVoiceDevice implements PhoneDeviceLike {
  readonly connected: { params: Record<string, string>; call: FakeCall }[] = [];
  destroyed = false;
  private incoming: ((call: PhoneCallLike) => void)[] = [];
  /** A connect answers on the next tick, as a call that picks up. */
  async connect(options: { params: Record<string, string> }): Promise<PhoneCallLike> {
    const call = new FakeCall({ To: options.params["To"], CallSid: options.params["CallSid"] });
    this.connected.push({ params: options.params, call });
    setImmediate(() => call.fire("accept")); // after the caller has attached its handlers, as a real answer is
    return call;
  }
  on(_event: "incoming", handler: (call: PhoneCallLike) => void): void { this.incoming.push(handler); }
  destroy(): void { this.destroyed = true; }
  /** Somebody calls in. */
  ring(from: string): FakeCall {
    const call = new FakeCall({ From: from, To: SAMPLE_NUMBER_ID, CallSid: `CA_in_${this.connected.length}` });
    for (const h of this.incoming) h(call);
    return call;
  }
}

export interface TelephonyRecord { cap: string; input: unknown }
export interface PhoneSample<T extends ContactTabSample = ContactTabSample> {
  base: T;
  data: InboxData;
  device: FakeVoiceDevice;
  /** Every telephony write the dock made, in order. */
  telephony: TelephonyRecord[];
}

const ago = (m: number): number => SAMPLE_NOW - m * 60_000;

/** The Inbox sample with the telephony capabilities of the softphone. `data.call` answers them and passes everything else on. */
export function withTelephony<T extends ContactTabSample>(base: T): PhoneSample<T> {
  const { replica } = base;
  const telephony: TelephonyRecord[] = [];
  const device = new FakeVoiceDevice();
  const contacts = (): ContactRow[] => replica.rows("contacts") as unknown as ContactRow[];
  const find = (number: string): ContactRow | undefined => {
    const hit = Object.entries(PHONE_OF).find(([, n]) => sameNumber(n, number));
    return hit ? contacts().find((c) => c.id === hit[0]) : contacts().find((c) => c.contactId === undefined && sameNumber(c.address, number));
  };
  let seq = 0;
  const calls = (): Record<string, unknown>[] => replica.rows("calls") as unknown as Record<string, unknown>[];

  replica.resolve("telephony.number.list", () => ({
    numbers: [{
      id: SAMPLE_NUMBER_ID, e164: "+14155550132", title: "Irfad", capabilities: ["voice", "sms"], assigneeKind: "person", assigneeId: "usr_irfad",
      route: { ring: [{ kind: "person", id: "usr_irfad" }], ringSeconds: 20, voicemail: true, voicemailTranscript: true },
      hours: { zone: "UTC", weekly: [], outsideHours: "voicemail" }, recording: "ask", a2p: "approved",
    }],
  } as never));

  const writes: Record<string, (i: never) => unknown> = {
    "telephony.dial": (i: { numberId: string; to: string; contactId?: string }) => {
      telephony.push({ cap: "telephony.dial", input: i });
      const callId = `cal_new_${++seq}`;
      const who = i.contactId ? contacts().find((c) => c.contactId === i.contactId) : find(i.to);
      replica.put("calls", [{
        id: callId, numberId: i.numberId, direction: "out", from: i.numberId, to: i.to, ...(who?.contactId ? { contactId: who.contactId } : {}), state: "ringing", startedAt: SAMPLE_NOW,
        hasTranscript: false, consentLogged: false,
      } as unknown as Row]);
      return { callId, params: { To: i.to, CallSid: callId } };
    },
    "telephony.hangup": (i: { callId: string }) => {
      telephony.push({ cap: "telephony.hangup", input: i });
      const call = calls().find((c) => c["id"] === i.callId);
      if (!call) throw new Error(`no such call ${i.callId}`);
      if (call["state"] === "completed") return { call };
      const done = { ...call, state: "completed", answeredAt: SAMPLE_NOW, endedAt: SAMPLE_NOW + 12_000, durationSec: 12 };
      replica.put("calls", [done as unknown as Row]);
      const to = String(call["to"]);
      let who = typeof call["contactId"] === "string" ? contacts().find((c) => c.contactId === call["contactId"]) : find(to);
      // nobody matches this number: the call is saved as a new unmatched line
      if (!who) {
        who = { id: `u_${digitsOf(to)}`, address: to, displayName: to, lastMessageAt: SAMPLE_NOW, lastChannel: "call", lastPreview: "Outgoing call · 0:12", unreadCount: 0, needsMatch: true, followed: false, alertOnReplies: false, mailboxIds: [String(call["numberId"])] } as ContactRow;
      }
      replica.put("thread_items", [{ conversationId: who.id, kind: "call", id: `c_${i.callId}`, at: SAMPLE_NOW, direction: "out", title: "Outgoing call", preview: "Outgoing call · 0:12", ref: { state: "completed", durationSec: 12, via: String(call["numberId"]), address: to } } as unknown as Row]);
      replica.put("contacts", [{ ...who, lastMessageAt: SAMPLE_NOW, lastChannel: "call", lastPreview: "Outgoing call · 0:12" } as unknown as Row]);
      return { call: { ...done, ...(who.contactId ? { contactId: who.contactId } : {}) } };
    },
    "telephony.hold": (i: { callId: string; hold: boolean }) => { telephony.push({ cap: "telephony.hold", input: i }); return { call: calls().find((c) => c["id"] === i.callId) }; },
    "telephony.transfer": (i: unknown) => { telephony.push({ cap: "telephony.transfer", input: i }); return { ok: true }; },
    "telephony.record": (i: unknown) => { telephony.push({ cap: "telephony.record", input: i }); return { ok: true }; },
    "telephony.call.log_task": (i: unknown) => { telephony.push({ cap: "telephony.call.log_task", input: i }); return { taskId: `tsk_call_${++seq}` }; },
  };

  const data: InboxData = {
    ...base.data,
    async call(cap, input) {
      const w = writes[cap];
      if (!w) return base.data.call(cap, input);
      base.calls.push({ cap, input });
      return w(input as never);
    },
  };
  return { base, data, device, telephony };
}
