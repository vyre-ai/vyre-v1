// Frozen props for ui/ShareSheet. Spec 2.4 and 4.9, ARCH 4.12, F9.
// One sheet everywhere: a person, group, role or agent at View, Use, Edit
// or Manage. A folder share covers everything inside. Public and guest
// links need files.share_external and a Console sharing rule, and are view only.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

export const SHARE_LEVELS = [
  { id: "view", label: "View", hint: "See it and how it is doing" },
  { id: "use", label: "Use", hint: "Open it and use it" },
  { id: "edit", label: "Edit", hint: "Change how it works" },
  { id: "manage", label: "Manage", hint: "Share it, move it and delete it" },
] as const;

export type ShareLevel = (typeof SHARE_LEVELS)[number]["id"];

export type ShareSubjectKind = "person" | "group" | "role" | "agent" | "link";

/** How this row was earned. A folder row cannot be lowered on the item. */
export type ShareVia = "owner" | "grant" | "folder" | "space";

export interface ShareRow {
  subjectKind: ShareSubjectKind;
  subjectId: string;
  name: string;
  level: ShareLevel;
  via: ShareVia;
  /** Set when the row is inherited. The sheet shows it and the item cannot lower it. */
  fromFolderId: string | null;
}

export interface ShareSheetProps {
  resourceType: string;
  resourceId: string;
  resourceName: string;
  /** Folder sharing covers the children. An item share sits on top of its folder. */
  target: "folder" | "item";
  ownerName: string;
  /** Levels this type offers. Comes from ListDef.shareLevels. */
  levels: readonly ShareLevel[];
  shares: readonly ShareRow[];
  /** False hides the public link row. Guest links are view only. */
  allowExternal: boolean;
  density: Density;
}

export const frozenShareSheetProps = {
  resourceType: "folder",
  resourceId: "fld_clients",
  resourceName: "Clients",
  target: "folder",
  ownerName: "Irfad",
  levels: ["view", "use", "edit", "manage"],
  allowExternal: false,
  density: "compact",
  shares: [
    {
      subjectKind: "person",
      subjectId: "prs_omar",
      name: "Omar",
      level: "edit",
      via: "grant",
      fromFolderId: null,
    },
  ],
} as const satisfies ShareSheetProps;
