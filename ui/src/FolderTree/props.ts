// Frozen props for ui/FolderTree. Spec 2.4 and 4.9, ARCH 4.12, F9.
// One tree for every list of things: Personal, Shared with me, Space.
// A folder's sharing covers everything placed in it. The section is the
// replica's `via` value, so the sidebar does not ask the server.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

export const FOLDER_SECTIONS = [
  { id: "personal", label: "Personal" },
  { id: "shared", label: "Shared with me" },
  { id: "space", label: "Space" },
] as const;

export type FolderSectionId = (typeof FOLDER_SECTIONS)[number]["id"];

/** `folders.scope` in the access projection. */
export type FolderScope = "personal" | "space";

/** `my_access.via`. Personal is owner, Shared with me is grant or folder, Space is space. */
export type AccessVia = "owner" | "grant" | "folder" | "space";

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Items placed in the folder. The count is local, from `placement`. */
  count: number;
  scope: FolderScope;
  section: FolderSectionId;
  via: AccessVia;
  open: boolean;
}

export interface FolderTreeProps {
  /** Resource type this list organises: site, form, file, agent, and the rest of spec 2.4. */
  resourceType: string;
  nodes: readonly FolderNode[];
  selectedId: string | null;
  density: Density;
}

export const frozenFolderTreeProps = {
  resourceType: "site",
  selectedId: "fld_clients",
  density: "compact",
  nodes: [
    {
      id: "fld_drafts",
      name: "Drafts",
      parentId: null,
      count: 1,
      scope: "personal",
      section: "personal",
      via: "owner",
      open: true,
    },
    {
      id: "fld_clients",
      name: "Clients",
      parentId: null,
      count: 3,
      scope: "space",
      section: "space",
      via: "space",
      open: false,
    },
  ],
} as const satisfies FolderTreeProps;
