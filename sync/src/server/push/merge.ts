// The per-field merge of a patch op (ARCH 5.4 step 3). Pure: given the field's current clock and the op's, it says apply, lose or conflict, and why.
//   cur == base (or untouched)  apply
//   cur > base                   concurrent:
//     lww        newer (clamped hlc, then actor) wins; the other value is kept in history as lww_loser
//     assistant  the current value stays, a conflict is opened for the assistant, the op's value is parked
//     append     always applied
//     text-crdt  not a field op (Yjs, 5.6): refused
// A current value written by this device's own previous queued op on the field (`after`) is not concurrent, so a person never conflicts with themselves.
import { compareHlc, formatHlc, parseHlc } from "../../../../lib/hlc.ts";
import type { Hlc } from "../../../../lib/hlc.ts";

export type Policy = "lww" | "assistant" | "append" | "text-crdt";
export const POLICIES: readonly Policy[] = Object.freeze(["lww", "assistant", "append", "text-crdt"] as const);

/** One field as the server holds it: value, the hlc and actor that wrote it, and the seq of the event. */
export interface FieldState { v: unknown; hlc: string; actor: string; seq: number }

export interface FieldInput {
  field: string;
  policy: Policy;
  value: unknown;
  /** The seq of the field version the client saw; absent counts as 0 (it saw nothing). */
  base: number | undefined;
  cur: FieldState | undefined;
  /** The op's hlc after the 5 minute clamp. */
  hlc: Hlc;
  actor: string;
  /** The seq the previous queued op of this device on this field was applied at, when the op names one. */
  afterSeq: number | undefined;
}

export type FieldDecision =
  | { field: string; action: "apply"; why: "fresh" | "base_match" | "own_previous" | "lww_win" | "append"; displaced?: FieldState }
  | { field: string; action: "lose"; why: "lww_loser"; winner: FieldState }
  | { field: string; action: "conflict"; ours: FieldState; theirs: unknown; base: number }
  | { field: string; action: "refuse"; why: "text_crdt" };

/** Order two writes of one field: the later hlc wins, the actor id breaks a tie so every server and replay picks the same. */
export function newer(a: { hlc: Hlc; actor: string }, b: { hlc: string; actor: string }): boolean {
  const bh = parseHlc(b.hlc);
  if (!bh) return true;
  const c = compareHlc(a.hlc, bh);
  return c !== 0 ? c > 0 : a.actor > b.actor;
}

export function decideField(i: FieldInput): FieldDecision {
  const { field, cur } = i;
  if (i.policy === "text-crdt") return { field, action: "refuse", why: "text_crdt" };
  if (i.policy === "append") return { field, action: "apply", why: "append" };
  if (!cur) return { field, action: "apply", why: "fresh" };
  // The same hlc from the same actor is this very op seen again (a retry after the capability ran): it does not conflict with itself.
  if (cur.hlc === formatHlc(i.hlc) && cur.actor === i.actor) return { field, action: "apply", why: "own_previous" };
  const base = i.base ?? 0;
  if (cur.seq <= base) return { field, action: "apply", why: "base_match" };
  if (i.afterSeq !== undefined && i.afterSeq === cur.seq) return { field, action: "apply", why: "own_previous" };
  if (i.policy === "assistant") return { field, action: "conflict", ours: cur, theirs: i.value, base };
  return newer({ hlc: i.hlc, actor: i.actor }, cur)
    ? { field, action: "apply", why: "lww_win", displaced: cur }
    : { field, action: "lose", why: "lww_loser", winner: cur };
}
