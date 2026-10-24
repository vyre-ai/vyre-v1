// Frozen props for ui/ObjectPage. Spec 3.10, ARCH 7.10, F9.
// Every Console object: header (name, kind, owner, status, actions),
// tabs Overview, Access, Activity plus specifics, and a side sheet.
// Destructive actions show impact before confirm. The page supplies the ids.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

export interface ObjectAction {
  id: string;
  label: string;
  destructive: boolean;
}

export interface ObjectTab {
  id: string;
  label: string;
  /** Badge count. Null when the tab has no count. */
  count: number | null;
}

/** The three tabs every object has. Callers append the specific ones. */
export const OBJECT_PAGE_BASE_TABS: readonly ObjectTab[] = [
  { id: "overview", label: "Overview", count: null },
  { id: "access", label: "Access", count: null },
  { id: "activity", label: "Activity", count: null },
];

export interface ObjectPageProps {
  id: string;
  name: string;
  kind: string;
  owner: string;
  status: string;
  actions: readonly ObjectAction[];
  tabs: readonly ObjectTab[];
  activeTabId: string;
  sheetOpen: boolean;
  density: Density;
}

export const frozenObjectPageProps = {
  id: "prs_omar",
  name: "Omar",
  kind: "Person",
  owner: "Northwind",
  status: "Active",
  actions: [
    { id: "change-roles", label: "Change roles", destructive: false },
    { id: "remove", label: "Remove", destructive: true },
  ],
  tabs: [
    { id: "overview", label: "Overview", count: null },
    { id: "access", label: "Access", count: 4 },
    { id: "activity", label: "Activity", count: null },
  ],
  activeTabId: "overview",
  sheetOpen: false,
  density: "compact",
} as const satisfies ObjectPageProps;
