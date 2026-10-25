// Inbox > softphone wiring (spec 2.18, ARCH 7.3): what the shared ui/Softphone needs from the Inbox's data. The numbers come from telephony.number.list, a caller's name from the calls the
// Space already holds, and the phone hooks run the telephony capabilities (dial, hangup, hold, transfer, record). Pure, so the tests read them without drawing anything.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PhoneHooks } from "../../../../../../ui/src/Softphone/index.tsx";
import type { SoftphoneCaller, SoftphoneNumber, TransferTarget } from "../../../../../../ui/src/Softphone/index.tsx";
import type { ContactRow } from "../sidebar/model.ts";

export type NumbersOut = CapMap["telephony.number.list"]["out"];
export type CallsOut = CapMap["telephony.call.list"]["out"];
export type CallOut = CapMap["telephony.hangup"]["out"]["call"];

/** `+14155550132` as `+1 415 555 0132`; anything that is not a North American number stays as it is. */
export function prettyNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.replace(/\s/g, ""));
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export const digitsOf = (n: string): string => n.replace(/\D/g, "");
/** Two numbers are the same when their digits are (the ten-digit form counts as a US number). */
export const sameNumber = (a: string, b: string): boolean => {
  const x = digitsOf(a), y = digitsOf(b);
  const tail = (d: string): string => (d.length === 11 && d.startsWith("1") ? d.slice(1) : d);
  return x.length > 0 && tail(x) === tail(y);
};

/** The numbers a person may call from: the ones that carry voice. */
export function numbersOf(out: NumbersOut | null): SoftphoneNumber[] {
  return (out?.numbers ?? []).filter((n) => n.capabilities.includes("voice")).map((n) => ({ id: n.id, label: n.displayName ?? n.title, num: prettyNumber(n.e164) }));
}

/** Who is on the line, from the calls already in the replica: the contact of the last call that came from or went to this number. */
export function callerOf(number: string, calls: CallsOut | null, rows: readonly ContactRow[]): SoftphoneCaller {
  const call = [...(calls?.calls ?? [])].sort((a, b) => b.startedAt - a.startedAt).find((c) => c.contactId !== undefined && (sameNumber(c.from, number) || sameNumber(c.to, number)));
  const row = call ? rows.find((r) => r.contactId === call.contactId) : undefined;
  return { number: prettyNumber(number), ...(row ? { name: row.displayName, recordId: row.contactId as string } : {}) };
}

/** Dial-pad suggestions: people whose last call used the number typed so far. */
export function suggestionsFor(typed: string, calls: CallsOut | null, rows: readonly ContactRow[]): { name: string; number: string }[] {
  const d = digitsOf(typed);
  if (d.length < 2) return [];
  const seen = new Map<string, { name: string; number: string }>();
  for (const c of calls?.calls ?? []) {
    if (c.contactId === undefined) continue;
    const other = c.direction === "in" ? c.from : c.to;
    const row = rows.find((r) => r.contactId === c.contactId);
    if (row && digitsOf(other).includes(d) && !seen.has(row.id)) seen.set(row.id, { name: row.displayName, number: prettyNumber(other) });
  }
  return [...seen.values()].slice(0, 3);
}

export interface PhoneIds {
  /** The number the person calls from. */
  numberId(): string;
  /** The call the server opened for this dial, once it answered. */
  callId(): string | undefined;
  setCallId(id: string): void;
  /** The contact the dialled number belongs to, when the dialer knew it. */
  contactId(): string | undefined;
}

const key = (): string => globalThis.crypto.randomUUID();

/** The server actions around the media path: each runs one telephony capability and keeps the dial's call id for the rest. */
export function phoneHooks(call: (cap: string, input: unknown) => Promise<unknown>, ids: PhoneIds, o: { targets?: readonly (TransferTarget & { id: string; kind2: "person" | "agent" })[]; onHungUp?: (c: CallOut) => void } = {}): PhoneHooks {
  const need = (): string => { const id = ids.callId(); if (!id) throw new Error("There is no call to do that on."); return id; };
  return {
    async dial(to) {
      const out = (await call("telephony.dial", { numberId: ids.numberId(), to, ...(ids.contactId() ? { contactId: ids.contactId() } : {}), idempotencyKey: key() })) as { callId: string; params: Record<string, string> };
      ids.setCallId(out.callId);
      return out.params;
    },
    async hold(held) { await call("telephony.hold", { callId: need(), hold: held }); },
    async transfer(name) {
      const t = o.targets?.find((x) => x.name === name);
      if (!t) throw new Error(`${name} cannot take a call.`);
      await call("telephony.transfer", { callId: need(), to: { kind: t.kind2, id: t.id }, mode: "warm" });
    },
    async record(start) {
      await call("telephony.record", start ? { callId: need(), action: "start", consent: { announced: true } } : { callId: need(), action: "stop" });
      return { consentLogged: start };
    },
    hangup() {
      const id = ids.callId();
      if (!id) return;
      void call("telephony.hangup", { callId: id }).then((out) => o.onHungUp?.((out as { call: CallOut }).call));
    },
  };
}

/** The line under an ended call: where it was saved. */
export function savedLine(name: string | undefined): string {
  return name ? `Saved to ${name}'s conversation` : "Saved to the Inbox as a call from an unmatched number";
}
