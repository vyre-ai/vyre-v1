// Records sidebar groups (spec 3.4, ARCH 7.4).
// Record types sit in Personal, Shared with me, and Space.
// Site tables (scope other than "space") collect under Sites.
// Agents, Projects and Journeys are not the whole type: only the ones the caller is in.

import type { ListRow, ListSection, ListSectionName } from "../../../../../../ui/src/ListSections/props.ts";

export const SITES_GROUP = "Sites";
export const UNGROUPED = "Types";

export type SidebarSection = "personal" | "shared" | "space";
export type MemberKind = "agent" | "project" | "journey";

export interface SidebarType {
  key: string;
  title: string;
  group?: string;
  scope?: string;
  section: SidebarSection;
}

export interface SidebarMember {
  id: string;
  title: string;
  kind: MemberKind;
  section: SidebarSection;
}

const SECTION_NAME: Record<SidebarSection, ListSectionName> = {
  personal: "Personal",
  shared: "Shared with me",
  space: "Space",
};

const KIND_GROUP: Record<MemberKind, string> = {
  agent: "Agents",
  project: "Projects",
  journey: "Journeys",
};

const SECTION_ORDER: readonly SidebarSection[] = ["personal", "shared", "space"];

/** A site table is a record type whose scope is a site id, not the Space. */
export function isSiteScope(scope: string | undefined): boolean {
  return scope !== undefined && scope.length > 0 && scope !== "space";
}

/** The type row is replaced by the membership list. Site tables stay in Sites. */
export function isMembershipType(type: { key: string; group?: string; scope?: string }): boolean {
  if (isSiteScope(type.scope)) return false;
  if (type.key === "agent" || type.key === "project" || type.key === "journey") return true;
  return type.group === "Agents" || type.group === "Projects" || type.group === "Journeys";
}

export function typeGroup(type: { group?: string; scope?: string }): string {
  if (isSiteScope(type.scope)) return SITES_GROUP;
  if (type.group !== undefined && type.group.length > 0) return type.group;
  return UNGROUPED;
}

function groupRank(name: string): number {
  if (name === SITES_GROUP) return 2;
  if (name === UNGROUPED) return 1;
  return 0;
}

interface NotedRow {
  id: string;
  title: string;
  note: string;
}

function toListRow(row: NotedRow): ListRow {
  return { id: row.id, title: row.title, note: row.note };
}

/** Grouped type rows plus the agents, projects and journeys the caller is in. */
export function sidebarSections(types: readonly SidebarType[], members: readonly SidebarMember[]): ListSection[] {
  const buckets = new Map<SidebarSection, NotedRow[]>();
  for (const section of SECTION_ORDER) buckets.set(section, []);

  for (const type of types) {
    if (isMembershipType(type)) continue;
    const bucket = buckets.get(type.section);
    if (!bucket) continue;
    bucket.push({
      id: `type:${type.key}`,
      title: type.title,
      note: typeGroup(type),
    });
  }

  for (const member of members) {
    const bucket = buckets.get(member.section);
    if (!bucket) continue;
    bucket.push({
      id: `${member.kind}:${member.id}`,
      title: member.title,
      note: KIND_GROUP[member.kind],
    });
  }

  const sections: ListSection[] = [];
  for (const section of SECTION_ORDER) {
    const rows = buckets.get(section) ?? [];
    rows.sort((a, b) => {
      const rank = groupRank(a.note) - groupRank(b.note);
      if (rank !== 0) return rank;
      if (a.note !== b.note) return a.note < b.note ? -1 : 1;
      if (a.title !== b.title) return a.title < b.title ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    sections.push({ name: SECTION_NAME[section], rows: rows.map(toListRow) });
  }
  return sections;
}
