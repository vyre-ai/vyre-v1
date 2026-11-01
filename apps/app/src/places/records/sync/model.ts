// Records > sync (the pure part): what a synced type shows. The dot in the sidebar, the chip on a record, the mark beside a field and the lines of the Sync page are all decided here from what
// the server says (sync_types.list, sync_types.record_state, sync_types.status), so a screen only draws. Words are short; the longer ones are tooltips.
import { brandForDomain, brandForName } from "../../../../../../ui/src/AppIcon/index.tsx";

export type FieldState = "synced" | "saving" | "failed" | "local";
export type Dir = "pull" | "push" | "both" | "off";
export interface App { key?: string; title: string; domain?: string }

/** One row of sync_types.list, as far as the sidebar needs it. */
export interface SyncedRow { type: string; connector: string; state: "initial" | "syncing" | "paused" | "needs_review" | "error"; pending: number; conflicts: number; schemaChanges: number; lastSyncAt?: number; app?: { title: string; domain?: string } }
export interface RecordFieldState { key: string; dir: Dir; state: FieldState; at?: number; error?: string; outboxId?: string; history: number }
export interface RecordSync { synced: boolean; app?: App; remoteId?: string; openUrl?: string; state: FieldState; lastSyncAt?: number; fields: RecordFieldState[] }
export interface HistoryEntry { historyId: string; value: unknown; at?: number; replacedBy: "app" | "you" | "push"; by?: string; actor: string }

export type DotState = "live" | "syncing" | "needs" | "paused";
/** The sidebar's dot: needs you when something waits on a person, syncing until the first pass has finished or while pushes are on their way, paused when it was paused, live otherwise. */
export function dotOf(r: Pick<SyncedRow, "state" | "pending" | "conflicts" | "schemaChanges">): DotState {
  if (r.conflicts > 0 || r.schemaChanges > 0 || r.state === "error" || r.state === "needs_review") return "needs";
  if (r.state === "paused") return "paused";
  if (r.state === "initial" || r.pending > 0) return "syncing";
  return "live";
}

export function dotTip(r: Pick<SyncedRow, "state" | "pending" | "conflicts" | "schemaChanges">, app: string): string {
  const d = dotOf(r);
  if (d === "needs") {
    if (r.state === "error") return `${app} needs you to sign in again`;
    const parts: string[] = [];
    if (r.conflicts > 0) parts.push(r.conflicts === 1 ? "1 change to decide" : `${r.conflicts} changes to decide`);
    if (r.schemaChanges > 0) parts.push(r.schemaChanges === 1 ? "1 field change to review" : `${r.schemaChanges} field changes to review`);
    return parts.length ? `${app}: ${parts.join(", ")}` : `${app} needs you`;
  }
  if (d === "paused") return `Sync with ${app} is paused`;
  if (d === "syncing") return r.state === "initial" ? `Bringing in from ${app}` : `Sending ${r.pending} ${r.pending === 1 ? "change" : "changes"} to ${app}`;
  return `In step with ${app}`;
}

/** The AppIcon brand key for an app: from its name, else from its host; null draws a letter tile. */
export function brandOf(app: App | undefined, connector?: string): string | null {
  const name = app?.title ?? (connector ?? "").replace(/^crm_/, "");
  return brandForName(name) ?? (app?.domain ? brandForDomain(app.domain) : null);
}

/** "2 s", "5 min", "3 h", "2 d": short, for tooltips. */
export function agoShort(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${Math.max(1, s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

/** "in 4 min": how long until a time ahead. */
export function untilShort(at: number, now: number): string {
  const s = Math.max(0, Math.round((at - now) / 1000));
  return s < 60 ? "in a moment" : `in ${agoShort(now - s * 1000, now)}`;
}

export const savedTip = (app: string, at: number | undefined, now: number): string => (at ? `Saved to ${app} ${agoShort(at, now)} ago` : `Saved to ${app}`);

export type MarkKind = "none" | "lock" | "saving" | "saved" | "failed" | "local";
/** The mark beside a field: a lock when the app owns it, a spinner while it is on its way, a check once saved, a red retry when it could not be. */
export function markOf(f: Pick<RecordFieldState, "dir" | "state" | "at" | "error" | "history">, app: string, now: number): { kind: MarkKind; tip: string } {
  if (f.dir === "off") return { kind: "none", tip: "" };
  if (f.dir === "pull") return { kind: "lock", tip: `Read from ${app}. Change it there.` };
  if (f.state === "saving") return { kind: "saving", tip: `Saving to ${app}` };
  if (f.state === "failed") return { kind: "failed", tip: `Could not save to ${app}${f.error ? `: ${f.error.replace(/\.$/, "")}` : ""}. Press to try again.` };
  if (f.state === "local") return { kind: "local", tip: `Only here so far. It goes to ${app} when this record is linked.` };
  return { kind: "saved", tip: savedTip(app, f.at, now) };
}

/** The line under a history entry: who replaced it and when. */
export function replacedLine(e: HistoryEntry, app: string, now: number, name?: (id: string) => string): string {
  const when = e.at ? ` ${agoShort(e.at, now)} ago` : "";
  if (e.replacedBy === "push") return `Sent to ${app}${e.by && name ? ` by ${name(e.by)} via Vyre` : " via Vyre"}${when}`;
  return e.replacedBy === "app" ? `Replaced by ${app}${when}` : `Your newer change replaced it${when}`;
}

/** One line for the Sync page: how many records, of how many the app has. */
export function recordsLine(records: number, estimate: number | undefined): string {
  if (estimate === undefined) return `${records.toLocaleString("en-US")} ${records === 1 ? "record" : "records"}`;
  return `${records.toLocaleString("en-US")} of ${estimate.toLocaleString("en-US")}`;
}

export function progressOf(records: number, estimate: number | undefined): number | null {
  return estimate && estimate > 0 ? Math.max(0, Math.min(1, records / estimate)) : null;
}

export const PAGE_STATE = { live: "Live", syncing: "Syncing", needs: "Needs you", paused: "Paused" } as const satisfies Record<DotState, string>;

/** The state words of the Sync page's header. */
export function pageState(s: { state: SyncedRow["state"]; paused: boolean; pending: number; conflicts: number; schemaChanges: number }): DotState {
  return dotOf({ state: s.paused ? "paused" : s.state, pending: s.pending, conflicts: s.conflicts, schemaChanges: s.schemaChanges });
}

/** The server's sync_types.status, as the Sync page draws it. */
export interface TypeStatus {
  type: string; app: App; state: SyncedRow["state"]; paused: boolean; deletes: "off" | "soft" | "travel"; conflict: string; polling: { activeSec: number; idleSec: number; dormantSec: number };
  records: number; estimate?: number; filter?: string; canBackfill: boolean; catchingUp?: boolean; lastRun?: { at: number; summary: string }; pending: number; failedPushes: number; conflicts: number; schemaChanges: number;
  failures: { at: number; summary: string }[]; sentToday: number; nextPollAt?: number; spec: boolean;
}
export interface OutboxItem { outboxId: string; recordId: string; op: "create" | "update" | "delete"; fields: string[]; state: string; attempts: number; error?: string; at: number }

export const DELETE_WORDS = { off: "Deletes here never reach the app", soft: "A delete here marks the record in the app", travel: "A delete here deletes it in the app" } as const;
