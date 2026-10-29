// Search across every chat: what a hit says about itself, in plain words. No renderer here. The server (chat.search) finds messages by their words and, when the Space has a search model, by
// meaning; this turns a hit into a title, a time, a snippet with the matched words marked, and a group by day.
import type { CapMap } from "../../../../../../generated/types.ts";
import { dayLabel, timeLabel } from "../conversation/model.ts";
import type { Clock } from "../conversation/model.ts";

export type SearchOut = CapMap["chat.search"]["out"];
export type Hit = SearchOut["hits"][number];

export const DEBOUNCE_MS = 250;
export const LIMIT = 30;

/** The name of the chat a hit is in: a channel by its name, a titled chat by its title, otherwise the agents or people it is with. Never an id. */
export function chatTitle(h: Hit, nameOf: (id: string) => string, meId: string): string {
  const t = h.thread;
  if (t.channelName) return `#${t.channelName}`;
  if (t.title) return t.title;
  const agents = t.agentIds.map(nameOf);
  if (agents.length > 0) return agents.length === 1 ? agents[0]! : `${agents[0]} and ${agents.length - 1} more`;
  const others = t.memberIds.filter((m) => m !== meId).map(nameOf);
  return others.length > 0 ? others.join(", ") : "Chat";
}

export interface Piece { text: string; mark: boolean }

const WORD = /[^\p{L}\p{N}]+/u;
export const wordsOf = (q: string): string[] => [...new Set(q.toLowerCase().split(WORD).filter((w) => w.length >= 2))];

/** The snippet cut at the words of the question: the pieces that match are marked. */
export function highlight(snippet: string, query: string): Piece[] {
  const words = wordsOf(query);
  if (words.length === 0) return [{ text: snippet, mark: false }];
  const lower = snippet.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(w, from);
      if (i < 0) break;
      spans.push([i, i + w.length]);
      from = i + w.length;
    }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && (s[0] <= last[1] || /^\s+$/.test(snippet.slice(last[1], s[0])))) last[1] = Math.max(last[1], s[1]);   // words that touch, or sit with only space between, are one mark
    else merged.push([s[0], s[1]]);
  }
  const out: Piece[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: snippet.slice(at, a), mark: false });
    out.push({ text: snippet.slice(a, b), mark: true });
    at = b;
  }
  if (at < snippet.length) out.push({ text: snippet.slice(at), mark: false });
  return out;
}

export const whenLine = (ts: number, c: Clock): string => `${dayLabel(ts, c)}, ${timeLabel(ts, c)}`;

/** What the line under the box says about how the search ran. */
export function statusLine(out: SearchOut | null, loading: boolean, query: string): string {
  if (query.trim() === "") return "";
  if (loading && !out) return "Searching";
  if (!out) return "";
  const n = out.hits.length;
  const how = out.meaning ? "by words and meaning" : "by words";
  const head = n === 0 ? `Nothing found ${how}` : `${n} ${n === 1 ? "result" : "results"} ${how}`;
  return out.sealedChats > 0 ? `${head}. ${out.sealedChats} end-to-end ${out.sealedChats === 1 ? "chat is" : "chats are"} not searched here.` : head;
}
