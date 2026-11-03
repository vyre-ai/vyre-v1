// Who can hold a task and what to call them, for every Tasks screen: the shell's directory (people and agents; someone else's private agent is already named as its person,
// "Irfad Imtiaz (Agent)", by the server) plus the Space's teams and roles, read once per Space. Never a raw id: an id with no name reads as a plain word (names.ts).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { QueryState } from "../../../../../../client/src/index.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { offered } from "../../../shell/session/private-agents.ts";
import { nameOr } from "../names.ts";

export type SeatKind = "person" | "agent" | "group" | "role";
export interface Seat { kind: SeatKind; id: string; name: string; /** A person who holds only the Guest role. */ guest?: true }
interface Team { kind: "group" | "role"; id: string; name: string }

type Call = (cap: string, input: unknown) => Promise<unknown>;
const teamsOf = new WeakMap<object, Promise<readonly Team[]>>();

/** The Space's groups and roles, read once per runtime. A person who may not list them gets none, and the menus offer people and agents only. */
export function readTeams(owner: object, call: Call): Promise<readonly Team[]> {
  let p = teamsOf.get(owner);
  if (!p) {
    const groups = call("access.groups.list", { limit: 200 }).then((o) => ((o as { groups?: Array<{ id: string; name: string }> }).groups ?? []).map((g): Team => ({ kind: "group", id: g.id, name: g.name })), () => [] as Team[]);
    const roles = call("access.roles.list", { limit: 200 }).then((o) => ((o as { roles?: Array<{ id: string; name: string }> }).roles ?? []).map((r): Team => ({ kind: "role", id: r.id, name: r.name })), () => [] as Team[]);
    p = Promise.all([groups, roles]).then(([g, r]) => [...g, ...r]);
    teamsOf.set(owner, p);
  }
  return p;
}

/** A name for any holder id, the same everywhere in Tasks. */
export function namer(meId: string, assistant: { id: string; name: string }, byId: ReadonlyMap<string, { name: string }>): (id: string) => string {
  return (id) => (id === meId ? "You" : id === assistant.id ? assistant.name : nameOr(byId.get(id)?.name, id));
}

/** The seats a task can be given to, in menu order: you, people, agents, teams, roles. Someone else's private agent is never offered. */
export function seatsFrom(list: ReadonlyArray<{ id: string; name: string; kind: string; guest?: boolean }>, teams: readonly Team[], meId: string): Seat[] {
  const out: Seat[] = [];
  const people = list.filter((p) => p.kind === "person" && offered(p));
  const agents = list.filter((p) => p.kind === "agent" && offered(p));
  for (const p of people) if (p.id === meId) out.push({ kind: "person", id: p.id, name: "You" });
  for (const p of people) if (p.id !== meId) out.push(p.guest === true ? { kind: "person", id: p.id, name: p.name, guest: true } : { kind: "person", id: p.id, name: p.name });
  for (const a of agents) out.push({ kind: "agent", id: a.id, name: a.name });
  for (const t of teams) out.push({ kind: t.kind, id: t.id, name: t.name });
  return out;
}

export interface TaskPeople { nameOf(id: string): string; seats: readonly Seat[]; list: ReadonlyArray<{ id: string; name: string; kind: string; guest?: boolean }> }

export function useTaskPeople(rt: ShellRuntime): TaskPeople {
  const people = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot) as QueryState<Array<{ id: string; name: string; kind: string; guest?: boolean }>>;
  const list = useMemo(() => (people.status === "ready" ? people.data : []), [people]);
  const [teams, setTeams] = useState<readonly Team[]>([]);
  useEffect(() => { let live = true; void readTeams(rt, rt.call as Call).then((t) => { if (live) setTeams(t); }); return () => { live = false; }; }, [rt]);
  const byId = useMemo(() => { const m = new Map<string, { name: string }>(list.map((p) => [p.id, p] as const)); for (const t of teams) m.set(t.id, t); return m; }, [list, teams]);
  const nameOf = useMemo(() => namer(rt.me.id, rt.assistant, byId), [rt.me.id, rt.assistant, byId]);
  const seats = useMemo(() => seatsFrom(list, teams, rt.me.id), [list, teams, rt.me.id]);
  return { nameOf, seats, list };
}
