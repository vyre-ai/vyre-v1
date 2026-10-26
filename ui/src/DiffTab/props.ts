// Frozen props for ui/DiffTab. Spec 2.16, 4.5 and 4.7, ARCH 7.5, F9.
// A commit, a pull request, two versions, or an agent's working changes.
// Unified or split, word marks, paragraph diff for docx and md, a slider
// for images, inline comments with @, revert of one change.
// Keys, owned by the component: j and k move files, n and p move changes,
// Cmd-Enter reverts the focused change. A diff tab is a tab like any file.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

export type DiffLayout = "unified" | "split";

/** `paragraph` is docx and md. `image` is the side-by-side slider. */
export type DiffBody = "text" | "paragraph" | "image";

export const DIFF_KEYS = ["j", "k", "n", "p", "Cmd-Enter"] as const;

export interface DiffHunk {
  id: string;
  context: string;
  added: string;
  removed: string;
  /** Unchanged lines just above the change, shown as context (a version compare shows them). */
  before?: string;
  /** Unchanged lines just below the change. */
  after?: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  body: DiffBody;
  hunks: readonly DiffHunk[];
}

export interface DiffComment {
  id: string;
  hunkId: string;
  author: string;
  /** The author's id: the face is seeded by it (the name is the fallback). */
  authorId?: string;
  body: string;
  /** People and agents mentioned. A mentioned agent answers in the thread. */
  mentions: readonly string[];
}

export interface DiffTabProps {
  title: string;
  layout: DiffLayout;
  wordMarks: boolean;
  files: readonly DiffFile[];
  comments: readonly DiffComment[];
  selectedPath: string | null;
  density: Density;
}

export const frozenDiffTabProps = {
  title: "AGENT.md",
  layout: "unified",
  wordMarks: true,
  selectedPath: "AGENT.md",
  density: "compact",
  files: [
    {
      path: "AGENT.md",
      added: 2,
      removed: 1,
      body: "paragraph",
      hunks: [
        {
          id: "hunk_1",
          context: "Role",
          added: "Intake answers first.",
          removed: "Intake answers.",
        },
      ],
    },
  ],
  comments: [
    {
      id: "cmt_1",
      hunkId: "hunk_1",
      author: "Omar",
      body: "Keep the shorter line.",
      mentions: [],
    },
  ],
} as const satisfies DiffTabProps;
