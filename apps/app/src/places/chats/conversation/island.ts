// The Island's reading of the chat: who is working and what each one is doing, from the live turns and their activity frames (the same ones the line under a reply reads). Pure, so the
// pill, its hover and its list all say the same words, and the tests read it without a screen. Nothing here is invented: an agent is in the Island only because it has a turn in progress.
import type { ActivitySnapshot, LiveTurn } from "../../../shell/session/turn-streams.ts";
import { elapsedWords, stepLabel, stepWords } from "./activity.ts";

export type Ring = "working" | "waiting" | "done";
export interface IslandAgent {
  agentId: string;
  name: string;
  /** working: a moving ring. waiting: an amber ring (it asked you something, or waits for a computer). done: a green dot. */
  ring: Ring;
  /** The one writing words now: highlighted. */
  writing: boolean;
  /** The state word: "Thinking", "Writing", "Reading", "Searching the web". */
  word: string;
  /** The same with what it touches: "Reading model.ts". */
  line: string;
  seconds: number;
  /** It is using its computer (a computer or browser tool step is live): the Island offers Watch the computer. */
  computer: boolean;
}

const WAITING = new Set(["askuserquestion", "device_wait"]);
const COMPUTER = /^(mcp__)?(computer|vyre[-_]chrome)|^chrome_|^computer_/i;

/** One agent's row from its turn, its activity so far and whether words are on the way. */
export function agentOf(turn: Pick<LiveTurn, "agentId" | "state" | "startedAt">, act: ActivitySnapshot | undefined, hasWords: boolean, name: string, now: number): IslandAgent {
  const live = act ? [...act.steps].reverse().find((s) => s.state === "live") : undefined;
  const ended = turn.state === "ended" || act?.done === true;
  const waiting = live !== undefined && WAITING.has(live.name.toLowerCase());
  const writing = !ended && !waiting && hasWords && live === undefined;
  const word = ended ? "Finished" : waiting ? "Waiting" : live ? stepWords(live.name) : hasWords ? "Writing" : "Thinking";
  const line = ended ? "Finished" : live ? stepLabel(live.name, live.detail) : hasWords ? "Writing" : "Thinking";
  return {
    agentId: turn.agentId, name, ring: ended ? "done" : waiting ? "waiting" : "working", writing, word, line, seconds: Math.max(0, Math.round((now - turn.startedAt) / 1000)),
    computer: !ended && (act?.steps ?? []).some((s) => s.state === "live" && COMPUTER.test(s.name)),
  };
}

/** The word beside the mark: the one writing now, else the first still working. */
export function wordOf(agents: readonly IslandAgent[]): string {
  const busy = agents.filter((a) => a.ring !== "done");
  return (busy.find((a) => a.writing) ?? busy[0])?.word ?? "";
}

/** "Mira · Writing · 40 s", the hover on a face. */
export function hoverOf(a: IslandAgent): string {
  const t = a.ring === "done" ? "" : elapsedWords(a.seconds);
  return [a.name, a.line, t].filter((x) => x !== "").join(" · ");
}

/** On a phone: at most `max` faces, then how many more. */
export function capFaces<T>(list: readonly T[], max: number): { shown: T[]; more: number } {
  return list.length <= max ? { shown: [...list], more: 0 } : { shown: list.slice(0, max), more: list.length - max };
}

/** Whether the Island shows at all: someone is writing, or a job is running in the background. A finished face alone does not keep it open. */
export const islandOpen = (agents: readonly IslandAgent[], jobs: number): boolean => agents.some((a) => a.ring !== "done") || jobs > 0;
