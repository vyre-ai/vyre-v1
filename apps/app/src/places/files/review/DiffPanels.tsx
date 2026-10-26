// The diff tabs (spec 2.16, 4.5; screens files.diff and files.commit-diff): the shared ui/DiffTab fed by files.diff (two versions of a file), changesets.diff with the comments (an agent's changes) and
// git.show (a commit). Revert of one change and a comment call their capabilities through DiffTab's own invoke. Nothing here draws a line of the diff.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DiffTab } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { Density, DiffFile } from "../../../../../../ui/src/DiffTab/index.tsx";
import { useCap, useCapMany, useReviewData, useReviewLayout } from "./data.tsx";
import { commentsOf, commitFiles, diffFileOf } from "./model.ts";
import { Skeleton } from "./parts.tsx";

const LOADING_HEIGHT = 240;

function Empty({ text }: { text: string }): ReactElement {
  return <View style={st.empty} testID="diff-empty"><Text style={st.emptyText}>{text}</Text></View>;
}

export interface FileDiffProps {
  fileId: string;
  /** Version ids. Without them the file's current version against the one before. */
  from?: string;
  to?: string;
  /** The file's name, for the title and the path. */
  name: string;
  density?: Density;
  /** A version compare: no toolbar, the changed lines between "..." marks with their neighbours. */
  bare?: boolean;
}

/** files.diff: two versions of one file. */
export function FileDiff({ fileId, from, to, name, density = "regular", bare = true }: FileDiffProps): ReactElement {
  const data = useReviewData();
  const q = useCap("files.diff", { fileId, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const files = useMemo<DiffFile[]>(() => (q.status === "ready" ? [diffFileOf(name, q.data)] : []), [q, name]);
  if (q.status !== "ready") return <Skeleton height={LOADING_HEIGHT} testID="diff-loading" />;
  if (q.data.identical) return <Empty text="These two versions are the same." />;
  return (
    <DiffTab title={name} layout="unified" wordMarks files={files} comments={[]} selectedPath={name} density={density} bare={bare} invoke={(c, i) => data.call(c, i)} testID="file-diff" />
  );
}

export interface ChangesetDiffProps {
  changesetId: string;
  density?: Density;
  /** The file to open on; the others start collapsed when given. */
  path?: string;
}

/** changesets.get for the files, then changesets.diff for each and the comments: the shared DiffTab in its review form (bare: no toolbar, the page header owns Unified and Split), with its file list (name, +added -removed, "image" for a picture) beside the one open file, headed by that file's row (name, v2 to v3, +added -removed). j and k move between files. */
export function ChangesetDiff({ changesetId, density = "regular", path }: ChangesetDiffProps): ReactElement {
  const data = useReviewData();
  const cs = useCap("changesets.get", { changesetId });
  const paths = useMemo<string[]>(() => (cs.status === "ready" ? cs.data.files.map((f) => f.path) : []), [cs]);
  const diffs = useCapMany("changesets.diff", paths.map((p) => ({ changesetId, path: p })));
  const comments = useCap("changesets.comments.list", { changesetId });
  const files = useMemo<DiffFile[]>(() => {
    const out: DiffFile[] = [];
    paths.forEach((p, i) => { const d = diffs.items[i]; if (d) out.push(diffFileOf(p, d)); });
    return out;
  }, [paths, diffs]);
  const notes = useMemo(() => (comments.status === "ready" ? commentsOf(comments.data.comments, files, data.nameOf) : []), [comments, files, data]);
  const [layout] = useReviewLayout();
  if (cs.status !== "ready" || !diffs.ready) return <Skeleton height={LOADING_HEIGHT} testID="diff-loading" />;
  if (!files.length) return <Empty text="Nothing to review in this changeset." />;
  const base = Number(cs.data.changeset.baseVersion);
  return (
    <DiffTab
      key={layout}
      title={Number.isFinite(base) && base > 0 ? `v${base} \u2192 v${base + 1}` : ""}
      layout={layout}
      bare
      wordMarks
      files={files}
      comments={notes}
      selectedPath={path && files.some((f) => f.path === path) ? path : (files[0]?.path ?? null)}
      density={density}
      changesetId={changesetId}
      invoke={(c, i) => data.call(c, i)}
      testID="changeset-diff"
    />
  );
}

export interface CommitDiffProps {
  folderId: string;
  sha: string;
  path?: string;
  density?: Density;
}

/** git.show: one commit. */
export function CommitDiff({ folderId, sha, path, density = "regular" }: CommitDiffProps): ReactElement {
  const q = useCap("git.show", { folderId, sha, ...(path ? { path } : {}) });
  const files = useMemo<DiffFile[]>(() => (q.status === "ready" ? commitFiles(q.data, path) : []), [q, path]);
  if (q.status !== "ready") return <Skeleton height={LOADING_HEIGHT} testID="diff-loading" />;
  return (
    <DiffTab title={q.data.commit.message} layout="unified" wordMarks files={files} comments={[]} selectedPath={files[0]?.path ?? null} density={density} testID="commit-diff" />
  );
}

const st = StyleSheet.create({
  empty: { padding: 24, alignItems: "center" },
  emptyText: { fontSize: 13, color: "var(--ink-3)" as string },
});
