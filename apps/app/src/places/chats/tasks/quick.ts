// Quick add: plain words become a task. "Call Omar friday @sara #portal !high": the title is what is left, the day, the person, the labels and the priority are read out of it.
import { DAY } from "./model.ts";

export interface QuickPerson { id: string; name: string; kind: string; username?: string }
export interface Quick { title: string; due?: number; assignee?: QuickPerson; labels: string[]; priority?: "urgent" | "high" | "normal" | "low" }

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PRI: Record<string, Quick["priority"]> = { urgent: "urgent", high: "high", normal: "normal", low: "low", p1: "urgent", p2: "high", p3: "normal", p4: "low" };

/** The end of a local day, as a time. */
const endOf = (localDay: number, offsetMin: number): number => localDay + DAY - 60_000 - offsetMin * 60_000;

/** A day in the words at `i` in `words`: how many words it took, and the time. */
export function dayIn(words: readonly string[], i: number, now: number, offsetMin: number): { take: number; at: number } | null {
  const today = Math.floor((now + offsetMin * 60_000) / DAY) * DAY;
  const w = words[i]!.toLowerCase().replace(/[.,]$/, "");
  const next = words[i + 1]?.toLowerCase().replace(/[.,]$/, "");
  if (w === "today") return { take: 1, at: endOf(today, offsetMin) };
  if (w === "tomorrow" || w === "tmrw") return { take: 1, at: endOf(today + DAY, offsetMin) };
  const dow = (v: string | undefined): number => { if (v === undefined) return -1; const a = DAYS.indexOf(v); return a >= 0 ? a : SHORT.indexOf(v); };
  const weekday = dow(w);
  const nowDow = new Date(today).getUTCDay();
  if (weekday >= 0) return { take: 1, at: endOf(today + ((weekday - nowDow + 7) % 7 || 7) * DAY, offsetMin) };
  if (w === "next" && dow(next) >= 0) return { take: 2, at: endOf(today + (((dow(next) - nowDow + 7) % 7 || 7) + 7) * DAY, offsetMin) };
  if (w === "next" && next === "week") return { take: 2, at: endOf(today + ((1 - nowDow + 7) % 7 || 7) * DAY, offsetMin) };
  if (w === "in" && next !== undefined && /^\d+$/.test(next)) {
    const unit = words[i + 2]?.toLowerCase().replace(/[.,]$/, "");
    if (unit === "day" || unit === "days") return { take: 3, at: endOf(today + Number(next) * DAY, offsetMin) };
    if (unit === "week" || unit === "weeks") return { take: 3, at: endOf(today + Number(next) * 7 * DAY, offsetMin) };
  }
  const month = MONTHS.indexOf(w.slice(0, 3));
  if (month >= 0 && next !== undefined && /^\d{1,2}(st|nd|rd|th)?$/.test(next) && /^[a-z]+$/.test(w)) {
    const year = new Date(today).getUTCFullYear();
    let at = Date.UTC(year, month, parseInt(next, 10));
    if (at < today) at = Date.UTC(year + 1, month, parseInt(next, 10));
    return { take: 2, at: endOf(at, offsetMin) };
  }
  return null;
}

export function parseQuick(text: string, people: readonly QuickPerson[], now: number, offsetMin: number): Quick {
  const words = text.trim().split(/\s+/).filter((w) => w !== "");
  const out: Quick = { title: "", labels: [] };
  const keep: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.startsWith("#") && w.length > 1 && !/^#[A-Za-z]+-\d+$/.test(w)) { out.labels.push(w.slice(1).toLowerCase()); continue; }
    if (w.startsWith("@") && w.length > 1) {
      const q = w.slice(1).toLowerCase();
      const who = people.find((p) => p.username?.toLowerCase() === q) ?? people.find((p) => p.name.toLowerCase().split(" ")[0] === q) ?? people.find((p) => p.name.toLowerCase().startsWith(q));
      if (who) { out.assignee = who; continue; }
    }
    if (w.startsWith("!") && PRI[w.slice(1).toLowerCase()]) { out.priority = PRI[w.slice(1).toLowerCase()]!; continue; }
    if (out.due === undefined) {
      const d = dayIn(words, i, now, offsetMin);
      if (d) { out.due = d.at; i += d.take - 1; continue; }
    }
    keep.push(w);
  }
  out.title = keep.join(" ");
  return out;
}
