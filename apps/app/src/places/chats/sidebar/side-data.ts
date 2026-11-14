// The sidebar's one read (chats.sidebar) as rows the layout draws. Pure: the server's rows and sections in, `Item`s and the caller's pin order out. People and agents come as ids; their words come from the rows the same answer
// carries (Team), so no name is looked up anywhere else and no raw id is drawn.
import type { Item, ItemKind, Shape } from "../../../../../../lib/sidebar.ts";

export interface SideRow {
  key: string;
  kind: "chat" | "channel" | "project" | "goal" | "person" | "agent";
  title: string;
  faceIds: string[];
  unread: number;
  mentions: number;
  failed: boolean;
  failedLine?: string;
  working: boolean;
  muted: boolean;
  pinned: number | null;
  lastAt: number;
  threadId?: string;
  personId?: string;
  agentId?: string;
  progress?: { done: number; total: number };
  line?: string;
  nextCheckinAt?: number;
  quiet?: boolean;
  ended?: boolean;
  archived?: boolean;
  private?: boolean;
  withPeople?: boolean;
}
export interface SideSection {
  total: number;
  rows: SideRow[];
  next?: string;
}
export interface SideOut {
  needs: {
    total: number;
    items: {
      taskId: string;
      title: string;
      verb: "Allow" | "Review" | "Answer" | "Blocked" | "Sign";
      askerId?: string;
    }[];
  };
  goals: SideSection;
  pinned: SideSection;
  chats: SideSection;
  channels: SideSection;
  team: SideSection;
  rail: number;
  nextUnread?: string;
}
export interface Presence {
  people: ReadonlyMap<string, "online" | "away">;
  working: ReadonlySet<string>;
}
export const NO_PRESENCE: Presence = { people: new Map(), working: new Set() };

export const SECTIONS = ["goals", "pinned", "chats", "channels", "team"] as const;

/** The rows of every section, once each, in answer order. */
export function allRows(out: SideOut): SideRow[] {
  const seen = new Set<string>();
  return SECTIONS.flatMap((s) => out[s].rows).filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

/** Who is who, by id, from the answer's own Team rows. */
export function namesOf(out: SideOut): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of allRows(out)) {
    if (r.personId) m.set(r.personId, r.title);
    if (r.agentId) m.set(r.agentId, r.title);
  }
  return m;
}

const KIND: Record<SideRow["kind"], ItemKind> = {
  chat: "chat",
  channel: "channel",
  project: "project",
  goal: "goal",
  person: "person",
  agent: "agent",
};

/** "Next check-in Wed 9:00" for a moving goal: the weekday and time on this device. */
export function checkinLine(at: number): string {
  const d = new Date(at);
  return `Next check-in ${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function itemsOf(
  out: SideOut,
  assistantId: string,
  presence: Presence = NO_PRESENCE,
): { items: Item[]; refs: Map<string, SideRow> } {
  const names = namesOf(out);
  const refs = new Map<string, SideRow>();
  const items: Item[] = allRows(out).map((r) => {
    refs.set(r.key, r);
    const single = r.faceIds.length === 1;
    const shape: Shape =
      r.kind === "person"
        ? "person"
        : r.kind === "channel"
          ? "channel"
          : r.kind === "project"
            ? "project"
            : r.kind === "goal"
              ? "goal"
              : r.kind === "chat"
                ? r.faceIds.length > 1
                  ? "group"
                  : r.faceIds[0] === assistantId
                    ? "assistant"
                    : "agent"
                : r.agentId === assistantId
                  ? "assistant"
                  : "agent";
    const faces = r.faceIds.map((id) => ({ id, name: names.get(id) ?? (single && r.kind !== "goal" ? r.title : "") }));
    const pres = r.personId ? presence.people.get(r.personId) : undefined;
    return {
      key: r.key,
      kind: KIND[r.kind],
      shape,
      title: r.title,
      faces,
      unread: r.unread,
      mentions: r.mentions,
      muted: r.muted,
      draft: false,
      working: r.working || (r.agentId !== undefined && presence.working.has(r.agentId)),
      archived: r.archived === true,
      ask: false,
      ended: r.ended === true,
      lastAt: r.lastAt,
      ...(r.failed ? { failed: r.failedLine ?? "Something went wrong." } : {}),
      ...(r.progress ? { progress: r.progress } : {}),
      ...(r.kind === "goal" && (r.line ?? (r.nextCheckinAt ? checkinLine(r.nextCheckinAt) : undefined))
        ? { sub: r.line ?? checkinLine(r.nextCheckinAt!) }
        : {}),
      ...(r.quiet ? { quiet: true } : {}),
      ...(pres ? { presence: pres } : {}),
      ...(r.private ? { private: true } : {}),
      ...(r.withPeople ? { withPeople: true } : {}),
      ...(r.agentId !== undefined && r.agentId === assistantId ? { assistant: true } : {}),
      ...(r.threadId ? { threadId: r.threadId } : {}),
    } as Item;
  });
  for (const t of out.needs.items)
    items.push({
      key: `n:${t.taskId}`,
      kind: "task",
      shape: "task",
      title: t.title,
      faces: t.askerId ? [{ id: t.askerId, name: names.get(t.askerId) ?? "" }] : [],
      unread: 0,
      mentions: 0,
      muted: false,
      draft: false,
      working: false,
      archived: false,
      ask: false,
      ended: false,
      lastAt: 0,
      ...(t.askerId && names.get(t.askerId) ? { sub: names.get(t.askerId)! } : {}),
      verb: { label: t.verb, tone: t.verb === "Blocked" ? "warn" : "accent" },
    });
  return { items, refs };
}

/** The caller's pin order: the pinned keys by their index. */
export const pinsOf = (out: SideOut): string[] =>
  allRows(out)
    .filter((r) => r.pinned !== null)
    .sort((a, b) => a.pinned! - b.pinned!)
    .map((r) => r.key);

/** What the middle shows, as the row that is drawn selected: a chat or one-to-one by thread, a channel by its main thread, and so on. */
export function openKeyFor(open: string | null | undefined, refs: ReadonlyMap<string, SideRow>): string | null {
  if (!open) return null;
  if (open === "tasks" || open === "notes" || open === "artifacts") return open;
  if (open.startsWith("g:")) return refs.has(open) ? open : null;
  if (open.startsWith("p:")) return refs.has(`pj:${open.slice(2)}`) ? `pj:${open.slice(2)}` : null;
  if (open.startsWith("a:")) return refs.has(`f:${open.slice(2)}`) ? `f:${open.slice(2)}` : null;
  if (open.startsWith("t:")) {
    const id = open.slice(2);
    for (const [k, r] of refs) if (r.threadId === id) return k;
  }
  return null;
}
