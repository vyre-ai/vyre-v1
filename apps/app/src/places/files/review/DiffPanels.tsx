// The diff tabs (spec 2.16, 4.5; screens files.diff and files.commit-diff): the shared ui/DiffTab fed by files.diff (two versions of a file), changesets.diff with the comments (an agent's changes) and
// git.show (a commit). Revert of one change and a comment call their capabilities through DiffTab's own invoke. Nothing here draws a line of the diff.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DiffTab } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { Density, DiffFile } from "../../../../../../ui/src/DiffTab/index.tsx";
import { useCap, useCapMany, useReviewData, useReviewLayout } from "./data.tsx";
import { basePreviewUrl, readTexts } from "./actions.ts";
import { commentsOf, paragraphsOfText, wholeDocument, commitFiles, diffFileOf } from "./model.ts";
import { Skeleton } from "./parts.tsx";

const LOADING_HEIGHT = 240;

const isAddress = (s: string): boolean => /^(data:|https?:|\/)/.test(s);

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
  const [full, setFull] = useState<DiffFile["hunks"] | null>(null);
  const prose = q.status === "ready" && diffFileOf(name, q.data).body === "paragraph";
  // the capability carries three paragraphs of context; with both versions known the page reads the two texts and shows the whole document
  useEffect(() => {
    if (!prose || !from || !to) return;
    let live = true;
    void readTexts(data.call, fileId, from, to).then((t) => { if (live && t) setFull(wholeDocument(paragraphsOfText(t.from), paragraphsOfText(t.to))); });
    return () => { live = false; };
  }, [prose, from, to, fileId, data]);
  const files = useMemo<DiffFile[]>(() => {
    if (q.status !== "ready") return [];
    const f = diffFileOf(name, q.data);
    return [full && f.body === "paragraph" ? { ...f, hunks: full } : f];
  }, [q, name, full]);
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
  // context full: every paragraph of the base and the staged text, so the open file reads as the whole document
  const diffs = useCapMany("changesets.diff", paths.map((p) => ({ changesetId, path: p, context: "full" as const })));
  const comments = useCap("changesets.comments.list", { changesetId });
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const baseVersion = cs.status === "ready" ? Number(cs.data.changeset.baseVersion) : 0;
  useEffect(() => {
    if (cs.status !== "ready" || !Number.isFinite(baseVersion) || baseVersion <= 0) return;
    let live = true;
    cs.data.files.forEach((f, i) => {
      const d = diffs.items[i];
      if (!f.fileId || !d || d.kind !== "image" || !d.images?.left || isAddress(d.images.left)) return;
      const fileId = f.fileId;
      void basePreviewUrl(data.call, fileId, baseVersion).then((url) => { if (live && url) setPictures((m) => ({ ...m, [f.path]: url })); });
    });
    return () => { live = false; };
  }, [cs, diffs, baseVersion, data]);
  const files = useMemo<DiffFile[]>(() => {
    const out: DiffFile[] = [];
    paths.forEach((p, i) => {
      const d = diffs.items[i];
      if (!d) return;
      const f = diffFileOf(p, d);
      // a picture's before is the file's preview at its base version; an address the capability already gave stays
      out.push(f.body === "image" ? { ...f, hunks: f.hunks.map((h) => ({ ...h, removed: isAddress(h.removed) ? h.removed : (pictures[p] ?? ""), added: isAddress(h.added) ? h.added : "" })) } : f);
    });
    return out;
  }, [paths, diffs, pictures]);
  const notes = useMemo(() => (comments.status === "ready" ? commentsOf(comments.data.comments, files, data.nameOf, data.clock().now) : []), [comments, files, data]);
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
