// Frozen props for ui/ListSections (ARCH 4.12, spec 2.4).
// Sections are Personal, Shared with me, and Space, in that order.
// Rows inside a section are ui/Row. Hover and selection paint the full row.

export const LIST_SECTION_NAMES = ["Personal", "Shared with me", "Space"] as const;

export type ListSectionName = (typeof LIST_SECTION_NAMES)[number];

/** Folder names the list-sections lint already treats as this component. */
export const LIST_TYPES = [
  "sites",
  "forms",
  "campaigns",
  "automations",
  "agents",
  "records",
  "vault",
  "channels",
  "runbooks",
  "terminals",
  "files",
] as const;

export type ListType = (typeof LIST_TYPES)[number];

export interface ListRow {
  id: string;
  title: string;
  note?: string;
}

export interface ListSection {
  name: ListSectionName;
  rows: readonly ListRow[];
}

export interface ListSectionsProps {
  type: ListType;
  sections: readonly ListSection[];
}

/** Missing sections are present and empty. Order is Personal, Shared with me, Space. */
export function sectionsInOrder(sections: readonly ListSection[]): ListSection[] {
  const byName = new Map<ListSectionName, ListSection>();
  for (const section of sections) {
    if (!byName.has(section.name)) byName.set(section.name, section);
  }
  return LIST_SECTION_NAMES.map((name) => byName.get(name) ?? { name, rows: [] });
}
