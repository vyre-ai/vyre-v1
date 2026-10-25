// The helper chat's logic, with no renderer (spec 3.2 Helper chats): where it sits in the address bar, whether it is still running, how its steps read. A helper takes no
// messages, so nothing here is about sending.
import type { CapMap } from "../../../../../../generated/types.ts";
import { BLOCK_FALLBACKS, isNativeBlockType } from "../../../../../../ui/src/blocks/registry.ts";
import { applyFallback } from "../../../../../../ui/src/blocks/GenericBlock.tsx";

export type Thread = CapMap["threads.get"]["out"]["thread"];
export type Message = CapMap["chat.messages.list"]["out"]["messages"][number];
export type MessageBlock = Message["blocks"][number];

export interface Clock { now: number; offsetMin: number }

export type HelperStatus = "running" | "done" | "failed";

/** A helper runs until its thread closes; an error block makes it failed. */
export function helperStatus(t: Thread, messages: readonly Message[]): HelperStatus {
  if (messages.some((m) => m.blocks.some((b) => b.state === "error"))) return "failed";
  return t.closedAt === undefined ? "running" : "done";
}

export interface Crumb { title: string; threadId: string; current: boolean }

/** "Research > Firms 1-3": each part but the last links back to its thread. */
export function addressParts(t: Thread): Crumb[] {
  const path = t.path ?? [];
  const parts: Crumb[] = path.filter((p) => p.threadId !== t.threadId).map((p) => ({ title: p.title, threadId: p.threadId, current: false }));
  parts.push({ title: t.title ?? "Helper", threadId: t.threadId, current: true });
  return parts;
}

/** The thread the helper was started from: the last link in the address bar. Absent for a helper with no recorded parent. */
export function parentOf(t: Thread): { title: string; threadId: string } | null {
  const parts = addressParts(t).filter((p) => !p.current);
  const last = parts[parts.length - 1];
  if (last) return { title: last.title, threadId: last.threadId };
  return t.parentThreadId ? { title: "the chat", threadId: t.parentThreadId } : null;
}

/** Seconds a finished helper took; null while it runs. */
export function seconds(t: Thread): number | null {
  return t.closedAt === undefined ? null : Math.max(0, Math.round((t.closedAt - t.createdAt) / 1000));
}

/** The quiet meta on the right of the address bar: model and time once done. */
export function metaLine(t: Thread, status: HelperStatus): string {
  if (status === "running") return "";
  const model = t.agents[0]?.model;
  const secs = seconds(t);
  return [model, secs === null ? "" : `${secs}s`].filter((x): x is string => x !== undefined && x !== "").join(" · ");
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** One step of the work as a line: a title and a quiet second part. A registered block type reads from its fallback template. */
export function blockLine(b: MessageBlock): { title: string; sub: string; state: MessageBlock["state"] } {
  const data = isRec(b.data) ? b.data : {};
  const fromTemplate = isNativeBlockType(b.type) ? applyFallback(BLOCK_FALLBACKS[b.type], b.data) : "";
  const title = fromTemplate || str(data.title) || str(data.caption) || b.type.replaceAll("_", " ");
  return { title, sub: str(data.sub), state: b.state };
}

export function stepCount(messages: readonly Message[]): number {
  let n = 0;
  for (const m of messages) n += m.blocks.length;
  return n;
}

/** "Worked for 31s, 3 steps" once done; "Working, 2 steps so far" while it runs. */
export function workSummary(t: Thread, messages: readonly Message[], status: HelperStatus): string {
  const n = stepCount(messages);
  const steps = `${n} ${n === 1 ? "step" : "steps"}`;
  if (status === "running") return `Working, ${steps} so far`;
  const secs = seconds(t);
  return secs === null ? steps : `Worked for ${secs}s, ${steps}`;
}

export function byOrder(messages: readonly Message[]): Message[] {
  return messages.slice().sort((a, b) => a.threadSeq - b.threadSeq);
}

export function whenLabel(ts: number, c: Clock): string {
  const d = new Date(ts + c.offsetMin * 60_000);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

export const READ_ONLY_NOTE = "Helpers work from their brief and can't take messages.";
