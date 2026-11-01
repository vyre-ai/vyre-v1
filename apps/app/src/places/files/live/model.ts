// Live folders in Files (rc.8): one list of every mount with its source, whether it is live or when it last synced, how far behind it is, what needs a look, who can see it, and what can be done.
// This is the words and the choices, without a renderer. The data is mounts.list and, for who can see it, access.shares_of on the mount's folder.
import type { CapMap } from "../../../../../../generated/types.ts";

export type MountRow = CapMap["mounts.list"]["out"]["mounts"][number];
export type Share = CapMap["access.shares_of"]["out"]["shares"][number];

export type LiveTone = "ok" | "warn" | "bad" | "quiet";
export type LiveAction = "reconnect" | "sync" | "pause" | "resume" | "open";

export interface LiveRow {
  mountId: string;
  folderId: string;
  name: string;
  kind: MountRow["kind"];
  provider: string;
  /** "Live", "Synced 5 min ago", "Syncing", "Paused", "Needs attention", "Computer offline". */
  state: string;
  tone: LiveTone;
  /** Quiet second part: how far behind, changes waiting, conflicts, the error. */
  detail: string;
  who: string;
  /** The first is the button; the rest go in the menu. */
  actions: LiveAction[];
}

/** A mount that synced in the last 90 seconds and is not behind is Live. Anything older says when it last synced, never a promise it cannot keep. */
export const LIVE_WITHIN_MS = 90_000;

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};

/** Whether a failing mount is failing because the sign-in no longer works: the fix is Reconnect, not Sync now. */
export const needsReconnect = (m: Pick<MountRow, "state" | "error">): boolean => m.state === "failing" && /sign in|reconnect|auth|expired|consent|permission/i.test(m.error ?? "");

export function whoWords(shares: readonly Share[] | null): string {
  if (shares === null) return "";
  const people = new Set<string>();
  let group = false;
  for (const s of shares) {
    if (s.grant.subject.kind === "person") people.add(s.grant.subject.id);
    else if (s.grant.subject.kind === "group" || s.grant.subject.kind === "role") group = true;
  }
  if (group) return "Shared with a group";
  return people.size === 0 ? "Only you" : people.size === 1 ? "You and 1 person" : `You and ${people.size} people`;
}

export function liveRow(m: MountRow, shares: readonly Share[] | null, now: number): LiveRow {
  const synced = m.lastSyncAt !== undefined ? now - m.lastSyncAt : null;
  const behind = (m.lagSeconds ?? 0) >= 30 ? `${m.lagSeconds} s behind` : "";
  const bits: string[] = [];
  if (m.pendingChanges > 0) bits.push(`${m.pendingChanges} ${m.pendingChanges === 1 ? "change" : "changes"} waiting`);
  if (m.conflicts > 0) bits.push(`${m.conflicts} ${m.conflicts === 1 ? "conflict" : "conflicts"}`);
  let state: string; let tone: LiveTone; let actions: LiveAction[];
  if (m.state === "failing") {
    state = "Needs attention"; tone = "bad"; if (m.error) bits.unshift(m.error);
    actions = needsReconnect(m) ? ["reconnect", "sync", "pause", "open"] : ["sync", "pause", "open"];
  } else if (m.state === "paused") { state = "Paused"; tone = "quiet"; actions = ["resume", "open"]; }
  else if (m.state === "device_offline") { state = "Computer offline"; tone = "warn"; actions = ["open"]; }
  else if (m.state === "syncing") { state = "Syncing"; tone = "ok"; actions = ["pause", "open"]; }
  else {
    const live = synced !== null && synced <= LIVE_WITHIN_MS && behind === "" && m.kind !== "local";
    state = live ? "Live" : synced !== null ? `Synced ${ago(synced)}` : "Not synced yet";
    tone = m.conflicts > 0 ? "warn" : "ok";
    actions = m.kind === "local" ? ["pause", "open"] : ["sync", "pause", "open"];
  }
  if (behind) bits.unshift(behind);
  return { mountId: m.mountId, folderId: m.folderId, name: m.name, kind: m.kind, provider: m.provider, state, tone, detail: bits.join(" · "), who: whoWords(shares), actions };
}

export const ACTION_LABEL: Record<LiveAction, string> = { reconnect: "Reconnect", sync: "Sync now", pause: "Pause", resume: "Resume", open: "Open" };

/** Needs attention first, then paused and offline, then the rest by name. */
export function orderRows(rows: readonly LiveRow[]): LiveRow[] {
  const rank = (r: LiveRow): number => (r.tone === "bad" ? 0 : r.tone === "warn" ? 1 : r.state === "Paused" ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The line at the top: how many folders and how many need a look. */
export function summaryLine(rows: readonly LiveRow[]): string {
  if (rows.length === 0) return "";
  const bad = rows.filter((r) => r.tone === "bad").length;
  const head = `${rows.length} ${rows.length === 1 ? "folder" : "folders"}`;
  return bad > 0 ? `${head} · ${bad} ${bad === 1 ? "needs" : "need"} attention` : `${head} · all well`;
}
