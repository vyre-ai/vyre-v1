// Pure helpers for the "Bring your sessions" rows: name, folder, relative date, newest-first order and the folder filter. No imports, so it runs under plain node.
export interface SessionRowSource { provider: string; sessionId: string; sessionKey: string; cwd?: string | null; title?: string | null; updatedAt?: string | null }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Epoch milliseconds from an ISO string, epoch seconds or epoch milliseconds (as text or number); 0 when unknown. */
export function modifiedAt(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) { const n = Number(text); return n < 1e11 ? n * 1000 : n; }
  const t = Date.parse(text);
  return Number.isNaN(t) ? 0 : t;
}

/** One-line name: the session's title, else a short id so two unnamed rows still differ. */
export function sessionName(src: SessionRowSource): string {
  const t = (src.title ?? "").replace(/\s+/g, " ").trim();
  return t || `Untitled session ${src.sessionId.slice(0, 8)}`;
}

/** The last segment of the working folder; empty when there is none. */
export function folderName(cwd: string | null | undefined): string {
  return (cwd ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** "5 minutes ago", "2 hours ago", "Yesterday", "3 days ago", "12 Oct" (with the year when it is not this year); empty when the date is unknown. */
export function relativeDate(ms: number, now: number): string {
  if (!ms) return "";
  const diff = now - ms;
  const d = new Date(ms), n = new Date(now);
  const day = (x: Date): number => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const days = day(n) - day(d);
  if (diff < 60_000) return "Just now";
  if (days <= 0 && diff < 3_600_000) { const m = Math.floor(diff / 60_000); return `${m} minute${m === 1 ? "" : "s"} ago`; }
  if (days <= 0 && diff < 86_400_000) { const h = Math.floor(diff / 3_600_000); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  const label = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

/** Newest first; rows with no date go last, in a stable order by key. */
export function newestFirst<T extends SessionRowSource>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => modifiedAt(b.updatedAt) - modifiedAt(a.updatedAt) || a.sessionKey.localeCompare(b.sessionKey));
}

/** Folders present, most sessions first (ties by name). */
export function folderChoices(rows: readonly SessionRowSource[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) { const f = folderName(r.cwd); if (f) counts.set(f, (counts.get(f) ?? 0) + 1); }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Select all state for the rows in view: none, some (indeterminate) or all. */
export function selectState(keys: readonly string[], picked: ReadonlySet<string>): "none" | "some" | "all" {
  const n = keys.filter((k) => picked.has(k)).length;
  return n === 0 ? "none" : n === keys.length ? "all" : "some";
}
