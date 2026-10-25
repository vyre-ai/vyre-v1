// Inbox > a live call in the conversation (prototype Inbox, the call states): while a call is with the person whose conversation is open, the call bar sits in the conversation's header and the
// Call tab of the side pane holds the notes, the last interactions and the open tasks. Pure helpers: which conversation a call belongs to, and the pane's card from the thread.
import type { CallCard } from "../../../../../../ui/src/Softphone/index.tsx";
import type { ThreadItem } from "../contacttab/model.ts";
import { listTime } from "../sidebar/model.ts";
import { sameNumber } from "../softphone/model.ts";
import type { ConversationKey } from "../softphone/phone.tsx";

/** Is this call with this conversation's person? By the record when both know it, else by the number. */
export function callIsWith(conv: ConversationKey, peer: string, callerRecordId: string | undefined): boolean {
  if (peer === "") return false;
  if (callerRecordId !== undefined && conv.contactId !== undefined) return callerRecordId === conv.contactId;
  return sameNumber(conv.address, peer);
}

const KIND: Partial<Record<ThreadItem["kind"], "mail" | "sms" | "call" | "vm">> = { email: "mail", sms: "sms", call: "call", meeting: "call" };

/** The last interactions: the newest four emails, texts and calls of the thread, newest first, each with its when. */
export function lastInteractions(items: readonly ThreadItem[], now: number, offsetMin: number): NonNullable<CallCard["last"]> {
  return [...items]
    .filter((i) => KIND[i.kind] !== undefined)
    .sort((a, b) => b.at - a.at)
    .slice(0, 4)
    .map((i) => ({ kind: KIND[i.kind]!, text: (i.title && i.kind !== "sms" ? i.title : i.preview) ?? "", when: listTime(i.at, now, offsetMin) }));
}

export interface OpenTask { title: string; due?: string }

/** The Call tab's card: the thread's last interactions and the tasks the person has open. */
export function cardOf(items: readonly ThreadItem[], tasks: readonly OpenTask[], now: number, offsetMin: number): CallCard {
  return { last: lastInteractions(items, now, offsetMin), tasks };
}

/** The header strip is shown while a call is live, held or just ended (the after-call line stays until it is dismissed). */
export const showsCall = (phase: string): boolean => phase === "live" || phase === "held" || phase === "ended";
