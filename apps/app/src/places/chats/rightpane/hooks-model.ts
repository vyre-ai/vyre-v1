// The Hooks tab's logic, with no renderer (lane l-hooks): how a hook reads in plain words, which group it sits in, and what the edit form turns into. Words follow the approved prototype (p-crew).
import type { CapMap } from "../../../../../../generated/types.ts";
import { ACTION_CHOICES, ACTION_EVENTS, actionWords, capWords, choiceFor, matcherFor } from "../../../../../../lib/hooks.ts";

export type Hook = CapMap["hooks.list"]["out"]["hooks"][number];
export type HookKind = "command" | "check" | "action";

/** The kinds as a person reads them. */
export const KIND_WORDS: Readonly<Record<HookKind, string>> = { command: "Run a script", check: "Ask a quick check", action: "Do an action" };
export const KIND_ORDER: readonly HookKind[] = ["command", "check", "action"];
/** When a hook runs, in a few words (the "When" of the form). */
export const EVENT_WORDS: Readonly<Record<string, string>> = {
  "session.start": "When a session starts", "prompt.submit": "Before each message is read", "tool.before": "Before any action", "tool.after": "After any action",
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
/** The words a hook does something with, as the form edits them: the check's instruction, the capability, or the command. */
export function rawOf(h: Pick<Hook, "kind" | "spec">): string {
  const s = (h.spec ?? {}) as { command?: string; instruction?: string; cap?: string };
  return (h.kind === "check" ? s.instruction : h.kind === "action" ? s.cap : s.command) ?? "";
}
/** The things an action hook can do, in plain words, with the capability each one calls (kept internal: the form shows the words). */
export const DO_CHOICES: ReadonlyArray<{ key: string; title: string }> = [
  { key: "chat.post", title: "Post a quiet line in the chat" },
];
/** The choices for a hook's "Do this": the known ones, and the hook's own when it calls something else, in plain words. */
export function doOptions(cap: string): Array<{ key: string; title: string }> {
  const o = DO_CHOICES.map((c) => ({ ...c }));
  if (cap !== "" && !o.some((c) => c.key === cap)) { const w = capWords(cap); o.push({ key: cap, title: w[0]!.toUpperCase() + w.slice(1) }); }
  return o;
}
/** What a script does, in the plain words its maker gave the hook: the part of its line after the first comma ("keep to the Space rules"). The file name belongs to the edit form. */
export function describedAs(h: Pick<Hook, "line">): string {
  const i = h.line.indexOf(",");
  const d = i >= 0 ? h.line.slice(i + 1).trim() : "";
  return d === "" ? "" : d[0]!.toUpperCase() + d.slice(1);
}
/** What a card says the hook does: an action is its plain words ("Post in the chat"), a script is what it is for, never a capability name or a file name. */
export function whatOf(h: Pick<Hook, "kind" | "spec"> & { line?: string }): string {
  if (h.kind === "action") { const w = capWords(((h.spec ?? {}) as { cap?: string }).cap); return w[0]!.toUpperCase() + w.slice(1); }
  if (h.kind === "command" && h.line) { const d = describedAs({ line: h.line }); if (d !== "") return d; }
  return rawOf(h);
}
/** "Made by Assistant", or the person's name where it is known. */
export const madeBy = (h: Pick<Hook, "madeBy" | "madeByKind">, nameOf: (id: string) => string): string => (h.madeByKind === "admin" ? `${nameOf(h.madeBy)} (admin)` : nameOf(h.madeBy));
export const canRemoveNote = "Only an admin can remove this";

/** The first sentence of a hook's line, lower-cased, for "Assistant added a hook in this chat: ..." style lines. */
export const lowerFirst = (s: string): string => (s === "" ? s : s[0]!.toLowerCase() + s.slice(1));

/** What the edit form saves: the same hook with its new words. Null when a field is empty. */
export interface Draft { event: string; kind: HookKind; what: string; /** "Only for", a key of ACTION_CHOICES */ only: string }
export function draftOf(h: Hook): Draft { return { event: h.event, kind: h.kind as HookKind, what: rawOf(h), only: choiceFor(h.matcher) }; }
export { ACTION_CHOICES, ACTION_EVENTS };
export function setInput(h: Hook, d: Draft, threadId: string): Record<string, unknown> | null {
  const what = d.what.trim();
  if (what === "") return null;
  return {
    id: h.id, summary: h.line, scope: h.scope, event: d.event, kind: d.kind, matcher: !ACTION_EVENTS.has(d.event) ? "" : d.only === choiceFor(h.matcher) ? h.matcher : matcherFor(d.only), threadId, timeoutSec: h.timeoutSec, helpers: h.helpers,
    ...(d.kind === "command" ? { command: what } : d.kind === "check" ? { instruction: what } : { cap: what, input: (h.spec as { input?: unknown }).input ?? {} }),
  };
}
/** The hook as it was, to bring it back after Remove: a new hook with the same words (a removed row is gone for good). */
export function restoreInput(h: Hook, threadId: string): Record<string, unknown> {
  return { scope: h.scope, event: h.event, kind: h.kind, matcher: h.matcher, timeoutSec: h.timeoutSec, helpers: h.helpers, summary: h.line, threadId, ...(h.agentId ? { agentId: h.agentId } : {}), ...(rawOf(h) ? (h.kind === "command" ? { command: rawOf(h) } : h.kind === "check" ? { instruction: rawOf(h) } : { cap: rawOf(h), input: (h.spec as { input?: unknown }).input ?? {} }) : {}) };
}

/** When a hook runs, in the plain words its maker gave it: the part of its line before the first comma, capitalised ("Before any email"). The event words are the fallback. */
export function titleOf(h: Pick<Hook, "line" | "event">): string {
  const first = h.line.split(",")[0]!.trim();
  const t = first !== "" && first.length <= 90 ? first : EVENT_WORDS[h.event] ?? h.event;
  return t[0]!.toUpperCase() + t.slice(1);
}
/** What the newest run of a hook did, in a few words: "stopped files_tree", "let through once", "added a note". */
export type HookRun = CapMap["hooks.runs.list"]["out"]["runs"][number];
export function ranWhat(r: Pick<HookRun, "outcome" | "tool">): string {
  // the tool in plain words ("sending an email"), never its name
  const on = r.tool ? ` ${actionWords(r.tool)}` : "";
  switch (r.outcome) {
    case "blocked": return `stopped${on || " a call"}`;
    case "allowed_once": return `let through once${on ? `,${on}` : ""}`;
    case "note": return "added a note";
    case "error": return "did not finish";
    case "timeout": return "ran out of time";
    case "skipped": return "had no AI account to ask";
    default: return on ? `checked${on}` : "ran";
  }
}
/** "Last ran 2 min ago, stopped files_tree", or "Never ran". `runs` are newest first, as hooks.runs.list gives them. */
export function lastRan(hookId: string, runs: readonly HookRun[], ago: (ts: number) => string): string {
  const r = runs.find((x) => x.hookId === hookId);
  return r ? `Last ran ${ago(r.at)}, ${ranWhat(r)}` : "Never ran";
}
