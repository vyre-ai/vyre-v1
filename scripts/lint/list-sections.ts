// list-sections: a place sidebar for a type declared in lists renders through ui/ListSections
// (ARCHITECTURE-V1 4.12). Sections are Personal, Shared with me, and Space.

import { finding } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { listedSidebarType } from "./paths.ts";

const RULE = "list-sections";

export function appliesListSections(file: string): boolean {
  return listedSidebarType(file) !== null;
}

export function checkListSections(file: string, source: string): Finding[] {
  const type = listedSidebarType(file);
  if (!type) return [];
  if (/\bListSections\b/.test(source)) return [];
  if (!rendersList(source)) return [];
  return [finding(RULE, file, source, 0, `place sidebar for ${type} must use ui/ListSections`)];
}

function rendersList(source: string): boolean {
  return /\.map\s*\(/.test(source) || /<(?:FlatList|VirtualList|SectionList|FlashList)\b/.test(source);
}
