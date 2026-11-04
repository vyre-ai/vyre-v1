// The Hooks tab's logic, with no renderer (lane l-hooks): how a hook reads in plain words, which group it sits in, and what the edit form turns into. Words follow the approved prototype (p-crew).
import type { CapMap } from "../../../../../../generated/types.ts";

export type Hook = CapMap["hooks.list"]["out"]["hooks"][number];
export type HookKind = "command" | "check" | "action";

/** The kinds as a person reads them. */
export const KIND_WORDS: Readonly<Record<HookKind, string>> = { command: "Run a script", check: "Ask a quick check", action: "Do an action" };
export const KIND_ORDER: readonly HookKind[] = ["command", "check", "action"];
/** When a hook runs, in a few words (the "When" of the form). */
export const EVENT_WORDS: Readonly<Record<string, string>> = {
  "session.start": "When a session starts", "prompt.submit": "Before each message is read", "tool.before": "Before a tool runs", "tool.after": "After a tool runs",
  "outward.before": "Before anything leaves Vyre", "turn.end": "When a turn ends", "helper.start": "Before a helper starts", "helper.end": "When a helper ends",
};
export const EVENT_ORDER: readonly string[] = Object.keys(EVENT_WORDS);

/** The order and names of the groups: this chat first, then the run and its helpers, then the agent everywhere, then the Space and the person. */
export const GROUPS: ReadonlyArray<{ key: string; scopes: readonly string[]; title: (agent: string) => string }> = [
  { key: "chat", scopes: ["chat"], title: () => "This chat" },
  { key: "run", scopes: ["run"], title: () => "This run and its helpers" },
  { key: "agent", scopes: ["agent"], title: (a) => `${a} everywhere` },
  { key: "person", scopes: ["person"], title: () => "Yours" },
  { key: "space", scopes: ["space"], title: () => "Space" },
];
export function grouped(hooks: readonly Hook[], agent: string): Array<{ key: string; title: string; hooks: Hook[] }> {
  return GROUPS.map((g) => ({ key: g.key, title: g.title(agent), hooks: hooks.filter((h) => g.scopes.includes(h.scope)) })).filter((g) => g.hooks.length > 0);
}
export const countLine = (hooks: readonly Hook[]): string => `${hooks.length} in this chat, ${hooks.filter((h) => h.paused).length} paused`;

export const kindWord = (h: Pick<Hook, "kind">): string => KIND_WORDS[h.kind as HookKind] ?? h.kind;
export function whatOf(h: Pick<Hook, "kind" | "spec">): string {
  const s = (h.spec ?? {}) as { command?: string; instruction?: string; cap?: string };
  return (h.kind === "check" ? s.instruction : h.kind === "action" ? s.cap : s.command) ?? "";
}
/** "Made by Assistant", or the person's name where it is known. */
export const madeBy = (h: Pick<Hook, "madeBy" | "madeByKind">, nameOf: (id: string) => string): string => (h.madeByKind === "admin" ? `${nameOf(h.madeBy)} (admin)` : nameOf(h.madeBy));
export const canRemoveNote = "Only an admin can remove this";

/** The first sentence of a hook's line, lower-cased, for "Assistant added a hook in this chat: ..." style lines. */
export const lowerFirst = (s: string): string => (s === "" ? s : s[0]!.toLowerCase() + s.slice(1));

/** What the edit form saves: the same hook with its new words. Null when a field is empty. */
export interface Draft { event: string; kind: HookKind; what: string }
export function draftOf(h: Hook): Draft { return { event: h.event, kind: h.kind as HookKind, what: whatOf(h) }; }
export function setInput(h: Hook, d: Draft, threadId: string): Record<string, unknown> | null {
  const what = d.what.trim();
  if (what === "") return null;
  return {
    id: h.id, scope: h.scope, event: d.event, kind: d.kind, matcher: h.matcher, threadId, timeoutSec: h.timeoutSec, helpers: h.helpers,
    ...(d.kind === "command" ? { command: what } : d.kind === "check" ? { instruction: what } : { cap: what, input: (h.spec as { input?: unknown }).input ?? {} }),
  };
}
/** The hook as it was, to bring it back after Remove: a new hook with the same words (a removed row is gone for good). */
export function restoreInput(h: Hook, threadId: string): Record<string, unknown> {
  return { scope: h.scope, event: h.event, kind: h.kind, matcher: h.matcher, timeoutSec: h.timeoutSec, helpers: h.helpers, summary: h.line, threadId, ...(h.agentId ? { agentId: h.agentId } : {}), ...(whatOf(h) ? (h.kind === "command" ? { command: whatOf(h) } : h.kind === "check" ? { instruction: whatOf(h) } : { cap: whatOf(h), input: (h.spec as { input?: unknown }).input ?? {} }) : {}) };
}
