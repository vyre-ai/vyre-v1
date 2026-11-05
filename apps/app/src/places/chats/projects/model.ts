// Projects in the Chats sidebar (lane l-chrome2a): a group after Goals with each project's health dot, starred ones first. Pure: rows in, order out.
import type { CapMap } from "../../../../../../generated/types.ts";

export type Health = "on" | "risk" | "off" | "hold" | "done";
export interface ProjectLine { id: string; recordId?: string; unread?: number; title: string; health?: Health; starred: boolean; archived: boolean }
type ListRow = CapMap["projects.list"]["out"]["projects"][number];

export const PROJECTS_SHOWN = 3;

export function projectLines(rows: readonly ListRow[], starred: ReadonlySet<string>): ProjectLine[] {
  return rows.map((r) => ({ id: r.projectId, recordId: r.recordId, title: r.title, ...(r.health ? { health: r.health } : {}), starred: starred.has(r.projectId), archived: r.archivedAt !== undefined }));
}

/** Starred first, then the order the Space lists them in; an archived project is in no list. */
export function sidebarProjects(lines: readonly ProjectLine[]): ProjectLine[] {
  const live = lines.filter((l) => !l.archived);
  return [...live.filter((l) => l.starred), ...live.filter((l) => !l.starred)];
}
