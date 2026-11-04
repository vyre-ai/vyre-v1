// The Island's reading of the chat: who is working and what each one is doing, from the live turns and their activity frames (the same ones the line under a reply reads). Pure, so the
// pill, its hover and its list all say the same words, and the tests read it without a screen. Nothing here is invented: an agent is in the Island only because it has a turn in progress.
import type { ActivitySnapshot, LiveTurn } from "../../../shell/session/turn-streams.ts";
import { elapsedWords, stepLabel, stepWords } from "./activity.ts";
import { questionOptions, terminalAskOf } from "./model.ts";
import type { Message } from "./model.ts";
import { mountOffers } from "./mountcard.ts";

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

export interface IslandChoice { id: string; label: string; detail: string; recommended: boolean }
export interface IslandQuestion {
  blockId: string;
  agentId: string;
  name: string;
  prompt: string;
  /** The choices to press. Empty for a free-text question: only the text field answers it. */
  choices: IslandChoice[];
  /** The text field ("Other") is offered. A free-text question always has it. */
  other: boolean;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The questions agents are waiting on, oldest first, for the Island to offer as a shortcut. Only a plain single-choice or free-text question is here: a multi-choice question, a terminal
 * card and a folder-mount card need their own card, so they stay in the chat. The first option marked "Recommended" is the filled one (the option's detail says so); with none marked, none is.
 */
export function questionsOf(messages: readonly Pick<Message, "author" | "blocks">[], nameOf: (id: string) => string): IslandQuestion[] {
  const out: IslandQuestion[] = [];
  for (const m of messages) {
    if (m.author.kind !== "agent") continue;
    for (const b of m.blocks) {
      if (b.type !== "question" || b.state !== "waiting" || !isRec(b.data)) continue;
      const d = b.data;
      const mode = text(d["mode"]);
      if (mode === "multi" || terminalAskOf(d) !== null) continue;
      const options = questionOptions(d);
      if (mountOffers(options) !== null) continue;
      const raw = Array.isArray(d["options"]) ? d["options"] : [];
      let marked = false;
      const choices = options.map((o, i): IslandChoice => {
        const detail = isRec(raw[i]) ? text((raw[i] as Record<string, unknown>)["detail"]) : "";
        const recommended = !marked && /^recommended/i.test(detail);
        if (recommended) marked = true;
        return { id: o.id, label: o.label, detail, recommended };
      });
      const prompt = text(d["prompt"]) || text(d["title"]);
      if (prompt === "") continue;
      out.push({ blockId: b.id, agentId: m.author.id, name: nameOf(m.author.id), prompt, choices, other: choices.length === 0 || d["allowOther"] === true });
    }
  }
  return out;
}

/** A number key picks the choice with that number (1 is the first); anything else, or a number past the last choice, picks none. */
export const choiceForKey = (key: string, count: number): number | null => (/^[1-9]$/.test(key) && Number(key) <= count ? Number(key) - 1 : null);
