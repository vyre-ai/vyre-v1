// automations.sidebar: Groups, Automations and Journeys.

export {
  ACCESS_SECTIONS,
  createGroup,
  emptySidebar,
  groupCount,
  sampleSidebar,
  SIDEBAR_TABS,
  visibleAutomations,
  withGroup,
  withQuery,
  withTab,
} from "./model.ts";
export type {
  AccessSection,
  AutomationListItem,
  GroupRow,
  JourneyListItem,
  SidebarModel,
  SidebarTab,
} from "./model.ts";
export { renderSidebar } from "./render.ts";
