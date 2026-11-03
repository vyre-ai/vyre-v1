// The team "Now" view (owner D24, 3 Nov): who is around and which agents are working on what, for whom and where. One model, two places: collapsed in the Chats sidebar and open on
// Console Overview. Pure: the reads are devices.presence and engine.now; names come from the directory the caller already holds. Steady marks only (nothing blinks).
export type PresenceState = "online" | "away" | "offline";
export interface PresenceRow { personId: string; state: PresenceState; lastSeenAt?: number; awayUntil?: number }
export interface WorkingRow { agentId: string; forPerson: string; where: "space" | "computer" | "server"; since: number; threadId?: string; title?: string; channelId?: string; kind?: string }

export interface NowPerson { id: string; name: string; state: "online" | "away" }
export interface NowAgent { id: string; name: string; line: string; threadId?: string }
export interface TeamNow { people: NowPerson[]; agents: NowAgent[] }

/** The presence map every person Face reads: online or away; offline people are simply absent (no mark). */
export function presenceMap(rows: readonly PresenceRow[] | undefined): ReadonlyMap<string, "online" | "away"> {
  const m = new Map<string, "online" | "away">();
  for (const r of rows ?? []) if (r.state === "online" || r.state === "away") m.set(r.personId, r.state);
  return m;
}

const WHERE: Record<WorkingRow["where"], string> = { space: "on the Space", computer: "on their computer", server: "on their server" };

/** "in #sales for Omar, on the Space". A chat the viewer may not read is "in a private chat"; a turn nobody asked for (a routine) has no "for". */
export function workingLine(w: WorkingRow, personName: (id: string) => string): string {
  const where = w.channelId && w.title ? `in #${w.title}` : w.threadId && w.title ? `in ${w.title}` : "in a private chat";
  const who = w.forPerson ? ` for ${personName(w.forPerson)}` : "";
  return `${where}${who}, ${WHERE[w.where]}`;
}

/**
 * Who is around and what agents are doing. People: online first, then away, by name; you are left out (you know where you are). Agents: one row each, the newest turn, by name.
 */
export function teamNow(o: { presence: readonly PresenceRow[] | undefined; working: readonly WorkingRow[] | undefined; me?: string | undefined; personName(id: string): string; agentName(id: string): string }): TeamNow {
  const people: NowPerson[] = [];
  for (const r of o.presence ?? []) {
    if (r.personId === o.me || (r.state !== "online" && r.state !== "away")) continue;
    people.push({ id: r.personId, name: o.personName(r.personId), state: r.state });
  }
  people.sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === "online" ? -1 : 1));
  const newest = new Map<string, WorkingRow>();
  for (const w of o.working ?? []) { const was = newest.get(w.agentId); if (!was || w.since > was.since) newest.set(w.agentId, w); }
  const agents: NowAgent[] = [...newest.values()].map((w) => ({ id: w.agentId, name: o.agentName(w.agentId), line: workingLine(w, o.personName), ...(w.threadId ? { threadId: w.threadId } : {}) }));
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { people, agents };
}

/** Same answer twice reads as the same object, so a poll that changed nothing redraws nothing. */
export function sameNow(a: TeamNow | null, b: TeamNow | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
