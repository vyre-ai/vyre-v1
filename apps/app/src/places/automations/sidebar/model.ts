// Automations sidebar model (spec 3.7, ARCH 7.7). Groups sit beside the
// Automations and Journeys tabs. Automations also split into Personal,
// Shared with me, and Space, which ui/ListSections paints.

export const SIDEBAR_TABS = ["automations", "journeys"] as const;
export type SidebarTab = (typeof SIDEBAR_TABS)[number];

export const ACCESS_SECTIONS = ["Personal", "Shared with me", "Space"] as const;
export type AccessSection = (typeof ACCESS_SECTIONS)[number];

export interface GroupRow {
  id: string;
  name: string;
  count: number;
  order: number;
}

export interface AutomationListItem {
  id: string;
  title: string;
  section: AccessSection;
  groupId?: string;
  note?: string;
}

export interface JourneyListItem {
  id: string;
  title: string;
  note?: string;
}

export interface SidebarModel {
  tab: SidebarTab;
  groups: readonly GroupRow[];
  /** Null is every Group. */
  selectedGroupId: string | null;
  automations: readonly AutomationListItem[];
  journeys: readonly JourneyListItem[];
  query: string;
  seq: number;
}

export function emptySidebar(): SidebarModel {
  return {
    tab: "automations",
    groups: [],
    selectedGroupId: null,
    automations: [],
    journeys: [],
    query: "",
    seq: 1,
  };
}

export function sampleSidebar(): SidebarModel {
  return {
    tab: "automations",
    selectedGroupId: null,
    query: "",
    seq: 3,
    groups: [
      { id: "agr_intake", name: "Intake", count: 1, order: 0 },
      { id: "agr_billing", name: "Billing", count: 1, order: 1 },
    ],
    automations: [
      { id: "aut_stage", title: "Stage change", section: "Personal", groupId: "agr_intake", note: "On" },
      { id: "aut_shared", title: "Shared digest", section: "Shared with me", note: "On" },
      { id: "aut_nightly", title: "Nightly billing", section: "Space", groupId: "agr_billing", note: "Paused" },
    ],
    journeys: [
      { id: "jrn_onboard", title: "Client onboarding", note: "4 stages" },
    ],
  };
}

export function withTab(model: SidebarModel, tab: SidebarTab): SidebarModel {
  return { ...model, tab };
}

export function withGroup(model: SidebarModel, selectedGroupId: string | null): SidebarModel {
  return { ...model, selectedGroupId };
}

export function withQuery(model: SidebarModel, query: string): SidebarModel {
  return { ...model, query };
}

export function createGroup(model: SidebarModel, name: string): SidebarModel {
  const group: GroupRow = { id: `agr_${model.seq}`, name, count: 0, order: model.groups.length };
  return { ...model, seq: model.seq + 1, groups: [...model.groups, group], selectedGroupId: group.id };
}

export function visibleAutomations(model: SidebarModel): AutomationListItem[] {
  const query = model.query.trim().toLowerCase();
  return model.automations.filter((item) => {
    if (model.selectedGroupId && item.groupId !== model.selectedGroupId) return false;
    if (query.length > 0 && !item.title.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function groupCount(model: SidebarModel, groupId: string): number {
  return model.automations.filter((item) => item.groupId === groupId).length;
}
