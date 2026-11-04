// The words of a person's profile pane, with no renderer: their working hours, the time where they are, the presence line. Everything here is stated only from what the person set themselves.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Mon to Fri, 9:00 to 17:30": the days as a range when they run on, else listed. Times keep the person's own 24-hour clock. */
export function hoursWords(h: { days: readonly number[]; from: string; to: string }): string {
  const days = [...new Set(h.days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) return "";
  const run = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  const when = days.length === 7 ? "Every day" : days.length === 1 ? DAYS[days[0]!]! : run ? `${DAYS[days[0]!]} to ${DAYS[days[days.length - 1]!]}` : days.map((d) => DAYS[d]).join(", ");
  const t = (s: string): string => { const [hh, mm] = s.split(":"); return `${Number(hh)}:${mm ?? "00"}`; };
  return `${when}, ${t(h.from)} to ${t(h.to)}`;
}

/** The time in their zone, "22:41", or undefined when the zone is not one Vyre knows. */
export function localTime(nowMs: number, timezone: string | undefined): string | undefined {
  if (timezone === undefined || timezone === "") return undefined;
  try { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(nowMs)); } catch { return undefined; }
}

/** "Berlin" from "Europe/Berlin". */
export const cityOf = (timezone: string): string => (timezone.split("/").pop() ?? timezone).replaceAll("_", " ");

export type PresenceState = "online" | "away" | "offline";
export const presenceWord = (s: PresenceState | undefined): string => (s === "online" ? "Online" : s === "away" ? "Away" : s === "offline" ? "Offline" : "");

/** "Account lead · Away, 22:41 for Sara": the title, how they are, and their time. A part with nothing to say is left out. */
export function personLine(title: string | undefined, state: PresenceState | undefined, time: string | undefined, first: string): string {
  const how = [presenceWord(state), time === undefined ? "" : `${time} for ${first}`].filter((x) => x !== "");
  return [title ?? "Member", how.join(", ")].filter((x) => x !== "").join(" · ");
}

/** "Last active 5 min ago" from a last-seen time. */
export function lastActive(nowMs: number, lastSeenAt: number | undefined): string | undefined {
  if (lastSeenAt === undefined) return undefined;
  const m = Math.max(0, Math.floor((nowMs - lastSeenAt) / 60_000));
  if (m < 1) return "Last active a moment ago";
  if (m < 60) return `Last active ${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `Last active ${h} ${h === 1 ? "hour" : "hours"} ago` : `Last active ${Math.round(h / 24)} days ago`;
}

/** "Account lead. Lead on Client portal launch, Reviewer on Northwind renewal.": the title, then the roles they hold on projects the asker can see. */
export function responsibleFor(title: string | undefined, roles: readonly { project: string; role: string }[]): string {
  const t = title ?? "Member";
  return roles.length === 0 ? `${t}.` : `${t}. ${roles.map((r) => `${r.role} on ${r.project}`).join(", ")}.`;
}

/** The lines of someone's public profile a teammate may read (memory.profile.get with personId): current public facts only. The private part never reaches this pane, whatever the answer holds. */
export function publicLines(out: { public: readonly { text: string; status: string; place: string }[] } | null | undefined): string[] {
  return (out?.public ?? []).filter((f) => f.place === "public" && f.status === "current" && f.text.trim() !== "").map((f) => f.text.trim());
}

/** What chat.pace_of says about their usual reply time, in words. */
export function paceWords(p: "minutes" | "hour" | "day" | "slow" | "unknown"): string {
  return p === "minutes" ? "Usually within minutes" : p === "hour" ? "Usually within the hour" : p === "day" ? "Usually the same day" : p === "slow" ? "Usually after a day" : "Not enough to tell";
}

/** How they hear about this chat: the level tells others whether to @ them. */
export function notifyWords(n: "all" | "mentions" | "off" | undefined): string | undefined {
  return n === "all" ? "All messages" : n === "mentions" ? "Mentions only" : n === "off" ? "Off" : undefined;
}
