// The pure half of the composer's agent controls (rc.8 composer): who answers and on what, the mode a chat runs in, effort, the context ring, the send control and the inline
// tokens the field draws. No React here, so the rules are tested on their own and the screen and the tests can never disagree.

import type { ComposerRef } from "./props.ts";

/* ---------- mode ---------- */

export type ChatMode = "ask" | "auto" | "plan";

export interface ModeInfo { id: ChatMode; label: string; note: string }

export const MODES: readonly ModeInfo[] = [
  { id: "auto", label: "Auto", note: "Acts on its own; still asks before anything leaves Vyre" },
  { id: "ask", label: "Ask first", note: "Asks before it changes or sends anything" },
  { id: "plan", label: "Plan", note: "Writes a plan first; nothing runs until you approve" },
];

export const modeInfo = (m: ChatMode): ModeInfo => MODES.find((x) => x.id === m) ?? (MODES[0] as ModeInfo);

/** Shift+Tab: Auto, Ask first, Plan, and round again. */
export function nextMode(m: ChatMode): ChatMode {
  const i = MODES.findIndex((x) => x.id === m);
  return (MODES[(i + 1) % MODES.length] as ModeInfo).id;
}

/* ---------- effort ---------- */

export type Effort = "low" | "medium" | "high" | "max";

export const EFFORTS: readonly { id: Effort; label: string; note: string }[] = [
  { id: "low", label: "Low", note: "fastest" },
  { id: "medium", label: "Medium", note: "balanced" },
  { id: "high", label: "High", note: "thorough" },
  { id: "max", label: "Max", note: "deepest" },
];

/** The effort levels a provider offers, in the words it uses. The engine's values stay the same four. */
export function effortsFor(provider: string | undefined): readonly { id: Effort; label: string; note: string }[] {
  const p = (provider ?? "").toLowerCase();
  if (p === "openai" || p === "codex" || p === "chatgpt") return EFFORTS.slice(0, 3);
  if (p === "grok" || p === "xai") return [{ id: "medium", label: "Normal", note: "balanced" }, { id: "high", label: "Deep", note: "thorough" }];
  return EFFORTS;
}

/** What a provider calls its limits. A meter the engine has no number for is never drawn. */
export function limitWords(provider: string | undefined): { session: string; week: string } {
  const p = (provider ?? "").toLowerCase();
  if (p === "openai" || p === "codex" || p === "chatgpt") return { session: "5 hours", week: "Week" };
  if (p === "grok" || p === "xai") return { session: "Today", week: "Week" };
  return { session: "Session", week: "Week" };
}

/** Bars lit for an effort: 1 to 4. Unknown is the engine's default, Medium. */
export function effortBars(e: Effort | undefined): number {
  const i = EFFORTS.findIndex((x) => x.id === e);
  return i < 0 ? 2 : i + 1;
}

/** Keys 1 to 4 in the model menu, as far as the provider's levels go. */
export function effortForKey(key: string, levels: readonly { id: Effort }[] = EFFORTS): Effort | null {
  return /^[1-4]$/.test(key) ? levels[Number(key) - 1]?.id ?? null : null;
}

/* ---------- who answers ---------- */

/** An agent that may answer in this place, with what it runs on. Only what the place knows is set; the strip leaves out the rest. */
export interface ComposerAgent {
  id: string;
  name: string;
  /** The assistant draws the Vyre mark (ui/Avatar avatarOf). */
  kind?: "agent" | "assistant";
  /** Provider or driver id (anthropic, claude_code, openai, codex, grok): picks the logo. */
  provider?: string;
  /** What the strip says for the model ("Sonnet 5.5", "Auto"). */
  modelTitle?: string;
  /** The paying account's name, shown only when two accounts of one provider are connected. */
  accountName?: string;
  effort?: Effort;
  /** How full this chat's context is for the agent, when the engine said. */
  context?: { used: number; window: number } | null;
}

const first = (s: string): string => (s.trim().split(/\s+/)[0] ?? s).toLowerCase();

/** The agents the who-will-answer rule picked, in order, matched to what the place knows about them by name (the rule works on names, as the @ text does). */
export function answering(responders: readonly string[], agents: readonly ComposerAgent[] | undefined): ComposerAgent[] {
  const out: ComposerAgent[] = [];
  for (const r of responders) {
    const known = (agents ?? []).find((a) => a.name === r) ?? (agents ?? []).find((a) => first(a.name) === first(r));
    const agent = known ?? { id: r, name: r };
    if (!out.some((x) => x.id === agent.id)) out.push(agent);
  }
  return out;
}

/** The names on the strip: one name, or first names joined when several answer. */
export function stripName(list: readonly ComposerAgent[]): string {
  if (list.length <= 1) return list[0]?.name ?? "";
  return list.map((a) => a.name.split(/[\s’']/)[0] ?? a.name).join(", ");
}

/* ---------- the context ring ---------- */

/** The ring in the model pill: quiet until the context is past 60 percent, amber past 80. Null hides it (and a context the engine never reported). */
export function contextRing(ctx: { used: number; window: number } | null | undefined): { pct: number; warn: boolean } | null {
  if (!ctx || !(ctx.window > 0) || !(ctx.used >= 0)) return null;
  const pct = Math.min(1, ctx.used / ctx.window);
  if (pct <= 0.6) return null;
  return { pct, warn: pct > 0.8 };
}

/* ---------- the send control ---------- */

export type SendControl = "send" | "stop" | "split";

/** Send when idle; Stop while it works and nothing is typed; Queue and Now side by side while it works and something is typed. */
export function sendControl(working: boolean, hasContent: boolean): SendControl {
  if (!working) return "send";
  return hasContent ? "split" : "stop";
}

/* ---------- inline tokens ---------- */

export interface TokenRange { start: number; end: number; kind: "link" | "mention" | "wiki" }

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the field draws tokens: picked # links that the text still holds, @First for known names, and [[links]]. Sorted, never overlapping. */
export function tokenRanges(text: string, refs: readonly ComposerRef[] | undefined, names: readonly string[]): TokenRange[] {
  const found: TokenRange[] = [];
  for (const r of refs ?? []) {
    if (r.token !== "#") continue;
    const needle = `#${r.title}`;
    let at = text.indexOf(needle);
    while (at >= 0) { found.push({ start: at, end: at + needle.length, kind: "link" }); at = text.indexOf(needle, at + needle.length); }
  }
  for (const m of text.matchAll(/\[\[[^\]\n]+\]\]/g)) found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: "wiki" });
  const firsts = [...new Set(names.map((n) => n.trim().split(/\s+/)[0] ?? "").filter((n) => n.length > 0))];
  if (firsts.length > 0) {
    const re = new RegExp(`(^|[^\\w])(@(?:${firsts.map(escape).join("|")}))(?![\\p{L}\\p{N}_])`, "giu");
    for (const m of text.matchAll(re)) {
      const start = (m.index ?? 0) + (m[1] ?? "").length;
      found.push({ start, end: start + (m[2] ?? "").length, kind: "mention" });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TokenRange[] = [];
  for (const t of found) if (!out.some((o) => t.start < o.end && t.end > o.start)) out.push(t);
  return out;
}

/** Backspace right after a token takes the whole token (a token is one thing, as in the prototype). Null when the cursor is not at a token's end. */
export function deleteToken(text: string, cursor: number, ranges: readonly TokenRange[]): { text: string; cursor: number } | null {
  const hit = ranges.find((r) => r.end === cursor || (r.end + 1 === cursor && text.charAt(r.end) === " "));
  if (!hit) return null;
  return { text: text.slice(0, hit.start) + text.slice(cursor), cursor: hit.start };
}

/* ---------- sizes ---------- */

/** "2.4 MB", "18 KB", "1 KB". */
export function sizeLabel(bytes: number | undefined): string {
  if (bytes === undefined || !(bytes >= 0)) return "";
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** "84k / 200k" for the context meter. */
export function kTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  return `${Math.round(n / 1e3)}k`;
}
