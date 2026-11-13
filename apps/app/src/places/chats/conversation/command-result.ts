// What a slash command hands back: data, never a sentence the screen has to take apart. The runner (commands.ts) returns one CommandResult per command; the screen decides where it is drawn
// (CMD-RESULTS-2026-11-13.md, Part 2): a notice goes to the title bar's slot, a card sits above the composer, a menu is a menu the composer already has, and the rest open their own place.
import { CHAT_COMMANDS } from "../../../../../../lib/chat-commands.ts";
import type { ChatCommandId } from "../../../../../../lib/chat-commands.ts";
import type { MyAi } from "../../../../../../lib/usage-text.ts";
import { currentZones, whenText } from "../../../../../../lib/zones.ts";
import { prettyModel } from "./brain.tsx";

/** The four things a built-in command can end in. "message" is a plugin's prompt: it is sent as the person's own message and is not a result. */
export type CommandKind = "notice" | "card" | "menu" | "opens";

/**
 * Every built-in command and what it ends in. A command not listed here fails the type check (the Record is keyed by the id type) and the test in command-results.test.ts.
 *   notice  one quiet line in the title bar's slot, with Undo where the act can be undone and Retry when it failed
 *   card    an answer laid out as sections, anchored to the composer, never stored
 *   menu    opens a menu the composer already owns
 *   opens   the thing it opened (a chat, a task, the find bar, the stopped reply) is the confirmation; no line
 */
export const COMMAND_KINDS: Readonly<Record<ChatCommandId, CommandKind>> = Object.freeze({
  plan: "notice",
  pin: "notice",
  export: "notice",
  continue: "notice",
  remember: "notice",
  compact: "notice",
  usage: "card",
  permissions: "card",
  btw: "card",
  model: "menu",
  helper: "opens",
  handoff: "opens",
  fork: "opens",
  task: "opens",
  find: "opens",
  search: "opens",
  stop: "opens",
});

/** Ids in the one list that the table above does not know (empty when the two agree). */
export const unclassified = (): string[] => CHAT_COMMANDS.map((c) => c.id).filter((id) => !(id in COMMAND_KINDS));

/* ---------- kind (a): a notice ---------- */

export interface NoticeResult {
  kind: "notice";
  text: string;
  /** Take the act back. Present only where it can really be undone. */
  undo?: () => Promise<void> | void;
  /** The act failed: the text says why in plain words and Retry runs it again. */
  failed?: { retry: () => Promise<void> | void };
}

/* ---------- kind (b): a card ---------- */

/** A meter the provider reported: how much is used, and when the window starts over (a time, drawn through ui/Time). */
export interface Meter {
  pct: number;
  resetsAt?: number;
}
/** What an account can say about what is left. `read`: the two windows. `waiting`: a sign-in reports them only with a turn and none has come yet. `silent`: this provider never reports. */
export type AccountLimits =
  | { state: "read"; session?: Meter; week?: Meter }
  | { state: "waiting" }
  | { state: "silent" };

export interface UsageAccount {
  /** The name a person gave it, or "<Provider> sign-in" when the given name is an address or initials. */
  name: string;
  usable: boolean;
  /** Short and plain: why it cannot run here. */
  why?: string;
  /** Model names as people read them. */
  models: string[];
  /** The model this chat runs on, in `models`, drawn in strong text. */
  current?: string;
  limits: AccountLimits;
}

export interface UseFigures {
  turns: number;
  fresh: number;
  cached: number;
  out: number;
  /** Zero for a sign-in: the card shows no cost then. */
  costMicros: number;
}

export interface UsageCard {
  kind: "usage";
  chat: {
    model: string | null;
    /** "Your Claude sign-in", "The Space's key", "Your own key"; null when the server did not say. */
    paidBy: string | null;
    context: { used: number; window: number } | null;
  };
  accounts: UsageAccount[];
  today: UseFigures;
  month: UseFigures;
}

export interface PermissionRow {
  /** The rule's own id, for the call that takes it back. Never drawn. */
  id: string;
  /** What it allows, in words. */
  text: string;
  /** When it stops, as a time (drawn through ui/Time). */
  until?: number;
  /** The rule can be given back after a take-back (a person's Always allow); an automation's permission cannot. */
  restorable: boolean;
}
export interface PermissionsCard {
  kind: "permissions";
  rules: PermissionRow[];
}

/** /btw: the question, answered in a card of its own (the aside list draws it until the card takes it over). */
export interface AsideCard {
  kind: "aside";
  question: string;
}

export type CommandCard = UsageCard | PermissionsCard | AsideCard;

export interface CardResult {
  kind: "card";
  card: CommandCard;
}
export interface MenuResult {
  kind: "menu";
  menu: "model";
}
export interface OpensResult {
  kind: "opens";
}
export type CommandResult = NoticeResult | CardResult | MenuResult | OpensResult;

export const notice = (text: string, more: { undo?: NoticeResult["undo"] } = {}): NoticeResult => ({
  kind: "notice",
  text,
  ...(more.undo ? { undo: more.undo } : {}),
});
export const opens = (): OpensResult => ({ kind: "opens" });

/* ---------- from engine.my_ai to the usage card ---------- */

const PROVIDER_WORDS: Readonly<Record<string, string>> = {
  anthropic: "Claude",
  claude: "Claude",
  openai: "ChatGPT",
  codex: "ChatGPT",
  google: "Gemini",
  xai: "Grok",
  openrouter: "OpenRouter",
  opencode_go: "OpenCode Go",
};
const providerWord = (p: string): string =>
  PROVIDER_WORDS[p] ?? (p === "" ? "AI" : p.charAt(0).toUpperCase() + p.slice(1));

/** An account is shown under the name the person gave it. An address or bare initials ("CC, CF") is not a name: it reads "<Provider> sign-in" (or key). */
export function accountName(a: { name: string; provider: string; kind?: string }): string {
  const given = a.name.trim();
  const initials = (x: string): boolean => /^[A-Z]{1,3}$/.test(x);
  const parts = given.split(/,\s*/);
  // "CC, CF" and "Claude Code, CF" are initials after a product name; "dana@example.org" is an address
  const unnamed =
    given === "" ||
    given.includes("@") ||
    parts.every(initials) ||
    (parts.length > 1 && parts.slice(1).every(initials));
  if (!unnamed) return given;
  return `${providerWord(a.provider)} ${a.kind === "subscription" ? "sign-in" : "key"}`;
}

/** Who paid for the chat's last turn, in the words a person says. The server's own string is never shown as it came. */
export function paidWords(paid: string | undefined, provider: string | undefined): string | null {
  if (!paid) return null;
  if (/sign-?in/i.test(paid)) return `Your ${providerWord(provider ?? "")} sign-in`;
  if (/space/i.test(paid)) return "The Space's key";
  if (/key/i.test(paid)) return "Your own key";
  return null;
}

/** What an account row says when it has no meters: the true reason in a few words. */
export const WAITING_WORDS = "Shows after your next message";
export const SILENT_WORDS = "Doesn't report its limits";

const figures = (u: MyAi["use"]["today"]): UseFigures => ({
  turns: u.turns,
  fresh: u.input,
  cached: u.cachedInput,
  out: u.output,
  costMicros: u.costMicros,
});

/** The short reason an account cannot run, never a code. The server's sentence is kept when it is short; a long one gives way to the plain default. */
const whyWords = (why: string | undefined): string => (why !== undefined && why.length <= 60 ? why : "Not usable here");

export function usageCard(o: MyAi, titles?: ReadonlyMap<string, string>): UsageCard {
  const run = o.running;
  const model = run?.model ? prettyModel(run.model, titles) : null;
  const runningProvider = o.accounts.find((a) => a.name === run?.account?.name)?.provider;
  const accounts: UsageAccount[] = o.accounts.map((a) => {
    const l = a.limits;
    const limits: AccountLimits =
      l.state === "read"
        ? {
            state: "read",
            ...(l.session ? { session: { pct: Math.round(l.session.pct), ...resets(l.session) } } : {}),
            ...(l.week ? { week: { pct: Math.round(l.week.pct), ...resets(l.week) } } : {}),
          }
        : a.kind === "subscription"
          ? { state: "waiting" }
          : { state: "silent" };
    const isRunning = run?.account?.name !== undefined && run.account.name === a.name;
    return {
      name: accountName(a),
      usable: a.usable,
      ...(a.usable ? {} : { why: whyWords(a.why) }),
      models: a.usable ? a.models.map((m) => prettyModel(m, titles)) : [],
      ...(isRunning && model ? { current: model } : {}),
      limits,
    };
  });
  return {
    kind: "usage",
    chat: {
      model,
      paidBy: paidWords(run?.paid, runningProvider),
      context: run?.context ?? null,
    },
    accounts,
    today: figures(o.use.today),
    month: figures(o.use.month),
  };
}
const resets = (m: { resetsAt?: number }): { resetsAt?: number } =>
  m.resetsAt !== undefined ? { resetsAt: m.resetsAt } : {};

/* ---------- small, shared words ---------- */

/** 18k, 1.5M: the one tidy unit rule for figures on a card. */
export const compactCount = (n: number): string =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e4
      ? `${Math.round(n / 1e3)}k`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)}k`
        : String(n);

/** The card as plain lines (a screen reader's label, the copy text, and what stands in until a card is drawn). Times go through the app's own formatter. */
export function cardLines(card: CommandCard, now: number): string[] {
  const when = (at: number): string => whenText(at, now, currentZones());
  if (card.kind === "aside") return [card.question];
  if (card.kind === "permissions")
    return card.rules.length === 0
      ? ["Nothing goes without asking here beyond what your chat mode allows."]
      : card.rules.map((r, i) => `${i + 1}. ${r.text}${r.until !== undefined ? `, until ${when(r.until)}` : ""}`);
  const out: string[] = [];
  const c = card.chat;
  out.push(
    `This chat: ${c.model ?? "the engine's own default model"}${c.paidBy ? `, ${c.paidBy.toLowerCase()}` : ""}${c.context ? `, context ${compactCount(c.context.used)} of ${compactCount(c.context.window)}` : ""}`,
  );
  for (const a of card.accounts) {
    const l = a.limits;
    const left = !a.usable
      ? `Can't run here: ${a.why ?? "not usable"}`
      : l.state === "read"
        ? [
            l.session
              ? `session ${l.session.pct}% used${l.session.resetsAt !== undefined ? `, resets ${when(l.session.resetsAt)}` : ""}`
              : "",
            l.week
              ? `week ${l.week.pct}% used${l.week.resetsAt !== undefined ? `, resets ${when(l.week.resetsAt)}` : ""}`
              : "",
          ]
            .filter(Boolean)
            .join(", ")
        : l.state === "waiting"
          ? WAITING_WORDS
          : SILENT_WORDS;
    out.push(`${a.name}: ${left}`);
  }
  const use = (label: string, u: UseFigures): string =>
    `${label}: ${u.turns} ${u.turns === 1 ? "turn" : "turns"}, ${compactCount(u.fresh)} new, ${compactCount(u.cached)} cached, ${compactCount(u.out)} out${u.costMicros > 0 ? `, $${(u.costMicros / 1e6).toFixed(2)}` : ""}`;
  out.push(use("Today", card.today), use("This month", card.month));
  return out;
}
