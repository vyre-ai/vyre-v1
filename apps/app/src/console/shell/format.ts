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

/** Micros of a dollar to "$1,234" (whole dollars; the Console is a dense table, not a bill). */
export function money(micros: number): string {
  return "$" + Math.round(micros / 1_000_000).toLocaleString("en-US");
}

/** "files.save" as "saved a file", "role.changed" as "changed a role": the registry's act names said as a person says them (lib/words/audit.ts). With the name of the thing, "saved the file Fee agreement.pdf". */
export function actionPhrase(action: string, resource?: string): string {
  return auditPhrase(action, resource);
}

/** The act as a title: "Saved a file". */
export const capPhrase = (action: string, resource?: string): string => { const t = auditPhrase(action, resource); return t.charAt(0).toUpperCase() + t.slice(1); };

/** One line of the activity feed: who, what they did, and to what, in words. An actor the Space has no name for reads as "Someone" ("The owner" only for a claim). */
export function activityTitle(who: string, action: string, resource: string | undefined): string {
  const unnamed = /^(act|usr|agt)_/.test(who);
  const actor = unnamed ? (action === "identity.claim_owner" ? "The owner" : "Someone") : who;
  return auditSentence({ actor, action, ...(resource ? { resource } : {}) });
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
