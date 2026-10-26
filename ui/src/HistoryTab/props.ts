// Frozen props for ui/HistoryTab. Spec 4.5, ARCH 7 and 3.7, F9.
// One pattern for files, records, Automations, memory, Kits and agent
// definitions: versions with who and why, compare (a diff tab), restore.
// Undo this run groups writes that share a runId. A version is undoable
// only while it is still current, and sent messages and deployments are not.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

export const HISTORY_RESOURCE_TYPES = ["file", "record", "automation", "memory", "kit", "agent"] as const;

export type HistoryResourceType = (typeof HISTORY_RESOURCE_TYPES)[number];

export const HISTORY_ACTIONS = ["compare", "restore"] as const;

export interface HistoryVersion {
  id: string;
  n: number;
  who: string;
  /** The id of who made it: the face is seeded by it (the name is the fallback). */
  whoId?: string;
  why: string;
  /** ISO time. The row shows who and why beside it. */
  at: string;
  /** Set when an agent run wrote the version. Undo this run groups on this id. */
  runId: string | null;
  undoable: boolean;
}

export interface HistoryTabProps {
  resourceType: HistoryResourceType;
  resourceId: string;
  versions: readonly HistoryVersion[];
  selectedVersionId: string | null;
  density: Density;
}

export const frozenHistoryTabProps = {
  resourceType: "file",
  resourceId: "file_agent_md",
  selectedVersionId: "ver_2",
  density: "compact",
  versions: [
    {
      id: "ver_2",
      n: 2,
      who: "Irfad",
      why: "Shorten the role line",
      at: "2026-10-24T12:00:00Z",
      runId: null,
      undoable: true,
    },
    {
      id: "ver_1",
      n: 1,
      who: "Intake",
      why: "First draft",
      at: "2026-10-23T09:00:00Z",
      runId: "run_1",
      undoable: false,
    },
  ],
} as const satisfies HistoryTabProps;
