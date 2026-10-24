// Sidebar screen automations.sidebar (builtin ui:AutomationsSidebar).
// Groups, then the Automations and Journeys tabs. Automations go through
// ui/ListSections (Personal, Shared with me, Space). Empty copy matches
// the screen: "No automations yet", primary "New automation".

import { ListSectionsPlaceholder } from "../../../../../../ui/src/ListSections/Placeholder.tsx";
import type { ListRow, ListSection } from "../../../../../../ui/src/ListSections/props.ts";
import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { TabStripPlaceholder } from "../../../../../../ui/src/TabStrip/Placeholder.tsx";
import { ACCESS_SECTIONS, groupCount, visibleAutomations } from "./model.ts";
import type { AutomationListItem, SidebarModel } from "./model.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function rowOf(item: AutomationListItem): ListRow {
  const row: ListRow = { id: item.id, title: item.title };
  if (item.note) row.note = item.note;
  return row;
}

function sections(items: readonly AutomationListItem[]): ListSection[] {
  return ACCESS_SECTIONS.map((name) => ({
    name,
    rows: items.filter((item) => item.section === name).map(rowOf),
  }));
}

function groups(model: SidebarModel): string {
  const all = RowPlaceholder({
    id: "all",
    title: "All",
    note: String(model.automations.length),
    selected: model.selectedGroupId === null,
  });
  const ordered = [...model.groups].sort((a, b) => a.order - b.order);
  const rest = ordered.map((group) => RowPlaceholder({
    id: group.id,
    title: group.name,
    note: String(groupCount(model, group.id)),
    selected: model.selectedGroupId === group.id,
  })).join("");
  return `<div data-groups="true"><h3>Groups</h3>${all}${rest}</div>`;
}

function automations(model: SidebarModel): string {
  if (model.automations.length === 0 && model.query.trim().length === 0) {
    return StatesPlaceholder({
      kind: "empty",
      title: "No automations yet",
      action: { label: "New automation", onPress: () => undefined },
    });
  }
  return ListSectionsPlaceholder({ type: "automations", sections: sections(visibleAutomations(model)) });
}

function journeys(model: SidebarModel): string {
  const query = model.query.trim().toLowerCase();
  const items = model.journeys.filter((item) => query.length === 0 || item.title.toLowerCase().includes(query));
  if (items.length === 0) {
    return StatesPlaceholder({
      kind: "empty",
      title: "No journeys yet",
      action: { label: "New journey", onPress: () => undefined },
    });
  }
  return items.map((item) => {
    const props: { id: string; title: string; note?: string } = { id: item.id, title: item.title };
    if (item.note) props.note = item.note;
    return RowPlaceholder(props);
  }).join("");
}

/** Sidebar body. Lists reserve their row height by using ui/Row at full width. */
export function renderSidebar(model: SidebarModel): string {
  const tabs = TabStripPlaceholder({
    tabs: [
      { key: "automations", title: "Automations" },
      { key: "journeys", title: "Journeys" },
    ],
    active: model.tab,
  });
  const body = model.tab === "journeys" ? journeys(model) : `${groups(model)}${automations(model)}`;
  return `<nav data-screen-id="automations.sidebar" data-builtin="ui:AutomationsSidebar" data-tab="${esc(model.tab)}" style="min-height:160px">${tabs}${body}</nav>`;
}
