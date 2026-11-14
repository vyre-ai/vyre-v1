import { auditPhrase, auditSentence } from "../../../../../lib/words/audit.ts";
// Small text helpers the Console pages share. Numbers are tabular wherever they show; times are relative to the shell's clock so a screen test is stable.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function ago(now: number, at: number): string {
  const d = Math.max(0, now - at);
  if (d < MIN) return "now";
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 14 * DAY) return `${Math.floor(d / DAY)} d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** How long something has been so, after its sentence: "" when it just started (never "since now"), " for 5 min", " for 3 h", " for 2 d", else " since 1 Oct 2026", the way dates read elsewhere in the app (owner walk, 12 Nov; review O6). */
export function forHowLong(now: number, at: number): string {
  const d = Math.max(0, now - at);
  if (d < MIN) return "";
  if (d < HOUR) return ` for ${Math.floor(d / MIN)} min`;
  if (d < DAY) return ` for ${Math.floor(d / HOUR)} h`;
  if (d < 14 * DAY) return ` for ${Math.floor(d / DAY)} d`;
  const day = new Date(at);
  return ` since ${day.getUTCDate()} ${SHORT_MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

/** Micros of a dollar to "$1,234" (whole dollars; the Console is a dense table, not a bill). */
export function money(micros: number): string {
  return "$" + Math.round(micros / 1_000_000).toLocaleString("en-US");
}

/** "files.save" as "saved a file", "role.changed" as "changed a role": the registry's act names said as a person says them (lib/words/audit.ts). With the name of the thing, "saved the file Fee agreement.pdf". */
export function actionPhrase(action: string, resource?: string): string {
  return auditPhrase(action, resource);
}

/** The act as a title: "Saved a file". */
export const capPhrase = (action: string, resource?: string): string => {
  const t = auditPhrase(action, resource);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** One line of the activity feed: who, what they did, and to what, in words. An actor the Space has no name for reads as "Someone" ("The owner" only for a claim). */
export function activityTitle(who: string, action: string, resource: string | undefined): string {
  const unnamed = /^(act|usr|agt)_/.test(who);
  const actor = unnamed ? (action === "identity.claim_owner" ? "The owner" : "Someone") : who;
  return auditSentence({ actor, action, ...(resource ? { resource } : {}) });
}

const PLURAL_BREAK = /\b(?:to|of|in|for|on|from|with|by|at|into|about)\b/;
const plural = (w: string): string =>
  /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : /(?:s|x|z|ch|sh)$/i.test(w) ? `${w}es` : `${w}s`;

/** One line said n times in a row: "Dex posted a chat" four times is "Dex posted 4 chats"; a line that does not end in "a <thing>" keeps its words and says how many times ("Tom updated the record Acme, 3 times"). */
export function repeatedTitle(title: string, n: number): string {
  if (n <= 1) return title;
  const m = /^(.+?) (?:a|an) ([A-Za-z]+(?: [A-Za-z]+)?)$/.exec(title);
  if (m && !PLURAL_BREAK.test(m[2]!)) {
    const w = m[2]!.split(" ");
    w[w.length - 1] = plural(w[w.length - 1]!);
    return `${m[1]} ${n} ${w.join(" ")}`;
  }
  return `${title}, ${n} times`;
}

export interface ActivityRow {
  title: string;
  actor: string;
  at: number;
  count: number;
}

/**
 * The admin activity list, one row per run of the same act by the same person in a row (owner, 13 Nov 2026: "Dex posted a chat" four times). The row is dated by the newest of the run, which the feed lists first.
 */
export function activityRows(
  events: readonly { at: number; actor: string; action: string; resource?: string | undefined }[],
  name: (id: string) => string,
): ActivityRow[] {
  const out: ActivityRow[] = [];
  const last: { key: string; base: string }[] = [];
  for (const e of events) {
    const base = activityTitle(name(e.actor), e.action, namedResource(e.resource, name));
    const key = `${e.actor}|${base}`;
    const at = out.length - 1;
    if (at >= 0 && last[at]!.key === key) {
      out[at]!.count += 1;
      out[at]!.title = repeatedTitle(base, out[at]!.count);
      continue;
    }
    out.push({ title: base, actor: e.actor, at: e.at, count: 1 });
    last.push({ key, base });
  }
  return out;
}

/** The name of what an act was on, or nothing: an id the Space has no name for (the Space itself, a row since deleted) is left out, never read as "Someone". */
export function namedResource(id: string | undefined, name: (id: string) => string): string | undefined {
  if (!id) return undefined;
  const n = name(id);
  return n === "" || n === "Someone" || n === id ? undefined : n;
}

/** "1 holder", "2 holders": the count with its noun in the right number. */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** A section label as a person reads it: "space" is "Space". */
export const capital = (text: string): string => `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
/** A day as a person reads it in a title: "29 Oct" (the year only when it is not this one). */
export function dayLabel(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const same = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(same ? {} : { year: "numeric" }) });
}
