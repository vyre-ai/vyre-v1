// The work a turn started, as link cards (rc.9, "all work appears as a card in the chat you are in"). Each tool call that makes something a person would want to find again (a task, a Run, a record, a file,
// a Routine, a handoff, a computer, a send waiting on a yes) is noted against its turn here, and the bridge puts the cards under the agent's reply when the turn ends, so several from one turn are one group
// under the words, not a pile. The card carries only a name and where it lives; its state (running, done, waiting on you) and whether the reader may see it are read by the app when it draws the card.
import type { LinkCardData } from "../../../ui/src/blocks/link-card/model.ts";

export interface WorkCard extends LinkCardData { /** one card per thing: a record changed twice is one card */ key: string }

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const first = (...v: unknown[]): string => v.map(s).find((x) => x.trim() !== "")?.trim() ?? "";
const clip = (x: string, n = 80): string => (x.length > n ? `${x.slice(0, n - 1)}…` : x);

/** A name for a record from the fields a person would call its name. */
function recordName(r: Record<string, unknown>): string {
  const f = rec(r["fields"]);
  return first(f["name"], f["title"], f["subject"], ...Object.values(f).filter((x) => typeof x === "string"));
}

/** The card for one finished tool call, or null when the call made nothing worth a card. `output` is the capability's answer. */
export function workCardOf(cap: string, input: unknown, output: unknown): WorkCard | null {
  const i = rec(input), o = rec(output);
  switch (cap) {
    case "tasks.create": {
      const t = rec(o["task"]);
      return s(t["id"]) ? { key: `task:${s(t["id"])}`, icon: "task", lead: "Task created", title: clip(first(t["title"], i["title"], "A task")), target: { type: "task", id: s(t["id"]) } } : null;
    }
    case "automations.run": case "automations.test": {
      const id = s(o["runId"]);
      return id ? { key: `run:${id}`, icon: "run", lead: cap === "automations.test" ? "Test started" : "Run started", title: clip(first(i["name"], "A Flow")), target: { type: "run", id } } : null;
    }
    case "records.create": case "records.update": {
      const r = rec(o["record"]);
      const id = s(r["id"]);
      return id ? { key: `record:${id}`, icon: "record", lead: cap === "records.create" ? "Record created" : "Record changed", title: clip(recordName(r) || "A record"), target: { type: "record", id }, via: s(r["type"]) || s(i["type"]) } : null;
    }
    case "files.create": {
      const f = rec(o["file"]);
      return s(f["fileId"]) ? { key: `file:${s(f["fileId"])}`, icon: "file", lead: "File made", title: clip(first(f["name"], i["name"], "A file")), target: { type: "file", id: s(f["fileId"]) } } : null;
    }
    case "agents.routine.save": {
      const r = rec(o["routine"]);
      return s(r["routineId"]) ? { key: `routine:${s(r["routineId"])}`, icon: "run", lead: "Routine saved", title: clip(first(r["title"], i["title"], "A Routine")), ...(s(i["agentId"]) ? { target: { type: "agent", id: s(i["agentId"]) } } : {}) } : null;
    }
    case "chat.handoff": {
      const t = rec(rec(o["thread"])["thread"] ?? o["thread"]);
      const id = s(t["threadId"]);
      return id ? { key: `thread:${id}`, icon: "thread", lead: "Handed off", title: clip(first(t["title"], "A linked thread")), target: { type: "thread", id } } : null;
    }
    case "computers.provision": {
      const c = rec(o["computer"]);
      return s(c["computerId"]) ? { key: `computer:${s(c["computerId"])}`, icon: "computer", lead: "Computer ready", title: clip(first(c["name"], "Agent computer")), target: { type: "computer", id: s(c["computerId"]) } } : null;
    }
    default: return null;
  }
}

/** A call a person must say yes to: the card is the one place in the chat that says so and opens the task. */
export function heldCard(cap: string, taskId: string): WorkCard {
  const send = /(^|\.)send($|_)/.test(cap) || cap.startsWith("mail.");
  return { key: `task:${taskId}`, icon: "task", lead: "Held for you", title: send ? "A message to send" : "A step to approve", target: { type: "task", id: taskId } };
}

const WORK = new Map<string, Map<string, WorkCard>>();
/** Note one card against a turn; the same thing twice is one card (the later wording wins). */
export function recordWork(turnId: string | undefined, card: WorkCard | null): void {
  if (!turnId || !card) return;
  const turn = WORK.get(turnId) ?? new Map<string, WorkCard>();
  turn.set(card.key, card);
  WORK.set(turnId, turn);
  if (WORK.size > 500) WORK.delete(WORK.keys().next().value as string);
}
/** The cards a turn made, in the order it made them; they are gone once taken. */
export function takeWork(turnId: string): WorkCard[] {
  const turn = WORK.get(turnId);
  WORK.delete(turnId);
  return turn ? [...turn.values()] : [];
}
/** The link_card blocks for a turn's cards (the key stays out of the block). */
export function workBlocks(turnId: string): { type: string; v: number; data: unknown }[] {
  return takeWork(turnId).slice(0, 12).map(({ key: _k, ...card }) => ({ type: "link_card", v: 1, data: card }));
}
